import { newId } from "../ids.js";
import { timestampNow } from "../time.js";

export function createNotification(db, {
  userId,
  type,
  title,
  body = "",
  relatedType = null,
  relatedId = null
}) {
  db.prepare(`
    INSERT INTO notifications
      (id, user_id, type, title, body, related_type, related_id, read_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(newId(), userId, type, title, body, relatedType, relatedId, timestampNow());
}

export function notifyRoles(db, roles, payload) {
  const placeholders = roles.map(() => "?").join(", ");
  const users = db.prepare(`
    SELECT id FROM users
    WHERE active = 1 AND role IN (${placeholders})
    ORDER BY id
  `).all(...roles);
  for (const user of users) {
    createNotification(db, { ...payload, userId: user.id });
  }
}

export function listNotifications(db, userId, { limit = 50, unreadOnly = false } = {}) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const where = unreadOnly ? "AND read_at IS NULL" : "";
  const items = db.prepare(`
    SELECT id, type, title, body, related_type, related_id, read_at, created_at
    FROM notifications
    WHERE user_id = ? ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, safeLimit).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    relatedType: row.related_type,
    relatedId: row.related_id,
    readAt: row.read_at,
    createdAt: row.created_at
  }));
  const unreadCount = countUnreadNotifications(db, userId);
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? ${where}
  `).get(userId).count;
  return { items, total, unreadCount };
}

export function countUnreadNotifications(db, userId) {
  return db.prepare(`
    SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL
  `).get(userId).count;
}

export function markNotificationRead(db, userId, notificationId) {
  const result = db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, ?)
    WHERE id = ? AND user_id = ?
  `).run(timestampNow(), notificationId, userId);
  return result.changes > 0;
}

export function markAllNotificationsRead(db, userId) {
  return db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, ?)
    WHERE user_id = ? AND read_at IS NULL
  `).run(timestampNow(), userId).changes;
}
