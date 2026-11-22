import fs from "node:fs/promises";
import path from "node:path";
import { ApiError, conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../ids.js";
import { timestampNow } from "../time.js";
import { integerField, oneOf, pagination, stringField } from "../validate.js";
import { createNotification, notifyRoles } from "./notifications.js";

const REPAIR_SELECT = `
  SELECT r.*, u.display_name AS student_name, u.username AS student_username
  FROM repairs r
  JOIN users u ON u.id = r.student_id
`;

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};

function sniffImageMime(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) {
    return "image/png";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
    return "image/gif";
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function safeOriginalName(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return path.basename(value.trim()).replace(/[^\w.\-\u4e00-\u9fa5 ]/g, "_").slice(0, 120) || fallback;
}

async function persistPhotos(photos, uploadDir, maxBytes, maxPhotos) {
  if (photos === undefined || photos === null) return [];
  if (!Array.isArray(photos)) {
    throw new ApiError(400, "VALIDATION_ERROR", "photos 必须是数组");
  }
  if (photos.length > maxPhotos) {
    throw new ApiError(400, "TOO_MANY_PHOTOS", `最多上传 ${maxPhotos} 张照片`);
  }

  const saved = [];
  try {
    for (let index = 0; index < photos.length; index += 1) {
      const photo = photos[index];
      if (!photo || typeof photo !== "object") {
        throw new ApiError(400, "INVALID_PHOTO", "照片格式无效");
      }
      const dataUrl = String(photo.data || "");
      const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUrl);
      if (!match) {
        throw new ApiError(400, "INVALID_PHOTO", `第 ${index + 1} 张照片格式无效，仅支持 JPEG、PNG、WebP、GIF`);
      }
      const declaredMime = match[1];
      const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
      if (buffer.length === 0) {
        throw new ApiError(400, "EMPTY_PHOTO", `第 ${index + 1} 张照片内容为空`);
      }
      if (buffer.length > maxBytes) {
        throw new ApiError(400, "PHOTO_TOO_LARGE", `第 ${index + 1} 张照片超过 2MB`);
      }
      const actualMime = sniffImageMime(buffer);
      if (!actualMime || actualMime !== declaredMime || !IMAGE_TYPES[actualMime]) {
        throw new ApiError(400, "INVALID_PHOTO_TYPE", `第 ${index + 1} 张照片内容与图片类型不匹配`);
      }

      const id = newId();
      const storedName = `${id}.${IMAGE_TYPES[actualMime]}`;
      const targetPath = path.join(uploadDir, storedName);
      await fs.writeFile(targetPath, buffer, { mode: 0o600, flag: "wx" });
      saved.push({
        id,
        storedName,
        originalName: safeOriginalName(photo.name, `photo-${index + 1}.${IMAGE_TYPES[actualMime]}`),
        mimeType: actualMime,
        sizeBytes: buffer.length,
        targetPath
      });
    }
    return saved;
  } catch (error) {
    await Promise.all(saved.map((photo) => fs.rm(photo.targetPath, { force: true }).catch(() => {})));
    throw error;
  }
}

function photoUrl(repairId, photoId) {
  return `/api/repairs/${encodeURIComponent(repairId)}/photos/${encodeURIComponent(photoId)}`;
}

function mapPhoto(repairId, row) {
  return {
    id: row.id,
    url: photoUrl(repairId, row.id),
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes)
  };
}

function attachPhotos(db, rows) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const photos = db.prepare(`
    SELECT * FROM repair_photos WHERE repair_id IN (${placeholders}) ORDER BY created_at, id
  `).all(...ids);
  const grouped = new Map();
  for (const photo of photos) {
    const list = grouped.get(photo.repair_id) || [];
    list.push(mapPhoto(photo.repair_id, photo));
    grouped.set(photo.repair_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    studentUsername: row.student_username,
    deviceId: row.device_id === null ? null : Number(row.device_id),
    deviceName: row.device_name_snapshot,
    title: row.title,
    description: row.description,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: grouped.get(row.id) || []
  }));
}

function repairSummary(db, user) {
  const where = user.role === "student" ? "WHERE student_id = ?" : "";
  const params = user.role === "student" ? [user.id] : [];
  const rows = db.prepare(`SELECT status, COUNT(*) AS count FROM repairs ${where} GROUP BY status`).all(...params);
  const summary = { total: 0, pending: 0, processing: 0, completed: 0 };
  for (const row of rows) {
    summary[row.status] = Number(row.count);
    summary.total += Number(row.count);
  }
  return summary;
}

