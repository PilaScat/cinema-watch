import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = fileURLToPath(new URL("..", import.meta.url));
const assets = join(root, "assets");
const out = join(assets, "icons");
const fontFiles = ["Barlow-Regular.ttf", "Barlow-SemiBold.ttf", "BebasNeue-Regular.ttf"].map((file) => join(assets, "fonts", file));
const logo = readFileSync(join(assets, "logo.svg"), "utf8");
const inner = logo.replace(/^[\s\S]*?<rect[^>]*\/>/, "").replace(/<\/svg>\s*$/, "");

function render(svg, width) {
  return new Resvg(svg, {
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: "Barlow" },
    fitTo: { mode: "width", value: width },
  })
    .render()
    .asPng();
}

function maskable() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#121014"/><g transform="translate(51 51) scale(0.8)">${inner}</g></svg>`;
}

function social() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 640" width="1280" height="640">
  <rect width="1280" height="640" fill="#121014"/>
  <g transform="translate(96 128) scale(0.75)">${logo.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</g>
  <text x="560" y="300" font-family="Bebas Neue" font-size="132" fill="#f4efe6">cinema-watch</text>
  <text x="564" y="372" font-family="Barlow" font-weight="600" font-size="36" fill="#f5c518">Cacce ai biglietti UCI Cinemas</text>
  <text x="564" y="424" font-family="Barlow" font-size="30" fill="#9a9087">Avvisi su Telegram con la pianta della sala</text>
</svg>`;
}

mkdirSync(out, { recursive: true });
const outputs = [
  ["favicon-32.png", render(logo, 32)],
  ["apple-touch-icon.png", render(logo, 180)],
  ["icon-192.png", render(logo, 192)],
  ["icon-512.png", render(logo, 512)],
  ["icon-maskable-512.png", render(maskable(), 512)],
  ["social-1280x640.png", render(social(), 1280)],
];
for (const [name, png] of outputs) {
  writeFileSync(join(out, name), png);
  console.log(`${name} ${png.length} byte`);
}
