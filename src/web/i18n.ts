import { AsyncLocalStorage } from "node:async_hooks";
import { formatKm as formatKmIn } from "../distance.js";
import { formatters } from "../format.js";
import { copyFor, FALLBACK_LOCALE, type Copy, type Locale } from "../i18n/index.js";
import type { PriceTier } from "../types.js";

const scope = new AsyncLocalStorage<Locale>();

export function withLocale<T>(locale: Locale, run: () => T): T {
  return scope.run(locale, run);
}

export function currentLocale(): Locale {
  return scope.getStore() ?? FALLBACK_LOCALE;
}

export function localized<T extends object>(pick: (copy: Copy) => T): T {
  return new Proxy(pick(copyFor(FALLBACK_LOCALE)), {
    get: (_fallback, key) => Reflect.get(pick(copyFor(currentLocale())), key) as unknown,
  });
}

export const copy = localized((all) => all);

export const formatEur = (amount: number): string => formatters(currentLocale()).eur(amount);
export const formatDay = (isoDay: string): string => formatters(currentLocale()).day(isoDay);
export const formatDayOf = (epochMs: number): string => formatters(currentLocale()).dayOf(epochMs);
export const formatDayTime = (epochMs: number): string => formatters(currentLocale()).dayTime(epochMs);
export const formatTime = (epochMs: number): string => formatters(currentLocale()).time(epochMs);
export const formatTier = (tier: PriceTier): string => formatters(currentLocale()).tier(tier);
export const formatKm = (km: number): string => formatKmIn(km, currentLocale());
