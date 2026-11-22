import { config } from "./config.js";

const pad = (value) => String(value).padStart(2, "0");

export function localParts(timestamp = Date.now(), offsetMinutes = config.utcOffsetMinutes) {
  const shifted = new Date(timestamp + offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds()
  };
}

export function dateKey(timestamp = Date.now(), offsetMinutes = config.utcOffsetMinutes) {
  const p = localParts(timestamp, offsetMinutes);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function timeKey(timestamp = Date.now(), offsetMinutes = config.utcOffsetMinutes) {
  const p = localParts(timestamp, offsetMinutes);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function timestampNow(timestamp = Date.now(), offsetMinutes = config.utcOffsetMinutes) {
  const p = localParts(timestamp, offsetMinutes);
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

export function atLocal(date, time, offsetMinutes = config.utcOffsetMinutes) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!dateMatch || !timeMatch) return Number.NaN;
  const [, year, month, day] = dateMatch.map(Number);
  const [, hour, minute] = timeMatch.map(Number);
  return Date.UTC(year, month - 1, day, hour, minute) - offsetMinutes * 60_000;
}

export function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

export function isValidTime(time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return false;
  const [hour, minute] = time.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

export function displayDateTime(date, start, end) {
  return `${date} ${start}-${end}`;
}
