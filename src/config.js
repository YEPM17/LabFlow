import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(srcDir, "..");

try {
  process.loadEnvFile(path.join(rootDir, ".env"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function intEnv(value, fallback, min = Number.MIN_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function pathEnv(value, fallback) {
  if (!value) return path.join(rootDir, fallback);
  return path.isAbsolute(value) ? value : path.join(rootDir, value);
}

export const config = {
  rootDir,
  publicDir: path.join(rootDir, "public"),
  port: intEnv(process.env.PORT, 3000, 1),
  host: process.env.HOST || "127.0.0.1",
  dbPath: pathEnv(process.env.DB_PATH, "data/labflow.db"),
  uploadDir: pathEnv(process.env.UPLOAD_DIR, "data/uploads"),
  logRequests: boolEnv(process.env.LOG_REQUESTS, true),
  trustProxy: boolEnv(process.env.TRUST_PROXY, false),
  cookieName: "labflow_session",
  cookieSecure: boolEnv(process.env.COOKIE_SECURE, false),
  sessionIdleMs: intEnv(process.env.SESSION_IDLE_MINUTES, 30, 1) * 60_000,
  sessionCleanupMs: 30_000,
  utcOffsetMinutes: intEnv(process.env.UTC_OFFSET_MINUTES, 480),
  openTime: process.env.LAB_OPEN_TIME || "08:00",
  closeTime: process.env.LAB_CLOSE_TIME || "22:00",
  minBookingMinutes: intEnv(process.env.MIN_BOOKING_MINUTES, 30, 30),
  maxBookingHours: intEnv(process.env.MAX_BOOKING_HOURS, 4, 1),
  cancelCutoffMinutes: intEnv(process.env.CANCEL_CUTOFF_MINUTES, 30, 0),
  maxBodyBytes: intEnv(process.env.MAX_BODY_MB, 10, 1) * 1024 * 1024,
  maxPhotoBytes: 2 * 1024 * 1024,
  maxRepairPhotos: 3,
  loginRateLimit: { windowMs: 15 * 60_000, maxAttempts: 10 },
  demoAccounts: {
    student: { username: "student", password: "Student@2026", displayName: "陈同学" },
    teacher: { username: "teacher", password: "Teacher@2026", displayName: "林老师" },
    admin: { username: "admin", password: "Admin@2026", displayName: "系统管理员" }
  }
};
