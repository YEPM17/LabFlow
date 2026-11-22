import { addDays, dateKey, timeToMinutes } from "../time.js";
import { deviceSummary } from "./devices.js";

function countByStatus(db, table) {
  const rows = db.prepare(`SELECT status, COUNT(*) AS count FROM ${table} GROUP BY status`).all();
  const result = { total: 0 };
  for (const row of rows) {
    result[row.status] = Number(row.count);
    result.total += Number(row.count);
  }
  return result;
}

export function overviewStats(db, query, config) {
  const days = Math.min(90, Math.max(1, Number.parseInt(query.days, 10) || 7));
  const endDate = dateKey();
  const startDate = addDays(endDate, -(days - 1));
  const devices = deviceSummary(db);
  const reservations = countByStatus(db, "reservations");
  const repairs = countByStatus(db, "repairs");

  const daily = new Map();
  for (let index = 0; index < days; index += 1) {
    const date = addDays(startDate, index);
    daily.set(date, { date, reservationCount: 0, approvedHours: 0 });
  }

  const rows = db.prepare(`
    SELECT date, start_time, end_time, status
    FROM reservations
    WHERE date >= ? AND date <= ? AND status != 'cancelled'
  `).all(startDate, endDate);

  const peakCounts = new Map();
  let reservationCount = 0;
  let approvedMinutes = 0;
  for (const row of rows) {
    reservationCount += 1;
    const startMinutes = timeToMinutes(row.start_time);
    const endMinutes = timeToMinutes(row.end_time);
    const durationMinutes = Math.max(0, endMinutes - startMinutes);
    const hour = Math.floor(startMinutes / 60);
    peakCounts.set(hour, (peakCounts.get(hour) || 0) + 1);
    const day = daily.get(row.date);
    if (day) day.reservationCount += 1;
    if (row.status === "approved") {
      approvedMinutes += durationMinutes;
      if (day) day.approvedHours += durationMinutes / 60;
    }
  }

  const openMinutesPerDay = Math.max(0, timeToMinutes(config.closeTime) - timeToMinutes(config.openTime));
  const capacityMinutes = devices.total * days * openMinutesPerDay;
  const utilizationRate = capacityMinutes > 0
    ? Math.min(100, Number(((approvedMinutes / capacityMinutes) * 100).toFixed(1)))
    : 0;

  const peakHours = [...peakCounts.entries()]
    .map(([hour, count]) => ({
      hour: `${String(hour).padStart(2, "0")}:00`,
      label: `${String(hour).padStart(2, "0")}:00-${String(hour + 1).padStart(2, "0")}:00`,
      count
    }))
    .sort((a, b) => b.count - a.count || a.hour.localeCompare(b.hour))
    .slice(0, 3);

  const dailyRows = [...daily.values()].map((item) => ({
    ...item,
    approvedHours: Number(item.approvedHours.toFixed(2))
  }));

  return {
    range: { startDate, endDate, days },
    devices,
    reservations,
    repairs,
    weekly: {
      reservationCount,
      approvedHours: Number((approvedMinutes / 60).toFixed(2)),
      utilizationRate,
      peakHours,
      daily: dailyRows
    }
  };
}
