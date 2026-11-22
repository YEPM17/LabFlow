import { conflict, forbidden, notFound } from "../errors.js";
import { newId } from "../ids.js";
import { atLocal, dateKey, timestampNow } from "../time.js";
import { integerField, oneOf, optionalString, pagination } from "../validate.js";
import { validateBookingWindow } from "./bookingRules.js";
import { createNotification, notifyRoles } from "./notifications.js";

const RESERVATION_SELECT = `
  SELECT r.*, u.display_name AS student_name, u.username AS student_username,
         d.name AS current_device_name, d.status AS device_configured_status
  FROM reservations r
  JOIN users u ON u.id = r.student_id
  LEFT JOIN devices d ON d.id = r.device_id
`;

function cancellationState(row, user, config) {
  if (user.role !== "student" || user.id !== row.student_id) {
    return { canCancel: false, reason: null };
  }
  if (!["pending", "approved"].includes(row.status)) {
    return { canCancel: false, reason: "当前状态的预约无法取消" };
  }
  const startMs = atLocal(row.date, row.start_time, config.utcOffsetMinutes);
  const now = Date.now();
  if (row.status === "pending" && startMs <= now) {
    return { canCancel: false, reason: "该预约已开始使用，无法取消" };
  }
  if (row.status === "approved" && startMs - config.cancelCutoffMinutes * 60_000 <= now) {
    return {
      canCancel: false,
      reason: `已通过预约需在开始前 ${config.cancelCutoffMinutes} 分钟取消`
    };
  }
  return { canCancel: true, reason: null };
}

export function serializeReservation(row, user, config) {
  const cancellation = cancellationState(row, user, config);
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    studentUsername: row.student_username,
    deviceId: row.device_id === null ? null : Number(row.device_id),
    deviceName: row.device_name_snapshot,
    currentDeviceName: row.current_device_name || null,
    date: row.date,
    start: row.start_time,
    end: row.end_time,
    status: row.status,
    rejectReason: row.reject_reason,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canCancel: cancellation.canCancel,
    cancelBlockedReason: cancellation.reason
  };
}

function summaryForScope(db, user) {
  const where = user.role === "student" ? "WHERE student_id = ?" : "";
  const params = user.role === "student" ? [user.id] : [];
  const rows = db.prepare(`
    SELECT status, COUNT(*) AS count FROM reservations ${where} GROUP BY status
  `).all(...params);
  const summary = { total: 0, pending: 0, approved: 0, rejected: 0, cancelled: 0 };
  for (const row of rows) {
    summary[row.status] = Number(row.count);
    summary.total += Number(row.count);
  }
  return summary;
}

