import {
  createSessionToken,
  hashSessionToken,
  parseCookies,
  serializeCookie
} from "./security.js";
import { mapUser } from "./services/users.js";

export function loadSession(db, req, config) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies[config.cookieName];
  if (!token) return null;
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const row = db.prepare(`
    SELECT s.token_hash, s.expires_at, u.*
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1
  `).get(tokenHash);
  if (!row) return null;
  if (row.expires_at <= now) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
    return null;
  }
  const expiresAt = now + config.sessionIdleMs;
  db.prepare(`
    UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?
  `).run(now, expiresAt, tokenHash);
  return { token, tokenHash, expiresAt, user: mapUser(row) };
}

export function createSession(db, userId, config) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const now = Date.now();
  const expiresAt = now + config.sessionIdleMs;
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare(`
    INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(tokenHash, userId, now, now, expiresAt);
  return { token, tokenHash, expiresAt };
}

export function destroySession(db, tokenHash) {
  if (tokenHash) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

export function setSessionCookie(res, token, config) {
  res.setHeader("Set-Cookie", serializeCookie(config.cookieName, token, {
    maxAgeSeconds: config.sessionIdleMs / 1000,
    secure: config.cookieSecure,
    httpOnly: true,
    sameSite: "Lax"
  }));
}

export function clearSessionCookie(res, config) {
  res.setHeader("Set-Cookie", serializeCookie(config.cookieName, "", {
    maxAgeSeconds: 0,
    secure: config.cookieSecure,
    httpOnly: true,
    sameSite: "Lax"
  }));
}
