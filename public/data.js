async function api(path, options = {}) {
  const { method = "GET", body, headers = {}, redirectOn401 = true, signal } = options;
  const request = {
    method,
    credentials: "same-origin",
    headers: { ...headers },
    signal
  };
  if (body !== undefined && body !== null) {
    if (body instanceof FormData) {
      request.body = body;
    } else {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(body);
    }
  }
  let response;
  try {
    response = await fetch(`/api${path}`, request);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const networkError = new Error("无法连接实验室服务器，请检查后端是否已启动");
    networkError.code = "NETWORK_ERROR";
    throw networkError;
  }
  if (response.status === 204) return null;
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `请求失败（${response.status}）`);
    error.status = response.status;
    error.code = payload?.error?.code || "REQUEST_FAILED";
    error.details = payload?.error?.details;
    if (response.status === 401 && redirectOn401 && !location.pathname.endsWith("login.html")) {
      location.replace("login.html");
    }
    throw error;
  }
  return payload;
}

function roleHome(role) {
  return role === "student" ? "student.html" : "teacher.html";
}

async function getCurrentUser(allowedRoles = null) {
  let me;
  try {
    me = await api("/auth/me");
  } catch (error) {
    if (error.status === 401) return null;
    throw error;
  }
  if (allowedRoles && !allowedRoles.includes(me.user.role)) {
    location.replace(roleHome(me.user.role));
    return null;
  }
  return me;
}

async function logout() {
  try {
    await api("/auth/logout", { method: "POST", redirectOn401: false });
  } finally {
    location.replace("login.html");
  }
}

function getStatusText(status) {
  const labels = {
    available: "空闲",
    reserved: "使用中",
    maintenance: "维修中",
    pending: "待审核",
    approved: "已通过",
    rejected: "已拒绝",
    cancelled: "已取消",
    processing: "处理中",
    completed: "已完成"
  };
  return labels[status] || status;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function dateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function debounce(callback, delay = 260) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`读取照片「${file.name}」失败`));
    reader.readAsDataURL(file);
  });
}

function formatShortTime(value) {
  if (!value) return "";
  const text = String(value);
  return text.length >= 16 ? text.slice(5, 16).replace("T", " ") : text;
}
