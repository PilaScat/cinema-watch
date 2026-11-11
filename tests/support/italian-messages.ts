import { beforeEach } from "vitest";
import { setMessageLocale } from "../../src/i18n/messages.js";

beforeEach(() => {
  setMessageLocale("it");
});
