import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const webDir = fileURLToPath(new URL("../src/web/", import.meta.url));
const pages = ["", "parts", "routes"].flatMap((folder) =>
  readdirSync(join(webDir, folder))
    .filter((name) => name.endsWith(".tsx") && name !== "components.tsx")
    .map((name) => ({ name: join(folder, name), text: readFileSync(join(webDir, folder, name), "utf8") })),
);

const SHARED_STYLES: Array<[string, RegExp]> = [
  ["text link", /text-primary hover:underline/],
  ["rows of a list", /divide-y/],
  ["tile that is a link", /hover:border-primary/],
  ["title in the display font", /font-display/],
  ["filter form", /mb-6 flex flex-wrap items-end/],
  ["bordered tile", /rounded-xl border border-border bg-surface/],
];

describe("style of the pages", () => {
  it.each(SHARED_STYLES)("takes the %s from the components, not from classes written again", (_name, pattern) => {
    expect(pages.length).toBeGreaterThan(8);
    expect(pages.filter(({ text }) => pattern.test(text)).map(({ name }) => name)).toEqual([]);
  });
});
