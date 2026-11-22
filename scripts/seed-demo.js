import fs from "node:fs";
import { config } from "../src/config.js";
import { closeDatabase, createDatabase, seedDatabase } from "../src/db.js";
import { addDays, dateKey, timestampNow } from "../src/time.js";
import { newId } from "../src/ids.js";
import { mapUser } from "../src/services/users.js";
import { createReservation, reviewReservation } from "../src/services/reservations.js";
import { createRepair } from "../src/services/repairs.js";

async function main() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
  const db = createDatabase(config.dbPath);
  await seedDatabase(db);

  const reservationCount = db.prepare("SELECT COUNT(*) AS count FROM reservations").get().count;
  const repairCount = db.prepare("SELECT COUNT(*) AS count FROM repairs").get().count;
  if (reservationCount > 0 || repairCount > 0) {
    console.log("Demo data already exists; nothing was inserted.");
    closeDatabase(db);
    return;
  }

  const student = mapUser(db.prepare("SELECT * FROM users WHERE username = 'student'").get());
  const teacher = mapUser(db.prepare("SELECT * FROM users WHERE username = 'teacher'").get());
  const devices = db.prepare(`
    SELECT * FROM devices WHERE status = 'available' ORDER BY id LIMIT 3
  `).all();
  if (devices.length < 2) {
    throw new Error("At least two available devices are required for demo data");
  }

  const tomorrow = addDays(dateKey(), 1);
  const approved = createReservation(db, student, {
    deviceId: devices[0].id,
    date: tomorrow,
    start: "09:00",
    end: "10:30"
  }, config);
  reviewReservation(db, teacher, approved.id, { decision: "approved" }, config);

  const pastDevice = devices[2] || devices[0];
  const nowText = timestampNow();
  db.prepare(`
    INSERT INTO reservations
      (id, student_id, device_id, device_name_snapshot, date, start_time, end_time,
       status, reject_reason, reviewed_by, reviewed_at, reminder_sent, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '08:00', '09:30', 'approved', NULL, ?, ?, 1, ?, ?)
  `).run(newId(), student.id, pastDevice.id, pastDevice.name, dateKey(), teacher.id, nowText, nowText, nowText);

  createReservation(db, student, {
    deviceId: devices[1].id,
    date: tomorrow,
    start: "14:00",
    end: "16:00"
  }, config);

  await createRepair(db, student, {
    deviceId: devices[2]?.id || devices[0].id,
    title: "设备按键无响应",
    description: "面板按键按下后没有反馈，重启后仍然存在。",
    photos: []
  }, config);

  console.log("Demo data inserted:");
  console.log(`- historical approved reservation: ${dateKey()} 08:00-09:30`);
  console.log(`- approved reservation: ${tomorrow} 09:00-10:30`);
  console.log(`- pending reservation:  ${tomorrow} 14:00-16:00`);
  console.log("- pending repair report");
  closeDatabase(db);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
