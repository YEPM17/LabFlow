import { ApiError } from "../errors.js";
import { verifyPassword } from "../security.js";
import { mapUser } from "../services/users.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie
} from "../session.js";

function rateEntry(store, key, windowMs) {
  const now = Date.now();
  let entry = store.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }
  return entry;
}

export function registerAuthRoutes(router) {
  router.post("/api/auth/login", async (ctx) => {
    const { body, db, config, ip } = ctx;
    const limit = config.loginRateLimit;
    const entry = rateEntry(ctx.loginAttempts, ip, limit.windowMs);
    if (entry.count >= limit.maxAttempts) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
      ctx.json(429, {
        error: {
          code: "TOO_MANY_ATTEMPTS",
          message: "登录尝试次数过多，请稍后再试",
          details: { retryAfterSeconds: retryAfter }
        }
      }, { "Retry-After": String(retryAfter) });
      return;
    }

    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!username || !password || username.length > 80 || password.length > 200) {
      entry.count += 1;
      throw new ApiError(400, "INVALID_CREDENTIALS", "请输入用户名和密码");
    }

    const row = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
    const valid = row && row.active
      ? await verifyPassword(password, row.password_hash)
      : await verifyPassword(password, "invalid");
    if (!valid || !row || !row.active) {
      entry.count += 1;
      throw new ApiError(401, "INVALID_CREDENTIALS", "用户名或密码错误");
    }

    ctx.loginAttempts.delete(ip);
    const session = createSession(db, row.id, config);
    setSessionCookie(ctx.res, session.token, config);
    ctx.json(200, {
      user: mapUser(row),
      session: { idleTimeoutMinutes: Math.round(config.sessionIdleMs / 60_000) }
    });
  });

  router.get("/api/auth/me", async (ctx) => {
    const unread = ctx.db.prepare(`
      SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL
    `).get(ctx.user.id).count;
    ctx.json(200, {
      user: ctx.user,
      session: {
        idleTimeoutMinutes: Math.round(ctx.config.sessionIdleMs / 60_000),
        expiresAt: new Date(ctx.session.expiresAt).toISOString()
      },
      unreadNotifications: unread
    });
  }, { auth: true });

  router.post("/api/auth/logout", async (ctx) => {
    if (ctx.session) destroySession(ctx.db, ctx.session.tokenHash);
    clearSessionCookie(ctx.res, ctx.config);
    ctx.noContent();
  });
}
