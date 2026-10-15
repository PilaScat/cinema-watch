import { seatState } from "./seats.js";
import type {
  Hall,
  HallLabels,
  HallRenderOptions,
  Occupancy,
  Seat,
  SeatAnalysis,
  SeatRule,
  SeatState,
  ThemeName,
} from "./types.js";

type PaletteKey = SeatState | "background" | "text" | "muted" | "screen" | "zone";

export const HALL_PALETTE: Record<ThemeName, Record<PaletteKey, string>> = {
  dark: {
    background: "#121014",
    text: "#f4efe6",
    muted: "#9a9087",
    screen: "#e8e0d4",
    free: "#2fbf71",
    sold: "#c0392b",
    blocked: "#7f6f66",
    reserved: "#4b4540",
    accessible: "#3b82f6",
    best: "#f5c518",
    zone: "#f5c518",
  },
  light: {
    background: "#faf7f2",
    text: "#1c1917",
    muted: "#6b625a",
    screen: "#3f3a36",
    free: "#1f9d55",
    sold: "#b91c1c",
    blocked: "#a8a29e",
    reserved: "#d6d3d1",
    accessible: "#2563eb",
    best: "#d4a017",
    zone: "#b8860b",
  },
};

const DARK_TEXT_STATES: Record<ThemeName, SeatState[]> = {
  dark: ["free", "best"],
  light: ["blocked", "reserved", "best"],
};
const DARK_INK = "#121014";
const LIGHT_INK = "#faf7f2";

const CELL = 32;
const GAP = 4;
const PITCH = CELL + GAP;
const MARGIN = 24;
const LETTER_WIDTH = 22;
const MIN_WIDTH = 560;
const HEADER_HEIGHT = 84;
const SCREEN_HEIGHT = 48;
const LEGEND_ROW_HEIGHT = 28;
const LEGEND_COLUMNS = 4;
const LEGEND_STATES = ["free", "sold", "blocked", "reserved", "accessible", "best"] as const;
const TITLE_FONT = "Bebas Neue, sans-serif";
const BODY_FONT = "Barlow, sans-serif";

interface Bounds {
  minRow: number;
  minColumn: number;
  maxColumn: number;
}

interface LegendEntry {
  color: string;
  text: string;
  outline: boolean;
}

export function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function attrs(values: Record<string, string | number>): string {
  return Object.entries(values)
    .map(([name, value]) => `${name}="${escapeXml(String(value))}"`)
    .join(" ");
}

function textElement(
  content: string,
  values: Record<string, string | number>,
): string {
  return `<text ${attrs(values)}>${escapeXml(content)}</text>`;
}

function hallBounds(hall: Hall): Bounds {
  const rows = hall.seats.map((seat) => seat.row);
  const columns = hall.seats.map((seat) => seat.column);
  return {
    minRow: Math.min(...rows),
    minColumn: Math.min(...columns),
    maxColumn: Math.max(...columns),
  };
}

function rowLabels(hall: Hall): Map<number, string> {
  const counts = new Map<number, Map<string, number>>();
  for (const seat of hall.seats) {
    const labels = counts.get(seat.row) ?? new Map<string, number>();
    labels.set(seat.rowLabel, (labels.get(seat.rowLabel) ?? 0) + 1);
    counts.set(seat.row, labels);
  }
  const result = new Map<number, string>();
  for (const [row, labels] of counts) {
    const [top] = [...labels.entries()].sort((a, b) => b[1] - a[1]);
    if (top) result.set(row, top[0]);
  }
  return result;
}

function countStates(hall: Hall, occupancy: Occupancy, rule: SeatRule): Record<SeatState, number> {
  const counts: Record<SeatState, number> = {
    free: 0,
    sold: 0,
    blocked: 0,
    reserved: 0,
    accessible: 0,
    best: 0,
  };
  for (const seat of hall.seats) counts[seatState(seat, occupancy, rule.sellableTypes)]++;
  return counts;
}

