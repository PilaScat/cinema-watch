import { describe, expect, it } from "vitest";
import { copyFor, LOCALES } from "../src/i18n/index.js";

const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_ALL = /\p{Extended_Pictographic}/gu;
const EMOJI_KEYS = new Set(["telegram.huntHeader", "telegram.digest.header", "telegram.noNews.header", "telegram.test.header", "telegram.archived", "telegram.mutedNotice", "telegram.ticketCaption", "errors.huntFailed"]);

const SHARED = new Set([
  "ui.common.appName",
  "ui.common.theme.system",
  "ui.common.login.password",
  "ui.hunts.fields.movieKind",
  "ui.hunts.formats",
  "ui.theatres.chains.uci",
  "ui.theatres.chains.webtic",
  "ui.theatres.chains.space",
  "ui.theatres.chains.t18",
  "ui.theatres.filterPlaceholder",
  "ui.theatres.luxe",
  "ui.search.resultsTitle",
  "ui.settings.sections.telegram",
  "ui.settings.sections.wallet",
  "ui.settings.fields.walletIssuerId",
  "ui.tickets.fields.title",
  "ui.tickets.fields.theatre",
  "ui.settings.backup.file",
]);

function collect(node: unknown, path: string, out: Array<[string, string]>): Array<[string, string]> {
  if (typeof node === "string") {
    out.push([path, node]);
  } else if (typeof node === "function") {
    const call = node as (...args: unknown[]) => unknown;
    for (const placeholder of ["X", 2]) collect(call(...Array<unknown>(node.length).fill(placeholder)), path, out);
  } else if (typeof node === "object" && node !== null) {
    for (const [key, value] of Object.entries(node)) collect(value, path === "" ? key : `${path}.${key}`, out);
  }
  return out;
}

function violations(root: unknown): string[] {
  const found: string[] = [];
  for (const [path, text] of collect(root, "", [])) {
    if (text.includes("!")) found.push(`${path}: exclamation mark`);
    const count = text.match(EMOJI_ALL)?.length ?? 0;
    if (EMOJI_KEYS.has(path)) {
      if (count !== 1 || !EMOJI.test(text.slice(0, 2))) found.push(`${path}: needs exactly one leading emoji`);
    } else if (count > 0) {
      found.push(`${path}: emoji not allowed`);
    }
  }
  return found;
}

describe("copy style", () => {
  it.each(LOCALES)("has no exclamation marks and emoji only in the allowed headers, in %s", (locale) => {
    expect(violations(copyFor(locale))).toEqual([]);
  });

  it.each(LOCALES)("reaches the allowed emoji keys, in %s", (locale) => {
    const paths = collect(copyFor(locale), "", []).map(([path]) => path);
    for (const key of EMOJI_KEYS) expect(paths).toContain(key);
  });

  it("has no English text left equal to the Italian one, apart from names and words the two languages share", () => {
    const italian = new Map(collect(copyFor("it"), "", []).map(([path, text], index) => [`${path}#${index}`, text]));
    const same = collect(copyFor("en"), "", [])
      .filter(([path, text], index) => italian.get(`${path}#${index}`) === text && /\p{L}{3}/u.test(text.replaceAll(/<\/?b>|X/g, "")))
      .map(([path]) => path);

    expect([...new Set(same)].filter((path) => !SHARED.has(path.replace(/\.\d+$/, "")))).toEqual([]);
  });

  it("has no accented letters in the English text", () => {
    expect(collect(copyFor("en"), "", []).filter(([, text]) => /[àèéìòù]/i.test(text)).map(([path]) => path)).toEqual([]);
  });

  it("flags an exclamation mark", () => {
    expect(violations({ ui: { hello: "Ciao!" } })).toEqual(["ui.hello: exclamation mark"]);
  });

  it("flags an emoji in a key that does not allow it", () => {
    expect(violations({ ui: { hello: "🎬 Ciao" } })).toEqual(["ui.hello: emoji not allowed"]);
  });

  it("flags an allowed key without its emoji or with two", () => {
    expect(violations({ errors: { huntFailed: "senza" }, telegram: { huntHeader: "🎬🎬 due" } })).toEqual([
      "errors.huntFailed: needs exactly one leading emoji",
      "telegram.huntHeader: needs exactly one leading emoji",
    ]);
  });
});
