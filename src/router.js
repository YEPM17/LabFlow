import { ApiError } from "./errors.js";

function normalizePath(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function splitPath(pathname) {
  return normalizePath(pathname).split("/").filter(Boolean);
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    this.routes.push({
      method: method.toUpperCase(),
      segments: splitPath(pattern),
      handler,
      options
    });
    return this;
  }

  get(pattern, handler, options) { return this.add("GET", pattern, handler, options); }
  post(pattern, handler, options) { return this.add("POST", pattern, handler, options); }
  patch(pattern, handler, options) { return this.add("PATCH", pattern, handler, options); }
  delete(pattern, handler, options) { return this.add("DELETE", pattern, handler, options); }

  match(method, pathname) {
    const segments = splitPath(pathname);
    const allowed = new Set();
    for (const route of this.routes) {
      const params = matchSegments(route.segments, segments);
      if (!params) continue;
      allowed.add(route.method);
      if (route.method === method.toUpperCase()) {
        return { route, params, allowed };
      }
    }
    return { route: null, params: null, allowed };
  }
}

function matchSegments(patternSegments, pathSegments) {
  if (patternSegments.length !== pathSegments.length) return null;
  const params = Object.create(null);
  for (let index = 0; index < patternSegments.length; index += 1) {
    const pattern = patternSegments[index];
    const value = pathSegments[index];
    if (pattern.startsWith(":")) {
      try {
        params[pattern.slice(1)] = decodeURIComponent(value);
      } catch {
        throw new ApiError(400, "BAD_PATH", "请求路径编码无效");
      }
    } else if (pattern !== value) {
      return null;
    }
  }
  return params;
}
