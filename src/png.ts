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
export const TELEGRAM_PHOTO_WIDTH = 1280;
const DEFAULT_FONT_FAMILY = "Barlow";

export interface SvgToPngOptions {
  scale?: number;
  width?: number;
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
    fitTo: options.width === undefined ? { mode: "zoom", value: options.scale ?? DEFAULT_SCALE } : { mode: "width", value: options.width },
  });
  return resvg.render().asPng();
}
