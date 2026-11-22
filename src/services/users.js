import { ApiError, conflict, notFound } from "../errors.js";
import { hashPassword } from "../security.js";
import { timestampNow } from "../time.js";
import { integerField, oneOf, optionalString, pagination, stringField } from "../validate.js";

export function mapUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    email: row.email,
    active: Boolean(row.active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function validateUsername(value) {
  const username = stringField(value, "用户名", { min: 3, max: 40 });
  if (!/^[A-Za-z0-9._-]+$/.test(username)) {
    throw new ApiError(400, "INVALID_USERNAME", "用户名只能包含字母、数字、点、下划线和短横线");
  }
  return username;
}

function validatePassword(value) {
  return stringField(value, "密码", { min: 8, max: 72 });
}

function validateEmail(value) {
  const email = optionalString(value, "邮箱", { max: 120 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "INVALID_EMAIL", "邮箱格式无效");
  }
  return email;
}

export function listUsers(db, query = {}) {
  const { page, pageSize, offset } = pagination(query, { defaultPageSize: 50, maxPageSize: 100 });
  const where = [];
  const params = [];
  if (query.role && query.role !== "all") {
    oneOf(query.role, "角色", ["student", "teacher", "admin"]);
    where.push("role = ?");
    params.push(query.role);
  }
  if (query.active !== undefined) {
    where.push("active = ?");
    params.push(query.active === "false" || query.active === "0" ? 0 : 1);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const items = db.prepare(`
    SELECT * FROM users ${whereSql} ORDER BY id LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset).map(mapUser);
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users ${whereSql}`).get(...params).count;
  return { items, total, page, pageSize };
}

export async function createUser(db, body) {
  const username = validateUsername(body.username);
  const displayName = stringField(body.displayName, "姓名", { max: 60 });
  const role = oneOf(body.role, "角色", ["student", "teacher", "admin"]);
  const password = validatePassword(body.password);
  const email = validateEmail(body.email);
  const exists = db.prepare("SELECT id FROM users WHERE username = ? COLLATE NOCASE").get(username);
  if (exists) throw conflict("USERNAME_TAKEN", "该用户名已存在");
  const passwordHash = await hashPassword(password);
  const now = timestampNow();
  let result;
  try {
    result = db.prepare(`
      INSERT INTO users (username, display_name, role, password_hash, email, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(username, displayName, role, passwordHash, email, now, now);
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) {
      throw conflict("USERNAME_TAKEN", "该用户名已存在");
    }
    throw error;
  }
  return mapUser(db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid));
}

export async function updateUser(db, id, body) {
  const userId = integerField(id, "用户编号");
  const currentRow = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!currentRow) throw notFound("未找到该用户");

  const displayName = body.displayName === undefined
    ? currentRow.display_name
    : stringField(body.displayName, "姓名", { max: 60 });
  const role = body.role === undefined
    ? currentRow.role
    : oneOf(body.role, "角色", ["student", "teacher", "admin"]);
  const active = body.active === undefined ? Boolean(currentRow.active) : Boolean(body.active);
  const email = body.email === undefined ? currentRow.email : validateEmail(body.email);
  const passwordHash = body.password === undefined
    ? currentRow.password_hash
    : await hashPassword(validatePassword(body.password));

  if (currentRow.role === "admin" && currentRow.active && (role !== "admin" || !active)) {
    const activeAdmins = db.prepare(`
      SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1 AND id != ?
    `).get(userId).count;
    if (activeAdmins === 0) throw conflict("LAST_ADMIN", "系统必须保留至少一个启用状态的管理员");
  }

  db.prepare(`
    UPDATE users
    SET display_name = ?, role = ?, active = ?, email = ?, password_hash = ?, updated_at = ?
    WHERE id = ?
  `).run(displayName, role, active ? 1 : 0, email, passwordHash, timestampNow(), userId);
  if (body.password !== undefined) {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
  }
  return mapUser(db.prepare("SELECT * FROM users WHERE id = ?").get(userId));
}
