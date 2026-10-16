import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = join(root, "node_modules", "lucide-static", "icons");
const names = [
  "arrow-left",
  "armchair",
  "bell",
  "bell-off",
  "check",
  "circle-alert",
  "clock",
  "download",
  "external-link",
  "film",
  "loader-circle",
  "log-in",
  "map-pin",
  "monitor",
  "moon",
  "pencil",
  "plus",
  "refresh-cw",
  "scroll-text",
  "search",
  "send",
  "settings",
  "sun",
  "ticket",
  "trash-2",
  "upload",
];

function body(svg) {
  return svg
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function key(name) {
  return name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

const entries = names.map((name) => `  ${key(name)}: ${JSON.stringify(body(readFileSync(join(source, `${name}.svg`), "utf8")))},`);
const output = `export const iconSet = {\n${entries.join("\n")}\n} as const;\n\nexport type IconName = keyof typeof iconSet;\n`;
writeFileSync(join(root, "src", "web", "icon-set.ts"), output);
console.log(`${names.length} icone`);
