import { escapeHtml } from "./format.js";
import type { HistoryPoint } from "./history.js";

export interface TrendOptions {
  width: number;
  height: number;
  labels: { free: string; freeGood: string; time: (t: number) => string };
}

const MARGIN = { top: 12, right: 44, bottom: 28, left: 40 };
const TICK_TARGET = 4;
const LABEL_GAP = 14;
const DOT_RADIUS = 4;
const LINE_WIDTH = 2;
const FONT_SIZE = 12;

function num(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function niceStep(max: number): number {
  const raw = Math.max(max, 1) / TICK_TARGET;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const factor = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Math.max(1, factor * magnitude);
}

function textAt(x: number, y: number, anchor: "start" | "middle" | "end", content: string, weight?: number): string {
  const bold = weight === undefined ? "" : ` font-weight="${weight}"`;
  return `<text x="${num(x)}" y="${num(y)}" dy="0.32em" text-anchor="${anchor}" class="chart-axis" font-size="${FONT_SIZE}"${bold}>${escapeHtml(content)}</text>`;
}

function separate(first: number, second: number): [number, number] {
  if (Math.abs(first - second) >= LABEL_GAP) return [first, second];
  return first <= second ? [first, first + LABEL_GAP] : [second + LABEL_GAP, second];
}

export function renderTrendSvg(points: HistoryPoint[], options: TrendOptions): string {
  const { width, height, labels } = options;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const plotWidth = width - MARGIN.left - MARGIN.right;
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const peak = sorted.reduce((max, point) => Math.max(max, point.free, point.freeGood), 0);
  const step = niceStep(peak);
  const yMax = step * Math.max(1, Math.ceil(peak / step));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const tMin = first?.t ?? 0;
  const span = (last?.t ?? 0) - tMin;
  const xOf = (t: number): number => (span === 0 ? MARGIN.left + plotWidth / 2 : MARGIN.left + ((t - tMin) / span) * plotWidth);
  const yOf = (value: number): number => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  const bottom = MARGIN.top + plotHeight;
  const right = MARGIN.left + plotWidth;

  const grid: string[] = [];
  for (let value = 0; value <= yMax; value += step) {
    const y = yOf(value);
    grid.push(`<line x1="${MARGIN.left}" x2="${right}" y1="${num(y)}" y2="${num(y)}" class="chart-grid" stroke-width="1"/>`);
    grid.push(textAt(MARGIN.left - 8, y, "end", String(value)));
  }

  const axisX: string[] = [];
  if (first && last) {
    if (span === 0) axisX.push(textAt(xOf(first.t), bottom + 16, "middle", labels.time(first.t)));
    else {
      axisX.push(textAt(MARGIN.left, bottom + 16, "start", labels.time(first.t)));
      axisX.push(textAt(right, bottom + 16, "end", labels.time(last.t)));
    }
  }

  const line = (pick: (point: HistoryPoint) => number, index: 1 | 2): string =>
    `<polyline points="${sorted.map((point) => `${num(xOf(point.t))},${num(yOf(pick(point)))}`).join(" ")}" fill="none" stroke-width="${LINE_WIDTH}" stroke-linejoin="round" stroke-linecap="round" class="chart-line-${index}"/>`;

  const ending: string[] = [];
  if (last) {
    const x = xOf(last.t);
    ending.push(`<circle cx="${num(x)}" cy="${num(yOf(last.free))}" r="${DOT_RADIUS}" stroke-width="2" class="chart-dot-1"/>`);
    ending.push(`<circle cx="${num(x)}" cy="${num(yOf(last.freeGood))}" r="${DOT_RADIUS}" stroke-width="2" class="chart-dot-2"/>`);
    const [freeY, goodY] = separate(yOf(last.free), yOf(last.freeGood));
    ending.push(textAt(x + DOT_RADIUS + 6, freeY, "start", String(last.free), 600));
    ending.push(textAt(x + DOT_RADIUS + 6, goodY, "start", String(last.freeGood), 600));
  }

  const hover = sorted.map((point, index) => {
    const x = xOf(point.t);
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const from = previous ? (xOf(previous.t) + x) / 2 : MARGIN.left;
    const to = next ? (xOf(next.t) + x) / 2 : right;
    return `<rect x="${num(from)}" y="${MARGIN.top}" width="${num(Math.max(to - from, 1))}" height="${num(plotHeight)}" fill="transparent" data-t="${point.t}" data-free="${point.free}" data-good="${point.freeGood}"/>`;
  });

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(`${labels.free}, ${labels.freeGood}`)}">`,
    ...grid,
    ...axisX,
    line((point) => point.free, 1),
    line((point) => point.freeGood, 2),
    ...ending,
    ...hover,
    "</svg>",
  ].join("");
}
