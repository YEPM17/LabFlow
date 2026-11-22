import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { config as defaultConfig } from "../src/config.js";
import { closeDatabase, createDatabase, seedDatabase } from "../src/db.js";
import { addDays, dateKey, localParts } from "../src/time.js";
import { runReminderScan } from "../src/scheduler.js";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

async function startTestServer() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "labflow-test-"));
  const dbPath = path.join(directory, "test.db");
  const uploadDir = path.join(directory, "uploads");
  await fs.mkdir(uploadDir, { recursive: true });
  const db = createDatabase(dbPath);
  await seedDatabase(db);
  const config = {
    ...defaultConfig,
    dbPath,
    uploadDir,
    logRequests: false,
    maxBodyBytes: 12 * 1024 * 1024
  };
  const handler = createApp({ db, config });
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    db,
    config,
    directory,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      closeDatabase(db);
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}

function createClient(baseUrl) {
  let cookie = "";
  async function request(pathname, { method = "GET", body, headers = {}, useCookie = true } = {}) {
    const requestHeaders = { ...headers };
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";
    if (useCookie && cookie) requestHeaders.Cookie = cookie;
    const response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual"
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) cookie = setCookies[0].split(";")[0];
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, headers: response.headers };
  }
  return {
    request,
    get cookie() { return cookie; },
    async login(username, password) {
      const result = await request("/api/auth/login", { method: "POST", body: { username, password } });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      return result.data.user;
    }
  };
}

