import { ApiError } from "../errors.js";
import {
  atLocal,
  dateKey,
  isValidDate,
  isValidTime,
  timeKey,
  timeToMinutes
} from "../time.js";

export function validateBookingWindow({ date, start, end, config, now = Date.now() }) {
  if (!isValidDate(date)) {
    throw new ApiError(400, "INVALID_DATE", "请选择有效的预约日期");
  }
  if (!isValidTime(start) || !isValidTime(end)) {
    throw new ApiError(400, "INVALID_TIME", "请选择有效的开始和结束时间");
  }

  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const durationMinutes = endMinutes - startMinutes;
  const openMinutes = timeToMinutes(config.openTime);
  const closeMinutes = timeToMinutes(config.closeTime);

  if (startMinutes % 30 !== 0 || endMinutes % 30 !== 0) {
    throw new ApiError(400, "INVALID_TIME_STEP", "预约时间需按 30 分钟为单位选择");
  }
  if (durationMinutes < config.minBookingMinutes) {
    throw new ApiError(400, "SLOT_TOO_SHORT", `单次预约至少 ${config.minBookingMinutes} 分钟`);
  }
  if (durationMinutes > config.maxBookingHours * 60) {
    throw new ApiError(400, "SLOT_TOO_LONG", `单次预约不能超过 ${config.maxBookingHours} 小时`);
  }
  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    throw new ApiError(400, "OUTSIDE_LAB_HOURS", `预约需在实验室开放时间 ${config.openTime}-${config.closeTime} 内`);
  }
  if (date < dateKey(now)) {
    throw new ApiError(400, "DATE_IN_PAST", "不能预约已经过去的日期");
  }

  const startMs = atLocal(date, start, config.utcOffsetMinutes);
  const endMs = atLocal(date, end, config.utcOffsetMinutes);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new ApiError(400, "INVALID_TIME", "预约时间格式无效");
  }
  if (startMs <= now) {
    throw new ApiError(400, "SLOT_IN_PAST", "不能预约已经过去的时段");
  }

  return { startMinutes, endMinutes, durationMinutes, startMs, endMs };
}

export function bookingConstraints(config) {
  return {
    openTime: config.openTime,
    closeTime: config.closeTime,
    minMinutes: config.minBookingMinutes,
    maxHours: config.maxBookingHours,
    cancelCutoffMinutes: config.cancelCutoffMinutes,
    timeStepMinutes: 30,
    currentDate: dateKey(),
    currentTime: timeKey()
  };
}