function legendEntries(
  labels: HallLabels,
  counts: Record<SeatState, number>,
  analysis: SeatAnalysis,
  palette: Record<PaletteKey, string>,
): LegendEntry[] {
  const bestSeats = new Set(analysis.best.flatMap((group) => group.seatIds)).size;
  const states = LEGEND_STATES.map((state) => ({
    color: palette[state],
    text: `${labels[state]} ${state === "best" ? bestSeats : counts[state]}`,
    outline: false,
  }));
  return [
    ...states,
    { color: palette.zone, text: `${labels.zone} ${analysis.sellableInZone}`, outline: true },
  ];
}

function inkFor(state: SeatState, theme: ThemeName): string {
  return DARK_TEXT_STATES[theme].includes(state) ? DARK_INK : LIGHT_INK;
}

function renderSeat(
  seat: Seat,
  state: SeatState,
  theme: ThemeName,
  bounds: Bounds,
  originX: number,
  originY: number,
): string {
  const palette = HALL_PALETTE[theme];
  const x = originX + (seat.column - bounds.minColumn) * PITCH;
  const y = originY + (seat.row - bounds.minRow) * PITCH;
  const rect = `<rect ${attrs({
    "data-seat": seat.id,
    x,
    y,
    width: CELL,
    height: CELL,
    rx: 6,
    fill: palette[state],
  })}/>`;
  if (seat.number === null) return rect;
  const label = textElement(String(seat.number), {
    x: x + CELL / 2,
    y: y + CELL / 2 + 4.5,
    "text-anchor": "middle",
    "font-family": BODY_FONT,
    "font-size": 13,
    "font-weight": 600,
    fill: inkFor(state, theme),
  });
  return rect + label;
}

function renderZoneOutlines(
  hall: Hall,
  analysis: SeatAnalysis,
  theme: ThemeName,
  bounds: Bounds,
  originX: number,
  originY: number,
): string {
  const zoneIds = new Set(analysis.zoneSeatIds);
  const byRow = new Map<number, number[]>();
  for (const seat of hall.seats) {
    if (!zoneIds.has(seat.id)) continue;
    byRow.set(seat.row, [...(byRow.get(seat.row) ?? []), seat.column]);
  }
  const pad = 3;
  return [...byRow.entries()]
    .map(([row, columns]) => {
      const first = Math.min(...columns);
      const last = Math.max(...columns);
      return `<rect ${attrs({
        x: originX + (first - bounds.minColumn) * PITCH - pad,
        y: originY + (row - bounds.minRow) * PITCH - pad,
        width: (last - first) * PITCH + CELL + pad * 2,
        height: CELL + pad * 2,
        rx: 9,
        fill: "none",
        stroke: HALL_PALETTE[theme].zone,
        "stroke-width": 1.5,
        "stroke-dasharray": "5 3",
      })}/>`;
    })
    .join("");
}

function renderLegend(
  entries: LegendEntry[],
  theme: ThemeName,
  width: number,
  top: number,
): string {
  const palette = HALL_PALETTE[theme];
  const columnWidth = (width - MARGIN * 2) / LEGEND_COLUMNS;
  return entries
    .map((entry, index) => {
      const x = MARGIN + (index % LEGEND_COLUMNS) * columnWidth;
      const y = top + Math.floor(index / LEGEND_COLUMNS) * LEGEND_ROW_HEIGHT;
      const swatch: Record<string, string | number> = entry.outline
        ? { fill: "none", stroke: entry.color, "stroke-width": 1.5, "stroke-dasharray": "4 2" }
        : { fill: entry.color };
      return (
        `<rect ${attrs({ x, y, width: 16, height: 16, rx: 4, ...swatch })}/>` +
        textElement(entry.text, {
          x: x + 24,
          y: y + 13,
          "font-family": BODY_FONT,
          "font-size": 14,
          fill: palette.text,
        })
      );
    })
    .join("");
}

