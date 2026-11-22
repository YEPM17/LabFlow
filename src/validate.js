import { ApiError } from "./errors.js";

export function stringField(value, name, { min = 1, max = 200, trim = true } = {}) {
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", `${name}必须是文本`);
  }
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `${name}长度需在 ${min} 到 ${max} 个字符之间`);
  }
  return result;
}

export function optionalString(value, name, options = {}) {
  if (value === undefined || value === null || value === "") return null;
  return stringField(value, name, options);
}

export function integerField(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const result = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(result) || result < min || result > max) {
    throw new ApiError(400, "VALIDATION_ERROR", `${name}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return result;
}

export function oneOf(value, name, allowed) {
  if (!allowed.includes(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${name}取值无效`, { allowed });
  }
  return value;
}

export function pagination(query, { defaultPageSize = 50, maxPageSize = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(maxPageSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
