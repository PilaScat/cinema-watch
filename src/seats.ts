import type {
  Hall,
  Occupancy,
  RowSummary,
  Seat,
  SeatAnalysis,
  SeatGroup,
  SeatRule,
  SeatState,
  Zone,
} from "./types.js";

export const DEFAULT_SELLABLE_TYPES = ["STANDARD"];
export const ACCESSIBLE_SECTOR = "UN";

const ACCESSIBLE_TYPE = "DISABILE";
const RESERVED_TYPE = "RISERVATO";
const IDEAL_ROW_PERCENT = 65;
const BEST_COUNT = 3;
const SCORE_DECIMALS = 10_000;

interface RowAxis {
  center: number;
  halfWidth: number;
}

interface HallRow {
  label: string;
  row: number;
  seats: Seat[];
  sellable: Seat[];
}

export function isSellable(seat: Seat, sellableTypes: string[]): boolean {
  return sellableTypes.includes(seat.type) && seat.sector !== ACCESSIBLE_SECTOR;
}

export function seatState(
  seat: Seat,
  occupancy: Occupancy,
  sellableTypes: string[],
): Exclude<SeatState, "best"> {
  if (seat.sector === ACCESSIBLE_SECTOR || seat.type === ACCESSIBLE_TYPE) return "accessible";
  if (!isSellable(seat, sellableTypes)) return "reserved";
  const taken = occupancy.taken[seat.id];
  if (taken === "blocked") return "blocked";
  if (taken !== undefined) return "sold";
  return "free";
}

function buildRows(hall: Hall, sellableTypes: string[]): HallRow[] {
  const byLabel = new Map<string, HallRow>();
  for (const seat of hall.seats) {
    const existing = byLabel.get(seat.rowLabel);
    const row = existing ?? { label: seat.rowLabel, row: seat.row, seats: [], sellable: [] };
    row.row = Math.min(row.row, seat.row);
    row.seats.push(seat);
    if (isSellable(seat, sellableTypes)) row.sellable.push(seat);
    byLabel.set(seat.rowLabel, row);
  }
  return [...byLabel.values()].sort((a, b) => a.row - b.row);
}

function rowAxis(row: HallRow): RowAxis {
  const columns = row.sellable.map((seat) => seat.column);
  const min = Math.min(...columns);
  const max = Math.max(...columns);
  return { center: (min + max) / 2, halfWidth: (max - min) / 2 };
}

function rowPercents(rows: HallRow[]): Map<string, number> {
  const withSellable = rows.filter((row) => row.sellable.length > 0);
  const last = withSellable.length - 1;
  return new Map(
    withSellable.map((row, index) => [row.label, last === 0 ? 50 : (index / last) * 100]),
  );
}

function inZoneRelative(
  seat: Seat,
  zone: Extract<Zone, { kind: "relative" }>,
  percent: number,
  axis: RowAxis,
): boolean {
  if (percent < zone.rowsFromPercent || percent > zone.rowsToPercent) return false;
  return Math.abs(seat.column - axis.center) <= (axis.halfWidth * zone.centerPercent) / 100;
}

function inZoneAbsolute(seat: Seat, zone: Extract<Zone, { kind: "absolute" }>): boolean {
  const label = seat.rowLabel.toLowerCase();
  if (!zone.rows.some((row) => row.toLowerCase() === label)) return false;
  if (seat.number === null) return zone.seatFrom === null && zone.seatTo === null;
  if (zone.seatFrom !== null && seat.number < zone.seatFrom) return false;
  if (zone.seatTo !== null && seat.number > zone.seatTo) return false;
  return true;
}

function zoneIdsFromRows(rows: HallRow[], zone: Zone): Set<string> {
  const ids = new Set<string>();
  const percents = rowPercents(rows);
  for (const row of rows) {
    if (row.sellable.length === 0) continue;
    const axis = rowAxis(row);
    const percent = percents.get(row.label) ?? 50;
    for (const seat of row.sellable) {
      const inside =
        zone.kind === "relative"
          ? inZoneRelative(seat, zone, percent, axis)
          : inZoneAbsolute(seat, zone);
      if (inside) ids.add(seat.id);
    }
  }
  return ids;
}

export function zoneSeatIds(hall: Hall, zone: Zone, sellableTypes: string[]): Set<string> {
  return zoneIdsFromRows(buildRows(hall, sellableTypes), zone);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * SCORE_DECIMALS) / SCORE_DECIMALS;
}