export function listRepairs(db, user, query = {}) {
  const { page, pageSize, offset } = pagination(query, { defaultPageSize: 100, maxPageSize: 200 });
  const where = [];
  const params = [];
  if (user.role === "student") {
    where.push("r.student_id = ?");
    params.push(user.id);
  }
  if (query.status && query.status !== "all") {
    oneOf(query.status, "报修状态", ["pending", "processing", "completed"]);
    where.push("r.status = ?");
    params.push(query.status);
  }
  if (query.deviceId) {
    where.push("r.device_id = ?");
    params.push(integerField(query.deviceId, "设备编号"));
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = user.role === "student"
    ? "ORDER BY r.created_at DESC"
    : "ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'processing' THEN 1 ELSE 2 END, r.created_at DESC";
  const rows = db.prepare(`
    ${REPAIR_SELECT} ${whereSql} ${orderSql} LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM repairs r ${whereSql}`).get(...params).count;
  return {
    items: attachPhotos(db, rows),
    total,
    page,
    pageSize,
    summary: repairSummary(db, user)
  };
}

export function getRepair(db, user, id) {
  const row = db.prepare(`${REPAIR_SELECT} WHERE r.id = ?`).get(id);
  if (!row) throw notFound("未找到该报修记录");
  if (user.role === "student" && row.student_id !== user.id) throw forbidden();
  return attachPhotos(db, [row])[0];
}

export async function createRepair(db, user, body, config) {
  if (user.role !== "student") throw forbidden("只有学生账号可以提交报修");
  const deviceId = integerField(body.deviceId, "设备编号");
  const title = stringField(body.title, "故障标题", { max: 100 });
  const description = stringField(body.description, "故障描述", { max: 2000 });
  const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
  if (!device) throw notFound("未找到该设备");

  const photos = await persistPhotos(body.photos, config.uploadDir, config.maxPhotoBytes, config.maxRepairPhotos);
  const repairId = newId();
  const now = timestampNow();
  try {
    db.exec("BEGIN IMMEDIATE;");
    db.prepare(`
      INSERT INTO repairs
        (id, student_id, device_id, device_name_snapshot, title, description, status,
         processed_by, started_at, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?)
    `).run(repairId, user.id, deviceId, device.name, title, description, now, now);
    const photoStatement = db.prepare(`
      INSERT INTO repair_photos
        (id, repair_id, stored_name, original_name, mime_type, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const photo of photos) {
      photoStatement.run(photo.id, repairId, photo.storedName, photo.originalName, photo.mimeType, photo.sizeBytes, now);
    }
    notifyRoles(db, ["teacher", "admin"], {
      type: "repair_created",
      title: "新的设备报修",
      body: `${user.displayName} 报告「${device.name}」故障：${title}`,
      relatedType: "repair",
      relatedId: repairId
    });
    db.exec("COMMIT;");
  } catch (error) {
    try { db.exec("ROLLBACK;"); } catch { /* no active transaction */ }
    await Promise.all(photos.map((photo) => fs.rm(photo.targetPath, { force: true }).catch(() => {})));
    throw error;
  }
  return getRepair(db, user, repairId);
}

export function startRepair(db, user, id) {
  if (!["teacher", "admin"].includes(user.role)) throw forbidden();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = db.prepare("SELECT * FROM repairs WHERE id = ?").get(id);
    if (!row) throw notFound("未找到该报修记录");
    if (row.status !== "pending") throw conflict("INVALID_STATUS", "只有待处理的报修可以开始维修");
    const now = timestampNow();
    db.prepare(`
      UPDATE repairs SET status = 'processing', processed_by = ?, started_at = ?, updated_at = ? WHERE id = ?
    `).run(user.id, now, now, id);
    if (row.device_id !== null) {
      db.prepare("UPDATE devices SET status = 'maintenance', updated_at = ? WHERE id = ?")
        .run(now, row.device_id);
    }
    createNotification(db, {
      userId: row.student_id,
      type: "repair_processing",
      title: "报修已开始处理",
      body: `你报告的「${row.device_name_snapshot}」故障已进入维修处理。`,
      relatedType: "repair",
      relatedId: id
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getRepair(db, user, id);
}

export function completeRepair(db, user, id) {
  if (!["teacher", "admin"].includes(user.role)) throw forbidden();
  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = db.prepare("SELECT * FROM repairs WHERE id = ?").get(id);
    if (!row) throw notFound("未找到该报修记录");
    if (row.status !== "processing") throw conflict("INVALID_STATUS", "只有处理中的报修可以完成");
    const now = timestampNow();
    db.prepare(`
      UPDATE repairs SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?
    `).run(now, now, id);
    if (row.device_id !== null) {
      const otherProcessing = db.prepare(`
        SELECT COUNT(*) AS count FROM repairs
        WHERE id != ? AND device_id = ? AND status = 'processing'
      `).get(id, row.device_id).count;
      if (otherProcessing === 0) {
        db.prepare("UPDATE devices SET status = 'available', updated_at = ? WHERE id = ?")
          .run(now, row.device_id);
      }
    }
    createNotification(db, {
      userId: row.student_id,
      type: "repair_completed",
      title: "报修已完成",
      body: `你报告的「${row.device_name_snapshot}」故障已维修完成。`,
      relatedType: "repair",
      relatedId: id
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getRepair(db, user, id);
}

export function getRepairPhoto(db, user, repairId, photoId) {
  const repair = db.prepare("SELECT id, student_id FROM repairs WHERE id = ?").get(repairId);
  if (!repair) throw notFound("未找到该报修记录");
  if (user.role === "student" && repair.student_id !== user.id) throw forbidden();
  const photo = db.prepare(`
    SELECT * FROM repair_photos WHERE id = ? AND repair_id = ?
  `).get(photoId, repairId);
  if (!photo) throw notFound("未找到该照片");
  return photo;
}
