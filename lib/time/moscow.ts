export const CRM_TIME_ZONE = "Europe/Moscow";
const MOSCOW_OFFSET = "+03:00";
const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

export type TimeInput = Date | string | number;

function asInstant(value: TimeInput) {
  if (typeof value === "string" && dateKeyPattern.test(value)) {
    return new Date(`${value}T12:00:00${MOSCOW_OFFSET}`);
  }
  return value instanceof Date ? value : new Date(value);
}

export function moscowDateKey(value: TimeInput = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CRM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(asInstant(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetweenCalendarDates(from: string, to: string) {
  const fromMs = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const toMs = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.floor((toMs - fromMs) / 86_400_000);
}

export function moscowWeekStartDateKey(value: TimeInput = new Date()) {
  const key = moscowDateKey(value);
  const weekday = new Date(`${key}T00:00:00Z`).getUTCDay() || 7;
  return addCalendarDays(key, 1 - weekday);
}

export function moscowMonthStartDateKey(value: TimeInput = new Date()) {
  return `${moscowDateKey(value).slice(0, 7)}-01`;
}

export function moscowMonthEndDateKey(value: TimeInput = new Date()) {
  const start = new Date(`${moscowMonthStartDateKey(value)}T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() + 1);
  start.setUTCDate(0);
  return start.toISOString().slice(0, 10);
}

export function moscowStartOfDayIso(value: TimeInput = new Date()) {
  return new Date(`${moscowDateKey(value)}T00:00:00${MOSCOW_OFFSET}`).toISOString();
}

export function moscowDateTimeIso(dateKey: string, time = "00:00") {
  const normalizedTime = /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
  return new Date(`${dateKey.slice(0, 10)}T${normalizedTime}${MOSCOW_OFFSET}`).toISOString();
}

export function formatMoscowDate(value: TimeInput, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: CRM_TIME_ZONE }).format(asInstant(value));
}

export function nowUtcIso() {
  return new Date().toISOString();
}