test("LabFlow API end-to-end", async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  const student = createClient(server.baseUrl);
  const teacher = createClient(server.baseUrl);
  const admin = createClient(server.baseUrl);
  const anonymous = createClient(server.baseUrl);
  let approvedReservationId;
  let repairId;
  let newDeviceId;
  const tomorrow = addDays(dateKey(), 1);

  await t.test("health and static frontend", async () => {
    const health = await anonymous.request("/api/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.status, "ok");
    const page = await fetch(`${server.baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /LabFlow/);
    const csp = page.headers.get("content-security-policy");
    assert.match(csp, /default-src 'self'/);
  });

  await t.test("public device directory exposes effective status", async () => {
    const result = await anonymous.request("/api/public/devices");
    assert.equal(result.status, 200);
    assert.equal(result.data.devices.length, 5);
    assert.equal(result.data.devices.find((device) => device.name === "焊台").status, "maintenance");
  });

  await t.test("authentication rejects bad credentials and protects private routes", async () => {
    const bad = await anonymous.request("/api/auth/login", {
      method: "POST",
      body: { username: "student", password: "wrong-password" }
    });
    assert.equal(bad.status, 401);
    const privateResult = await anonymous.request("/api/devices");
    assert.equal(privateResult.status, 401);
    const user = await student.login("student", "Student@2026");
    assert.equal(user.role, "student");
    const me = await student.request("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.data.user.displayName, "陈同学");
  });

  await t.test("device list supports keyword, room, type and status filters", async () => {
    const result = await student.request(`/api/devices?q=${encodeURIComponent("数字")}&room=${encodeURIComponent("实验楼 A201")}&type=${encodeURIComponent("电子测量")}`);
    assert.equal(result.status, 200);
    assert.equal(result.data.total, 1);
    assert.equal(result.data.items[0].name, "数字示波器");
    assert.deepEqual(result.data.summary, { total: 5, available: 4, reserved: 0, maintenance: 1 });
  });

  await t.test("reservation creation, conflict detection and approval", async () => {
    const created = await student.request("/api/reservations", {
      method: "POST",
      body: { deviceId: 1, date: tomorrow, start: "09:00", end: "10:30" }
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal(created.data.reservation.status, "pending");
    approvedReservationId = created.data.reservation.id;

    const conflict = await student.request("/api/reservations", {
      method: "POST",
      body: { deviceId: 1, date: tomorrow, start: "10:00", end: "11:00" }
    });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.data.error.code, "RESERVATION_CONFLICT");

    const availability = await student.request(`/api/devices/1/availability?date=${tomorrow}&start=09:00&end=10:30`);
    assert.equal(availability.status, 200);
    assert.equal(availability.data.available, false);

    await teacher.login("teacher", "Teacher@2026");
    const pending = await teacher.request("/api/reservations?status=pending");
    assert.equal(pending.data.items.length, 1);
    const reviewed = await teacher.request(`/api/reservations/${approvedReservationId}/review`, {
      method: "POST",
      body: { decision: "approved" }
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.data.reservation.status, "approved");

    const notifications = await student.request("/api/notifications");
    assert.equal(notifications.data.items[0].type, "reservation_approved");
    assert.equal(notifications.data.unreadCount, 1);
  });

  await t.test("student can cancel a pending booking and the slot is released", async () => {
    const created = await student.request("/api/reservations", {
      method: "POST",
      body: { deviceId: 4, date: tomorrow, start: "11:00", end: "12:00" }
    });
    assert.equal(created.status, 201);
    const id = created.data.reservation.id;
    const cancelled = await student.request(`/api/reservations/${id}/cancel`, { method: "POST" });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.data.reservation.status, "cancelled");
    const availability = await student.request(`/api/devices/4/availability?date=${tomorrow}&start=11:00&end=12:00`);
    assert.equal(availability.data.available, true);
  });

  await t.test("approved reservation cannot be cancelled inside the cutoff window", async () => {
    const now = Date.now();
    const parts = localParts(now + 10 * 60_000, server.config.utcOffsetMinutes);
    const pad = (value) => String(value).padStart(2, "0");
    const localDate = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    const start = `${pad(parts.hour)}:${pad(parts.minute)}`;
    const endParts = localParts(now + 70 * 60_000, server.config.utcOffsetMinutes);
    const end = `${pad(endParts.hour)}:${pad(endParts.minute)}`;
    server.db.prepare("UPDATE reservations SET date = ?, start_time = ?, end_time = ? WHERE id = ?")
      .run(localDate, start, end, approvedReservationId);
    const blocked = await student.request(`/api/reservations/${approvedReservationId}/cancel`, { method: "POST" });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.data.error.code, "CANCEL_WINDOW_CLOSED");
  });

  await t.test("repair workflow stores photos, updates device state and notifies the student", async () => {
    const created = await student.request("/api/repairs", {
      method: "POST",
      body: {
        deviceId: 2,
        title: "电源无输出",
        description: "开机后指示灯不亮",
        photos: [{ name: "fault.png", type: "image/png", data: PNG_DATA_URL }]
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    repairId = created.data.repair.id;
    assert.equal(created.data.repair.photos.length, 1);

    const photo = await fetch(`${server.baseUrl}${created.data.repair.photos[0].url}`, {
      headers: { Cookie: student.cookie }
    });
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get("content-type"), "image/png");

    const tooMany = await student.request("/api/repairs", {
      method: "POST",
      body: {
        deviceId: 2,
        title: "多图测试",
        description: "四张图片应当被拒绝",
        photos: Array.from({ length: 4 }, (_, index) => ({ name: `p${index}.png`, type: "image/png", data: PNG_DATA_URL }))
      }
    });
    assert.equal(tooMany.status, 400);
    assert.equal(tooMany.data.error.code, "TOO_MANY_PHOTOS");

    const started = await teacher.request(`/api/repairs/${repairId}/start`, { method: "POST" });
    assert.equal(started.status, 200);
    assert.equal(started.data.repair.status, "processing");
    let device = await teacher.request("/api/devices/2");
    assert.equal(device.data.device.status, "maintenance");

    const completed = await teacher.request(`/api/repairs/${repairId}/complete`, { method: "POST" });
    assert.equal(completed.status, 200);
    assert.equal(completed.data.repair.status, "completed");
    device = await teacher.request("/api/devices/2");
    assert.equal(device.data.device.status, "available");

    const notifications = await student.request("/api/notifications");
    assert.ok(notifications.data.items.some((item) => item.type === "repair_completed"));
  });

  await t.test("equipment management enforces roles, snapshot updates and delete protection", async () => {
    const forbidden = await student.request("/api/devices", {
      method: "POST",
      body: { name: "越权设备", room: "实验楼 C101", type: "其他", description: "不应创建" }
    });
    assert.equal(forbidden.status, 403);

    const created = await teacher.request("/api/devices", {
      method: "POST",
      body: { name: "逻辑分析仪", room: "实验楼 C101", type: "电子测量", description: "用于数字信号分析" }
    });
    assert.equal(created.status, 201);
    newDeviceId = created.data.device.id;

    const booking = await student.request("/api/reservations", {
      method: "POST",
      body: { deviceId: newDeviceId, date: tomorrow, start: "14:00", end: "15:00" }
    });
    assert.equal(booking.status, 201);
    const bookingId = booking.data.reservation.id;

    const renamed = await teacher.request(`/api/devices/${newDeviceId}`, {
      method: "PATCH",
      body: { name: "逻辑分析仪 Pro" }
    });
    assert.equal(renamed.status, 200);
    const updatedBooking = await teacher.request(`/api/reservations/${bookingId}`);
    assert.equal(updatedBooking.data.reservation.deviceName, "逻辑分析仪 Pro");

    const blockedDelete = await teacher.request(`/api/devices/${newDeviceId}`, { method: "DELETE" });
    assert.equal(blockedDelete.status, 409);
    assert.equal(blockedDelete.data.error.code, "DEVICE_IN_USE");

    await student.request(`/api/reservations/${bookingId}/cancel`, { method: "POST" });
    const deleted = await teacher.request(`/api/devices/${newDeviceId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    const historical = await teacher.request(`/api/reservations/${bookingId}`);
    assert.equal(historical.data.reservation.deviceId, null);
    assert.equal(historical.data.reservation.deviceName, "逻辑分析仪 Pro");
  });

  await t.test("administrator can manage users and the last admin is protected", async () => {
    await admin.login("admin", "Admin@2026");
    const users = await admin.request("/api/users");
    assert.equal(users.status, 200);
    assert.ok(users.data.items.length >= 3);

    const created = await admin.request("/api/users", {
      method: "POST",
      body: {
        username: "student2",
        displayName: "王同学",
        role: "student",
        password: "Student2@2026"
      }
    });
    assert.equal(created.status, 201);
    const otherStudent = createClient(server.baseUrl);
    await otherStudent.login("student2", "Student2@2026");
    const photoDenied = await fetch(`${server.baseUrl}/api/repairs/${repairId}/photos/${(await teacher.request(`/api/repairs/${repairId}`)).data.repair.photos[0].id}`, {
      headers: { Cookie: otherStudent.cookie }
    });
    assert.equal(photoDenied.status, 403);

    const adminRow = users.data.items.find((user) => user.username === "admin");
    const demote = await admin.request(`/api/users/${adminRow.id}`, {
      method: "PATCH",
      body: { role: "student" }
    });
    assert.equal(demote.status, 409);
    assert.equal(demote.data.error.code, "LAST_ADMIN");
  });

  await t.test("teacher stats expose weekly utilization and peak hours", async () => {
    const stats = await teacher.request("/api/stats/overview?days=7");
    assert.equal(stats.status, 200);
    assert.equal(stats.data.devices.total, 5);
    assert.ok(stats.data.weekly.daily.length === 7);
    assert.ok(Array.isArray(stats.data.weekly.peakHours));
  });

  await t.test("scheduler creates a 15-minute reservation reminder", async () => {
    server.db.prepare("UPDATE reservations SET reminder_sent = 0 WHERE id = ?").run(approvedReservationId);
    runReminderScan(server.db, server.config);
    const notifications = await student.request("/api/notifications?limit=100");
    assert.ok(notifications.data.items.some((item) => item.type === "reservation_reminder"));
  });

  await t.test("notifications can be marked read and logout invalidates the session", async () => {
    const list = await student.request("/api/notifications");
    const unread = list.data.items.find((item) => !item.readAt);
    if (unread) {
      const marked = await student.request(`/api/notifications/${unread.id}/read`, { method: "POST" });
      assert.equal(marked.status, 200);
    }
    const loggedOut = await student.request("/api/auth/logout", { method: "POST" });
    assert.equal(loggedOut.status, 204);
    const me = await student.request("/api/auth/me");
    assert.equal(me.status, 401);
  });
});
