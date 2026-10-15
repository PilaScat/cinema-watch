import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

export const FONT_DIR = fileURLToPath(new URL("../assets/fonts/", import.meta.url));

const FONT_FILES = [
  "Barlow-Regular.ttf",
  "Barlow-SemiBold.ttf",
  "Barlow-Bold.ttf",
  "BebasNeue-Regular.ttf",
];
const DEFAULT_SCALE = 2;
const DEFAULT_FONT_FAMILY = "Barlow";

export interface SvgToPngOptions {
  scale?: number;
  fontDir?: string;
}

export function svgToPng(svg: string, options: SvgToPngOptions = {}): Buffer {
  const fontDir = options.fontDir ?? FONT_DIR;
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: FONT_FILES.map((file) => join(fontDir, file)),
      loadSystemFonts: false,
      defaultFontFamily: DEFAULT_FONT_FAMILY,
    },
    fitTo: { mode: "zoom", value: options.scale ?? DEFAULT_SCALE },
  });
  return resvg.render().asPng();
}
