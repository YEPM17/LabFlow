export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function assert(condition, status, code, message, details) {
  if (!condition) throw new ApiError(status, code, message, details);
}

export function notFound(message = "请求的资源不存在") {
  return new ApiError(404, "NOT_FOUND", message);
}

export function forbidden(message = "没有权限执行此操作") {
  return new ApiError(403, "FORBIDDEN", message);
}

export function conflict(code, message, details) {
  return new ApiError(409, code, message, details);
}
