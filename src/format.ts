import { INTL_LOCALES, type Locale } from "./i18n/index.js";
import type { PriceTier, SeatGroup } from "./types.js";

const TIME_ZONE = "Europe/Rome";

export interface Formatters {
  eur: (amount: number) => string;
  day: (isoDay: string) => string;
  dayOf: (epochMs: number) => string;
  dayTime: (epochMs: number) => string;
  dayLong: (isoDay: string) => string;
  time: (epochMs: number) => string;
  tier: (tier: PriceTier) => string;
}

function noonOf(isoDay: string): Date {
  return new Date(`${isoDay}T12:00:00Z`);
}

function formattersOf(locale: Locale): Formatters {
  const tag = INTL_LOCALES[locale];
  const eurFormat = new Intl.NumberFormat(tag, { style: "currency", currency: "EUR" });
  const shortDayFormat = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit" });
  const longDayFormat = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
  const timeFormat = new Intl.DateTimeFormat(tag, { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const shortDay = (date: Date): string => {
    const picked: Record<string, string> = Object.fromEntries(shortDayFormat.formatToParts(date).map((part) => [part.type, part.value]));
    return `${picked["weekday"]} ${picked["day"]}/${picked["month"]}`;
  };
  const eur = (amount: number): string => eurFormat.format(amount);
  const dayOf = (epochMs: number): string => shortDay(new Date(epochMs));
  const time = (epochMs: number): string => timeFormat.format(new Date(epochMs));
  return {
    eur,
    day: (isoDay) => shortDay(noonOf(isoDay)),
    dayOf,
    dayTime: (epochMs) => `${dayOf(epochMs)} ${time(epochMs)}`,
    dayLong: (isoDay) => longDayFormat.format(noonOf(isoDay)),
    time,
    tier: (tier) => (tier.name === "" ? eur(tier.price) : `${tier.name} ${eur(tier.price)}`),
  };
}

const built: Record<Locale, Formatters> = { en: formattersOf("en"), it: formattersOf("it") };

export function formatters(locale: Locale): Formatters {
  return built[locale];
}

export const formatEur = built.it.eur;
export const formatDay = built.it.day;
export const formatDayOf = built.it.dayOf;
export const formatDayTime = built.it.dayTime;
export const formatTier = built.it.tier;
export const formatDayLong = built.it.dayLong;
export const formatTime = built.it.time;

export function formatGroup(group: SeatGroup): string {
  const numbers = (group.numbers ?? group.seatIds.map((id) => (id.includes("/") ? Number(id.slice(id.lastIndexOf("/") + 1)) : Number.NaN)))
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
