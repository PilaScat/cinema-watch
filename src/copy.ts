import { copyFor, FALLBACK_LOCALE, type Copy } from "./i18n/index.js";
import { messageLocale } from "./i18n/messages.js";

export const copy: Copy = new Proxy(copyFor(FALLBACK_LOCALE), {
  get: (_fallback, key) => Reflect.get(copyFor(messageLocale()), key) as unknown,
});
