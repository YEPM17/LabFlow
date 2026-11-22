import { ApiError, conflict, notFound } from "../errors.js";
import { timestampNow, dateKey, timeKey } from "../time.js";
import { integerField, oneOf, pagination, stringField } from "../validate.js";
import { validateBookingWindow, bookingConstraints } from "./bookingRules.js";

const EFFECTIVE_STATUS_SQL = `
  CASE
    WHEN d.status = 'maintenance' THEN 'maintenance'
    WHEN EXISTS (
      SELECT 1 FROM reservations r
      WHERE r.device_id = d.id
        AND r.status = 'approved'
        AND r.date = ?
        AND r.start_time <= ?
        AND r.end_time > ?
    ) THEN 'reserved'
    ELSE 'available'
  END
`;

function currentStatusParams() {
  return [dateKey(), timeKey(), timeKey()];
}

function mapDevice(row) {
  return {
    id: Number(row.id),
    name: row.name,
    room: row.room,
    type: row.type,
    description: row.description,
    status: row.effective_status,
    configuredStatus: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function listDevices(db, query = {}, config) {
  const { page, pageSize, offset } = pagination(query, { defaultPageSize: 100, maxPageSize: 200 });
  const statusParams = currentStatusParams();
  const where = [];
  const params = [];

  if (query.q) {
    const keyword = `%${escapeLike(String(query.q).trim().slice(0, 80))}%`;
    where.push("(d.name LIKE ? ESCAPE '\\' OR d.room LIKE ? ESCAPE '\\' OR d.type LIKE ? ESCAPE '\\')");
    params.push(keyword, keyword, keyword);
  }
  if (query.room) {
    where.push("d.room = ?");
    params.push(String(query.room));
  }
  if (query.type) {
    where.push("d.type = ?");
    params.push(String(query.type));
  }
  if (query.status && query.status !== "all") {
    oneOf(query.status, "设备状态", ["available", "reserved", "maintenance"]);
    where.push(`(${EFFECTIVE_STATUS_SQL}) = ?`);
    params.push(...currentStatusParams(), query.status);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const baseFrom = `FROM devices d ${where.length ? whereSql : ""}`;
  const items = db.prepare(`
    SELECT d.*, ${EFFECTIVE_STATUS_SQL} AS effective_status
    ${baseFrom}
    ORDER BY d.id
    LIMIT ? OFFSET ?
  `).all(...statusParams, ...params, pageSize, offset).map(mapDevice);

  const total = db.prepare(`SELECT COUNT(*) AS count FROM devices d ${whereSql}`)
    .get(...params).count;
  const summary = deviceSummary(db);
  const filters = {
    rooms: db.prepare("SELECT DISTINCT room FROM devices ORDER BY room").all().map((row) => row.room),
    types: db.prepare("SELECT DISTINCT type FROM devices ORDER BY type").all().map((row) => row.type)
  };

  return { items, total, page, pageSize, summary, filters };
}

export function deviceSummary(db) {
  const statusParams = currentStatusParams();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(effective_status = 'available'), 0) AS available,
      COALESCE(SUM(effective_status = 'reserved'), 0) AS reserved,
      COALESCE(SUM(effective_status = 'maintenance'), 0) AS maintenance
    FROM (
      SELECT d.id, ${EFFECTIVE_STATUS_SQL} AS effective_status
      FROM devices d
    )
  `).get(...statusParams);
  return {
    total: Number(row.total),
    available: Number(row.available),
    reserved: Number(row.reserved),
    maintenance: Number(row.maintenance)
  };
}

export function getDevice(db, id) {
  const deviceId = integerField(id, "设备编号");
  const row = db.prepare(`
    SELECT d.*, ${EFFECTIVE_STATUS_SQL} AS effective_status
    FROM devices d WHERE d.id = ?
  `).get(...currentStatusParams(), deviceId);
  if (!row) throw notFound("未找到该设备");
  return mapDevice(row);
}

export function listPublicDevices(db) {
  const rows = db.prepare(`
    SELECT d.id, d.name, d.room, d.type, d.description,
           ${EFFECTIVE_STATUS_SQL} AS effective_status
    FROM devices d
    ORDER BY d.id
  `).all(...currentStatusParams());
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    room: row.room,
    type: row.type,
    description: row.description,
    status: row.effective_status
  }));
}

function validateDevicePayload(body, current = null) {
  return {
    name: stringField(body.name ?? current?.name, "设备名称", { max: 80 }),
    room: stringField(body.room ?? current?.room, "所在实验室", { max: 80 }),
    type: stringField(body.type ?? current?.type ?? "其他", "设备类型", { max: 40 }),
    description: stringField(body.description ?? current?.description, "设备描述", { max: 600 }),
    status: oneOf(body.status ?? current?.status ?? "available", "设备状态", ["available", "maintenance"])
  };
}

export function createDevice(db, body) {
  const payload = validateDevicePayload(body);
  const now = timestampNow();
  const result = db.prepare(`
    INSERT INTO devices (name, room, type, status, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(payload.name, payload.room, payload.type, payload.status, payload.description, now, now);
  return getDevice(db, result.lastInsertRowid);
}

export function updateDevice(db, id, body) {
  const deviceId = integerField(id, "设备编号");
  const current = getDevice(db, deviceId);
  const payload = validateDevicePayload(body, { ...current, status: current.configuredStatus });
  const now = timestampNow();

  db.exec("BEGIN IMMEDIATE;");
  try {
    db.prepare(`
      UPDATE devices
      SET name = ?, room = ?, type = ?, status = ?, description = ?, updated_at = ?
      WHERE id = ?
    `).run(payload.name, payload.room, payload.type, payload.status, payload.description, now, deviceId);
    if (payload.name !== current.name) {
      db.prepare("UPDATE reservations SET device_name_snapshot = ? WHERE device_id = ?")
        .run(payload.name, deviceId);
      db.prepare("UPDATE repairs SET device_name_snapshot = ? WHERE device_id = ?")
        .run(payload.name, deviceId);
    }
    db.exec("COMMIT;");
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
  return getDevice(db, deviceId);
}

export function deleteDevice(db, id) {
  const deviceId = integerField(id, "设备编号");
  const device = getDevice(db, deviceId);
  const activeReservations = db.prepare(`
    SELECT COUNT(*) AS count FROM reservations
    WHERE device_id = ?
      AND (
        status = 'pending'
        OR (status = 'approved' AND (date > ? OR (date = ? AND end_time > ?)))
      )
  `).get(deviceId, dateKey(), dateKey(), timeKey()).count;
  const activeRepairs = db.prepare(`
    SELECT COUNT(*) AS count FROM repairs
    WHERE device_id = ? AND status IN ('pending', 'processing')
  `).get(deviceId).count;

  if (activeReservations > 0 || activeRepairs > 0) {
    throw conflict(
      "DEVICE_IN_USE",
      "该设备存在未完结的预约或报修，暂不能删除",
      { activeReservations, activeRepairs }
    );
  }
  db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
  return device;
}

export function deviceAvailability(db, id, query, config) {
  const device = getDevice(db, id);
  const date = String(query.date || "");
  const start = String(query.start || "");
  const end = String(query.end || "");
  let window;

  try {
    window = validateBookingWindow({ date, start, end, config });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return {
      available: false,
      code: error.code,
      message: error.message,
      constraints: bookingConstraints(config),
      blocks: []
    };
  }

  if (device.configuredStatus === "maintenance") {
    return {
      available: false,
      code: "DEVICE_MAINTENANCE",
      message: "设备维修中，暂不可预约",
      constraints: bookingConstraints(config),
      blocks: []
    };
  }

  const blocks = db.prepare(`
    SELECT start_time, end_time, status
    FROM reservations
    WHERE device_id = ? AND date = ? AND status IN ('pending', 'approved')
      AND start_time < ? AND end_time > ?
    ORDER BY start_time
  `).all(device.id, date, end, start).map((row) => ({
    start: row.start_time,
    end: row.end_time,
    status: row.status
  }));

  return {
    available: blocks.length === 0,
    code: blocks.length ? "RESERVATION_CONFLICT" : "AVAILABLE",
    message: blocks.length ? "该时间段已有预约申请，请选择其他时间" : "该时间段目前可以申请预约",
    constraints: bookingConstraints(config),
    blocks
  };
}
