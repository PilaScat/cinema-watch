import type { SeatGroup } from "./types.js";

const TIME_ZONE = "Europe/Rome";

const eurFormatter = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });

const shortDayFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

const longDayFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

function noonOf(isoDay: string): Date {
  return new Date(`${isoDay}T12:00:00Z`);
}

export function formatEur(amount: number): string {
  return eurFormatter.format(amount);
}

export function formatDay(isoDay: string): string {
  const parts = shortDayFormatter.formatToParts(noonOf(isoDay));
  const picked: Record<string, string> = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${picked["weekday"]} ${picked["day"]}/${picked["month"]}`;
}

export function formatDayLong(isoDay: string): string {
  return longDayFormatter.format(noonOf(isoDay));
}

export function formatGroup(group: SeatGroup): string {
  const numbers = group.seatIds
    .map((id) => Number(id.split("/")[1]))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  if (first === undefined || last === undefined) return group.rowLabel;
  return first === last ? `${group.rowLabel} ${first}` : `${group.rowLabel} ${first}-${last}`;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const timeFormatter = new Intl.DateTimeFormat("it-IT", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatTime(epochMs: number): string {
  return timeFormatter.format(new Date(epochMs));
}
