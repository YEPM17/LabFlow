import { atLocal } from "./time.js";
import { createNotification } from "./services/notifications.js";
import { reservationsForReminder } from "./services/reservations.js";

const REMINDER_MINUTES = 15;

export function runReminderScan(db, config) {
  const now = Date.now();
  const rows = reservationsForReminder(db);
  for (const row of rows) {
    const startMs = atLocal(row.date, row.start_time, config.utcOffsetMinutes);
    if (!Number.isFinite(startMs)) continue;
    const minutesUntilStart = (startMs - now) / 60_000;
    if (minutesUntilStart <= 0) {
      db.prepare("UPDATE reservations SET reminder_sent = 1 WHERE id = ?").run(row.id);
      continue;
    }
    if (minutesUntilStart <= REMINDER_MINUTES) {
      createNotification(db, {
        userId: row.student_id,
        type: "reservation_reminder",
        title: "预约即将开始",
        body: `你预约的「${row.device_name_snapshot}」将在 ${row.date} ${row.start_time} 开始，请提前到场。`,
        relatedType: "reservation",
        relatedId: row.id
      });
      db.prepare("UPDATE reservations SET reminder_sent = 1 WHERE id = ?").run(row.id);
    }
  }
}

export function startReminderScheduler(db, config, intervalMs = 30_000) {
  const timer = setInterval(() => {
    try {
      runReminderScan(db, config);
    } catch (error) {
      console.error(`[scheduler] ${error.stack || error}`);
    }
  }, intervalMs);
  timer.unref();
  try {
    runReminderScan(db, config);
  } catch (error) {
    console.error(`[scheduler] ${error.stack || error}`);
  }
  return () => clearInterval(timer);
}