function renderScreen(
  label: string,
  theme: ThemeName,
  width: number,
  top: number,
  gridWidth: number,
): string {
  const palette = HALL_PALETTE[theme];
  const left = (width - gridWidth) / 2;
  const right = left + gridWidth;
  const arc = `<path ${attrs({
    d: `M ${left} ${top + 22} Q ${width / 2} ${top - 8} ${right} ${top + 22}`,
    fill: "none",
    stroke: palette.screen,
    "stroke-width": 5,
    "stroke-linecap": "round",
  })}/>`;
  const caption = textElement(label, {
    x: width / 2,
    y: top + 42,
    "text-anchor": "middle",
    "font-family": BODY_FONT,
    "font-size": 12,
    "font-weight": 600,
    "letter-spacing": 3,
    fill: palette.muted,
  });
  return arc + caption;
}

function renderRowLetters(
  labels: Map<number, string>,
  theme: ThemeName,
  bounds: Bounds,
  gridLeft: number,
  gridRight: number,
  originY: number,
): string {
  const palette = HALL_PALETTE[theme];
  return [...labels.entries()]
    .map(([row, label]) => {
      const y = originY + (row - bounds.minRow) * PITCH + CELL / 2 + 5;
      const common = {
        y,
        "text-anchor": "middle",
        "font-family": BODY_FONT,
        "font-size": 15,
        "font-weight": 700,
        fill: palette.muted,
      };
      return (
        textElement(label, { ...common, x: gridLeft - LETTER_WIDTH / 2 - 4 }) +
        textElement(label, { ...common, x: gridRight + LETTER_WIDTH / 2 + 4 })
      );
    })
    .join("");
}

export function renderHallSvg(
  hall: Hall,
  occupancy: Occupancy,
  analysis: SeatAnalysis,
  rule: SeatRule,
  options: HallRenderOptions,
): string {
  const { theme, labels } = options;
  const palette = HALL_PALETTE[theme];
  const bounds = hallBounds(hall);
  const columns = bounds.maxColumn - bounds.minColumn + 1;
  const rowCount = Math.max(...hall.seats.map((seat) => seat.row)) - bounds.minRow + 1;
  const gridWidth = columns * PITCH - GAP;
  const gridHeight = rowCount * PITCH - GAP;
  const width = Math.max(MIN_WIDTH, gridWidth + (MARGIN + LETTER_WIDTH + 8) * 2);
  const originX = (width - gridWidth) / 2;
  const screenTop = HEADER_HEIGHT;
  const originY = screenTop + SCREEN_HEIGHT + 16;
  const legendTop = originY + gridHeight + 28;
  const legendRows = Math.ceil((LEGEND_STATES.length + 1) / LEGEND_COLUMNS);
  const height = legendTop + legendRows * LEGEND_ROW_HEIGHT + MARGIN - 8;
  const bestIds = new Set(analysis.best.flatMap((group) => group.seatIds));
  const counts = countStates(hall, occupancy, rule);
  const seats = hall.seats
    .map((seat) => {
      const base = seatState(seat, occupancy, rule.sellableTypes);
      const state = bestIds.has(seat.id) && base === "free" ? "best" : base;
      return renderSeat(seat, state, theme, bounds, originX, originY);
    })
    .join("");
  const parts = [
    `<svg ${attrs({
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
    })}>`,
    `<rect ${attrs({ width, height, fill: palette.background })}/>`,
    textElement(options.title, {
      x: MARGIN,
      y: 40,
      "font-family": TITLE_FONT,
      "font-size": 34,
      fill: palette.text,
    }),
    textElement(options.subtitle, {
      x: MARGIN,
      y: 64,
      "font-family": BODY_FONT,
      "font-size": 15,
      fill: palette.muted,
    }),
    renderScreen(labels.screen, theme, width, screenTop, gridWidth),
    renderRowLetters(rowLabels(hall), theme, bounds, originX, originX + gridWidth, originY),
    seats,
    renderZoneOutlines(hall, analysis, theme, bounds, originX, originY),
    renderLegend(legendEntries(labels, counts, analysis, palette), theme, width, legendTop),
    "</svg>",
  ];
  return parts.join("");
}