export function listReservations(db, user, query = {}, config) {
  const { page, pageSize, offset } = pagination(query, { defaultPageSize: 100, maxPageSize: 200 });
  const where = [];
  const params = [];

  if (user.role === "student") {
    where.push("r.student_id = ?");
    params.push(user.id);
  } else if (query.studentId) {
    where.push("r.student_id = ?");
    params.push(integerField(query.studentId, "学生编号"));
  }
  if (query.status && query.status !== "all") {
    oneOf(query.status, "预约状态", ["pending", "approved", "rejected", "cancelled"]);
    where.push("r.status = ?");
    params.push(query.status);
  }
  if (query.deviceId) {
    where.push("r.device_id = ?");
    params.push(integerField(query.deviceId, "设备编号"));
  }
  if (query.date) {
    where.push("r.date = ?");
    params.push(String(query.date));
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = user.role === "student"
    ? "ORDER BY r.date DESC, r.start_time DESC, r.created_at DESC"
    : "ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.date DESC, r.start_time DESC, r.created_at DESC";
  const rows = db.prepare(`
    ${RESERVATION_SELECT}
    ${whereSql}
    ${orderSql}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM reservations r ${whereSql}
  `).get(...params).count;

  return {
    items: rows.map((row) => serializeReservation(row, user, config)),
    total,
    page,
    pageSize,
    summary: summaryForScope(db, user)
  };
}

function getReservationRow(db, id) {
  return db.prepare(`${RESERVATION_SELECT} WHERE r.id = ?`).get(id);
}

export function getReservation(db, user, id, config) {
  const row = getReservationRow(db, id);
  if (!row) throw notFound("未找到该预约");
  if (user.role === "student" && row.student_id !== user.id) throw forbidden();
  return serializeReservation(row, user, config);
}

export function createReservation(db, user, body, config) {
  if (user.role !== "student") {
    throw forbidden("只有学生账号可以提交预约申请");
  }
  const deviceId = integerField(body.deviceId, "设备编号");
  const date = String(body.date || "");
  const start = String(body.start || "");
  const end = String(body.end || "");
  const now = Date.now();
  validateBookingWindow({ date, start, end, config, now });
  let reservationId = null;

  db.exec("BEGIN IMMEDIATE;");
  try {
    const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(deviceId);
    if (!device) throw notFound("未找到该设备");
    if (device.status === "maintenance") {
      throw conflict("DEVICE_MAINTENANCE", "设备维修中，暂不可预约");
    }
    const overlapping = db.prepare(`
      SELECT id FROM reservations
      WHERE device_id = ? AND date = ? AND status IN ('pending', 'approved')
        AND start_time < ? AND end_time > ?
      LIMIT 1
    `).get(deviceId, date, end, start);
    if (overlapping) {
      throw conflict("RESERVATION_CONFLICT", "该时间段已有预约申请，请选择其他时间");
    }

    const id = newId();
    reservationId = id;
    const nowText = timestampNow(now);
    db.prepare(`
      INSERT INTO reservations
        (id, student_id, device_id, device_name_snapshot, date, start_time, end_time,
         status, reject_reason, reviewed_by, reviewed_at, reminder_sent, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, 0, ?, ?)
    `).run(id, user.id, deviceId, device.name, date, start, end, nowText, nowText);

    notifyRoles(db, ["teacher", "admin"], {
      type: "reservation_created",
      title: "新的预约申请",
      body: `${user.displayName} 申请使用「${device.name}」，时间 ${date} ${start}-${end}。`,
      relatedType: "reservation",
      relatedId: id
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getReservation(db, user, reservationId, config);
}

export function cancelReservation(db, user, id, config) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = getReservationRow(db, id);
    if (!row) throw notFound("未找到该预约");
    if (user.role !== "student" || row.student_id !== user.id) throw forbidden();
    if (!["pending", "approved"].includes(row.status)) {
      throw conflict("INVALID_STATUS", "当前状态的预约无法取消");
    }
    const startMs = atLocal(row.date, row.start_time, config.utcOffsetMinutes);
    const now = Date.now();
    if (row.status === "pending" && startMs <= now) {
      throw conflict("RESERVATION_STARTED", "该预约已开始使用，无法取消");
    }
    if (row.status === "approved" && startMs - config.cancelCutoffMinutes * 60_000 <= now) {
      throw conflict(
        "CANCEL_WINDOW_CLOSED",
        `已通过预约需在开始前 ${config.cancelCutoffMinutes} 分钟取消`
      );
    }
    db.prepare(`
      UPDATE reservations SET status = 'cancelled', updated_at = ? WHERE id = ?
    `).run(timestampNow(), id);
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getReservation(db, user, id, config);
}

export function reviewReservation(db, user, id, body, config) {
  if (!["teacher", "admin"].includes(user.role)) throw forbidden();
  const decision = oneOf(body.decision, "审核结果", ["approved", "rejected"]);
  const rejectReason = optionalString(body.rejectReason, "拒绝原因", { max: 300 });

  db.exec("BEGIN IMMEDIATE;");
  try {
    const row = getReservationRow(db, id);
    if (!row) throw notFound("未找到该预约");
    if (row.status !== "pending") {
      throw conflict("ALREADY_REVIEWED", "该预约已经处理，不能重复审核");
    }

    if (decision === "approved") {
      if (row.device_id === null) throw conflict("DEVICE_DELETED", "设备已删除，不能批准预约");
      const device = db.prepare("SELECT * FROM devices WHERE id = ?").get(row.device_id);
      if (!device) throw conflict("DEVICE_DELETED", "设备已删除，不能批准预约");
      if (device.status === "maintenance") {
        throw conflict("DEVICE_MAINTENANCE", "该设备维修中，不能批准预约");
      }
      const overlap = db.prepare(`
        SELECT id FROM reservations
        WHERE id != ? AND device_id = ? AND date = ? AND status = 'approved'
          AND start_time < ? AND end_time > ?
        LIMIT 1
      `).get(id, row.device_id, row.date, row.end_time, row.start_time);
      if (overlap) throw conflict("RESERVATION_CONFLICT", "与其他已批准预约冲突");
    }

    const nowText = timestampNow();
    db.prepare(`
      UPDATE reservations
      SET status = ?, reject_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(decision, decision === "rejected" ? rejectReason : null, user.id, nowText, nowText, id);

    const notificationBody = decision === "approved"
      ? `你申请的「${row.device_name_snapshot}」${row.date} ${row.start_time}-${row.end_time} 已通过审核。`
      : `你申请的「${row.device_name_snapshot}」${row.date} ${row.start_time}-${row.end_time} 未通过${rejectReason ? `：${rejectReason}` : "。"}`;
    createNotification(db, {
      userId: row.student_id,
      type: decision === "approved" ? "reservation_approved" : "reservation_rejected",
      title: decision === "approved" ? "预约已通过" : "预约未通过",
      body: notificationBody,
      relatedType: "reservation",
      relatedId: id
    });
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getReservation(db, user, id, config);
}

export function reservationsForReminder(db) {
  return db.prepare(`
    SELECT r.*, u.display_name AS student_name
    FROM reservations r
    JOIN users u ON u.id = r.student_id
    WHERE r.status = 'approved' AND r.reminder_sent = 0 AND r.date >= ?
    ORDER BY r.date, r.start_time
  `).all(dateKey());
}
