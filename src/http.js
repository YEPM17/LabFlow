import { ApiError } from "./errors.js";

export function sendJson(res, status, payload, headers = {}) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

export function sendNoContent(res, headers = {}) {
  res.writeHead(204, { "Cache-Control": "no-store", ...headers });
  res.end();
}

export function sendError(res, error) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const status = Number.isInteger(error.status) ? error.status : 500;
  const code = error.code || (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
  const message = status === 500 ? "服务器内部错误，请稍后重试" : error.message;
  const payload = { error: { code, message } };
  if (error.details !== undefined) payload.error.details = error.details;
  sendJson(res, status, payload);
}

export async function readJsonBody(req, maxBytes) {
  const length = Number(req.headers["content-length"] || 0);
  if (Number.isFinite(length) && length > maxBytes) {
    req.resume();
    throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容超过大小限制");
  }
  if (req.method === "GET" || req.method === "HEAD") return null;

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "请求内容超过大小限制");
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "BODY_READ_ERROR", "读取请求内容失败");
  }
  if (size === 0) return null;
  const contentType = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "请求必须使用 application/json");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "INVALID_JSON", "请求 JSON 格式无效");
  }
}

export function parseQuery(url) {
  const result = Object.create(null);
  for (const [key, value] of url.searchParams.entries()) result[key] = value;
  return result;
}

export function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || "unknown";
}

export function applySecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'"
    ].join("; ")
  );
}

export function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (origin === "null") throw new ApiError(403, "CSRF_ORIGIN", "请求来源不受信任");
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ApiError(403, "CSRF_ORIGIN", "请求来源不受信任");
  }
  if (originHost !== req.headers.host) {
    throw new ApiError(403, "CSRF_ORIGIN", "请求来源不受信任");
  }
  if (req.headers["sec-fetch-site"] === "cross-site") {
    throw new ApiError(403, "CSRF_ORIGIN", "不接受跨站请求");
  }
}