function windowScore(window: Seat[], axis: RowAxis, percent: number): number {
  const mean = window.reduce((sum, seat) => sum + seat.column, 0) / window.length;
  const horizontal =
    axis.halfWidth === 0 ? 0 : clamp01(Math.abs(mean - axis.center) / axis.halfWidth);
  const vertical = clamp01(Math.abs(percent - IDEAL_ROW_PERCENT) / IDEAL_ROW_PERCENT);
  return round4(1 - 0.5 * horizontal - 0.5 * vertical);
}

function consecutiveRuns(seats: Seat[]): Seat[][] {
  const sorted = [...seats].sort((a, b) => a.column - b.column);
  const runs: Seat[][] = [];
  for (const seat of sorted) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    if (run && previous && seat.column === previous.column + 1) run.push(seat);
    else runs.push([seat]);
  }
  return runs;
}

function bestWindow(
  run: Seat[],
  together: number,
  axis: RowAxis,
  percent: number,
): SeatGroup | null {
  let best: SeatGroup | null = null;
  for (let start = 0; start + together <= run.length; start++) {
    const window = run.slice(start, start + together);
    const score = windowScore(window, axis, percent);
    const first = window[0];
    if (first && (best === null || score > best.score)) {
      best = { rowLabel: first.rowLabel, seatIds: window.map((seat) => seat.id), score };
    }
  }
  return best;
}

function findGroups(
  rows: HallRow[],
  isFree: (seat: Seat) => boolean,
  inZone: (seat: Seat) => boolean,
  together: number,
): SeatGroup[] {
  const percents = rowPercents(rows);
  const groups: SeatGroup[] = [];
  for (const row of rows) {
    if (row.sellable.length === 0) continue;
    const axis = rowAxis(row);
    const percent = percents.get(row.label) ?? 50;
    const candidates = row.sellable.filter((seat) => isFree(seat) && inZone(seat));
    for (const run of consecutiveRuns(candidates)) {
      const group = bestWindow(run, together, axis, percent);
      if (group) groups.push(group);
    }
  }
  return groups;
}

function pickBest(groups: SeatGroup[]): SeatGroup[] {
  const sorted = [...groups].sort((a, b) => b.score - a.score);
  const usedRows = new Set<string>();
  const best: SeatGroup[] = [];
  for (const group of sorted) {
    if (best.length === BEST_COUNT) break;
    if (usedRows.has(group.rowLabel)) continue;
    usedRows.add(group.rowLabel);
    best.push(group);
  }
  return best;
}

function summarizeRows(
  rows: HallRow[],
  isFree: (seat: Seat) => boolean,
  zoneIds: Set<string>,
): RowSummary[] {
  return rows.map((row) => ({
    rowLabel: row.label,
    row: row.row,
    sellable: row.sellable.length,
    free: row.sellable.filter(isFree).length,
    inZone: row.sellable.some((seat) => zoneIds.has(seat.id)),
  }));
}

function findUnknownTypes(hall: Hall, sellableTypes: string[]): string[] {
  const known = new Set([...sellableTypes, RESERVED_TYPE, ACCESSIBLE_TYPE]);
  return [...new Set(hall.seats.map((seat) => seat.type).filter((type) => !known.has(type)))];
}

export function analyzeSeats(hall: Hall, occupancy: Occupancy, rule: SeatRule): SeatAnalysis {
  const rows = buildRows(hall, rule.sellableTypes);
  const together = Math.max(1, rule.together);
  const isFree = (seat: Seat): boolean => occupancy.taken[seat.id] === undefined;
  const zoneIds = zoneIdsFromRows(rows, rule.zone);
  const sellableSeats = rows.flatMap((row) => row.sellable);
  const freeSeats = sellableSeats.filter(isFree);
  const groups = findGroups(rows, isFree, (seat) => zoneIds.has(seat.id), together);
  const candidates = groups.length > 0 ? groups : findGroups(rows, isFree, () => true, together);
  const hallIds = new Set(hall.seats.map((seat) => seat.id));
  return {
    sellable: sellableSeats.length,
    free: freeSeats.length,
    taken: sellableSeats.length - freeSeats.length,
    freeInZone: freeSeats.filter((seat) => zoneIds.has(seat.id)).length,
    sellableInZone: zoneIds.size,
    rows: summarizeRows(rows, isFree, zoneIds),
    zoneSeatIds: sellableSeats.filter((seat) => zoneIds.has(seat.id)).map((seat) => seat.id),
    groups,
    best: pickBest(candidates),
    ok: groups.length > 0,
    unknownTypes: findUnknownTypes(hall, rule.sellableTypes),
    unknownTakenIds: Object.keys(occupancy.taken).filter((id) => !hallIds.has(id)),
  };
}
