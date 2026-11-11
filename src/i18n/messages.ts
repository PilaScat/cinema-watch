import { FALLBACK_LOCALE, type Locale } from "./index.js";

let current: Locale = FALLBACK_LOCALE;

export function setMessageLocale(locale: Locale): void {
  current = locale;
}

export function messageLocale(): Locale {
  return current;
}
