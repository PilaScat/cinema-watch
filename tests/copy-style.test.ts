import { describe, expect, it } from "vitest";
import { copy } from "../src/copy.js";

const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_ALL = /\p{Extended_Pictographic}/gu;
const EMOJI_KEYS = new Set(["telegram.huntHeader", "telegram.digest.header", "telegram.noNews.header", "errors.huntFailed"]);

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
  it("has no exclamation marks and emoji only in the allowed headers", () => {
    expect(violations(copy)).toEqual([]);
  });

  it("reaches the allowed emoji keys", () => {
    const paths = collect(copy, "", []).map(([path]) => path);
    for (const key of EMOJI_KEYS) expect(paths).toContain(key);
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
