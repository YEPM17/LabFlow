import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { config as defaultConfig } from "./config.js";
import { createDatabase } from "./db.js";
import { ApiError } from "./errors.js";
import {
  applySecurityHeaders,
  assertSameOrigin,
  clientIp,
  parseQuery,
  readJsonBody,
  sendError,
  sendJson,
  sendNoContent
} from "./http.js";
import { Router } from "./router.js";
import { loadSession, setSessionCookie } from "./session.js";
import { serveStatic } from "./static.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerDeviceRoutes } from "./routes/devices.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerRepairRoutes } from "./routes/repairs.js";
import { registerReservationRoutes } from "./routes/reservations.js";
import { registerStatsRoutes } from "./routes/stats.js";
import { registerUserRoutes } from "./routes/users.js";

function buildRouter() {
  const router = new Router();
  registerAuthRoutes(router);
  registerDeviceRoutes(router);
  registerReservationRoutes(router);
  registerRepairRoutes(router);
  registerNotificationRoutes(router);
  registerStatsRoutes(router);
  registerUserRoutes(router);
  router.get("/api/health", async (ctx) => {
    ctx.db.prepare("SELECT 1").get();
    ctx.json(200, { status: "ok", database: "ok", time: new Date().toISOString() });
  });
  return router;
}

export function createApp(options = {}) {
  const db = options.db || createDatabase(options.dbPath || defaultConfig.dbPath);
  const appConfig = { ...defaultConfig, ...(options.config || {}) };
  fs.mkdirSync(appConfig.uploadDir, { recursive: true });
  const router = buildRouter();
  const loginAttempts = new Map();

  return async function requestHandler(req, res) {
    const startedAt = process.hrtime.bigint();
    const requestId = randomUUID();
    res.setHeader("X-Request-Id", requestId);
    applySecurityHeaders(res);

    let url;
    try {
      url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    } catch {
      sendJson(res, 400, { error: { code: "BAD_URL", message: "请求地址无效" } });
      return;
    }

    const method = String(req.method || "GET").toUpperCase();
    const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");

    res.on("finish", () => {
      if (!appConfig.logRequests) return;
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      console.log(`${method} ${url.pathname} ${res.statusCode} ${elapsedMs.toFixed(1)}ms ${requestId.slice(0, 8)}`);
    });

    if (!isApi) {
      try {
        await serveStatic(req, res, url.pathname, appConfig.publicDir);
      } catch (error) {
        console.error(`[static] ${error.stack || error}`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Internal Server Error");
        } else {
          res.destroy();
        }
      }
      return;
    }

    try {
      if (!["GET", "HEAD"].includes(method)) assertSameOrigin(req);

      const session = loadSession(db, req, appConfig);
      if (session) setSessionCookie(res, session.token, appConfig);

      const { route, params, allowed } = router.match(method, url.pathname);
      if (!route) {
        if (allowed.size > 0) {
          sendJson(res, 405, {
            error: { code: "METHOD_NOT_ALLOWED", message: "请求方法不受支持" }
          }, { Allow: [...allowed].join(", ") });
        } else {
          sendJson(res, 404, {
            error: { code: "NOT_FOUND", message: "接口不存在" }
          });
        }
        return;
      }

      if (route.options.auth && !session) {
        throw new ApiError(401, "UNAUTHENTICATED", "登录状态已失效，请重新登录");
      }
      if (route.options.roles && !route.options.roles.includes(session.user.role)) {
        throw new ApiError(403, "FORBIDDEN", "当前账号没有权限执行此操作");
      }

      const body = ["POST", "PUT", "PATCH", "DELETE"].includes(method)
        ? await readJsonBody(req, appConfig.maxBodyBytes)
        : null;

      const ctx = {
        req,
        res,
        db,
        config: appConfig,
        session,
        user: session?.user || null,
        params,
        query: parseQuery(url),
        body,
        ip: clientIp(req, appConfig.trustProxy),
        loginAttempts,
        handled: false,
        json(status, payload, headers) { sendJson(res, status, payload, headers); },
        noContent(headers) { sendNoContent(res, headers); }
      };
      await route.handler(ctx);
      if (!res.writableEnded && !ctx.handled) {
        sendJson(res, 200, { ok: true });
      }
    } catch (error) {
      if (error instanceof ApiError || Number.isInteger(error.status)) {
        sendError(res, error);
      } else {
        console.error(`[${requestId}] ${error.stack || error}`);
        sendError(res, new ApiError(500, "INTERNAL_ERROR", "服务器内部错误"));
      }
    }
  };
}
