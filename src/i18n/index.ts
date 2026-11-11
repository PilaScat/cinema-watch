import { en, type Copy } from "./en.js";
import { it } from "./it.js";

export type { Copy };

export const LOCALES = ["en", "it"] as const;
export type Locale = (typeof LOCALES)[number];

export const FALLBACK_LOCALE: Locale = "en";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", it: "Italiano" };
export const INTL_LOCALES: Record<Locale, string> = { en: "en-GB", it: "it-IT" };

const copies: Record<Locale, Copy> = { en, it };

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((locale) => locale === value);
}

export function copyFor(locale: Locale): Copy {
  return copies[locale];
}
