import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { hashPassword } from "./security.js";
import { timestampNow } from "./time.js";

const schemaSql = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function createDatabase(filePath = config.dbPath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(schemaSql);
  return db;
}

export function withTransaction(db, operation) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = operation();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // The original error is more useful than a failed rollback.
    }
    throw error;
  }
}

function insertUser(db, { username, displayName, role, passwordHash, email = null }) {
  const now = timestampNow();
  db.prepare(`
    INSERT INTO users (username, display_name, role, password_hash, email, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(username, displayName, role, passwordHash, email, now, now);
}

export async function seedDatabase(db, { demoAccounts = config.demoAccounts } = {}) {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  if (userCount === 0) {
    const hashes = await Promise.all([
      hashPassword(demoAccounts.student.password),
      hashPassword(demoAccounts.teacher.password),
      hashPassword(demoAccounts.admin.password)
    ]);
    withTransaction(db, () => {
      insertUser(db, {
        username: demoAccounts.student.username,
        displayName: demoAccounts.student.displayName,
        role: "student",
        passwordHash: hashes[0]
      });
      insertUser(db, {
        username: demoAccounts.teacher.username,
        displayName: demoAccounts.teacher.displayName,
        role: "teacher",
        passwordHash: hashes[1],
        email: "teacher@example.edu.cn"
      });
      insertUser(db, {
        username: demoAccounts.admin.username,
        displayName: demoAccounts.admin.displayName,
        role: "admin",
        passwordHash: hashes[2]
      });
    });
  }

  const deviceCount = db.prepare("SELECT COUNT(*) AS count FROM devices").get().count;
  if (deviceCount === 0) {
    const now = timestampNow();
    const devices = [
      ["数字示波器", "实验楼 A201", "电子测量", "available", "用于测量和观察电子信号"],
      ["直流稳压电源", "实验楼 A201", "电源设备", "available", "为电子实验提供稳定电源"],
      ["焊台", "实验楼 B102", "焊接设备", "maintenance", "用于电子元器件焊接"],
      ["信号发生器", "实验楼 A203", "信号源", "available", "用于产生测试信号"],
      ["数字万用表", "实验楼 B105", "电子测量", "available", "用于测量电压、电流和电阻"]
    ];
    const statement = db.prepare(`
      INSERT INTO devices (name, room, type, status, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    withTransaction(db, () => {
      for (const device of devices) statement.run(...device, now, now);
    });
  }
}

export function closeDatabase(db) {
  try {
    db.close();
  } catch {
    // Already closed.
  }
}
