import type { DayWindow, HhMm, IsoDay } from "./types.js";

const ROME_TIME_ZONE = "Europe/Rome";
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const MS_PER_DAY = 86_400_000;

const romeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: ROME_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function romeParts(now: Date): Record<string, string> {
  const parts: Record<string, string> = {};
  for (const part of romeFormatter.formatToParts(now)) {
    parts[part.type] = part.value;
  }
  return parts;
}

function dayToUtcMs(day: IsoDay): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) {
    throw new RangeError(`Invalid day: ${day}`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcMsToDay(ms: number): IsoDay {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDay(s: string): boolean {
  if (!DAY_PATTERN.test(s)) {
    return false;
  }
  return utcMsToDay(dayToUtcMs(s)) === s;
}

export function isHhMm(s: string): boolean {
  return TIME_PATTERN.test(s);
}

export const MAX_WINDOW_DAYS = 120;

export function addDays(day: IsoDay, n: number): IsoDay {
  return utcMsToDay(dayToUtcMs(day) + n * MS_PER_DAY);
}

export function weekdayOf(day: IsoDay): number {
  const jsDay = new Date(dayToUtcMs(day)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

export function dayRange(from: IsoDay, to: IsoDay): IsoDay[] {
  const days: IsoDay[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

export function romeNow(now: Date): { day: IsoDay; time: HhMm; weekday: number } {
  const p = romeParts(now);
  const day = `${p["year"]}-${p["month"]}-${p["day"]}`;
  return { day, time: `${p["hour"]}:${p["minute"]}`, weekday: weekdayOf(day) };
}

const HOUR_MS = 60 * 60 * 1000;

export function romeMidnight(day: IsoDay): number {
  const utc = dayToUtcMs(day);
  for (const hours of [1, 2]) {
    const at = romeNow(new Date(utc - hours * HOUR_MS));
    if (at.day === day && at.time === "00:00") return utc - hours * HOUR_MS;
  }
  return utc - HOUR_MS;
}

export function romeMidnightsBetween(fromMs: number, toMs: number): number[] {
  const marks: number[] = [];
  for (let day = addDays(romeToday(new Date(fromMs)), 1); day <= romeToday(new Date(toMs)); day = addDays(day, 1)) {
    const at = romeMidnight(day);
    if (at > fromMs && at < toMs) marks.push(at);
  }
  return marks;
}

export function romeToday(now: Date): IsoDay {
  return romeNow(now).day;
}

export function resolveWindow(window: DayWindow, now: Date): IsoDay[] {
  const today = romeToday(now);
  if (window.kind === "fixed") {
    const from = window.from > today ? window.from : today;
    const last = addDays(from, MAX_WINDOW_DAYS - 1);
    return dayRange(from, window.to < last ? window.to : last);
  }
  return dayRange(today, addDays(today, window.days - 1));
}

export function timeInRange(time: HhMm, from?: HhMm, to?: HhMm): boolean {
  if (from !== undefined && from === to) return true;
  if (from !== undefined && to !== undefined && from > to) {
    return time >= from || time <= to;
  }
  return (from === undefined || time >= from) && (to === undefined || time <= to);
}
