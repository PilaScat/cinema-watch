import fs from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ACCESSIBLE_SECTOR,
  DEFAULT_SELLABLE_TYPES,
  analyzeSeats,
  isSellable,
  seatState,
  zoneSeatIds,
} from "../src/seats.js";
import type { Hall, Occupancy, Seat, SeatRule, TakenStatus, Zone } from "../src/types.js";

interface RawSeat {
  SeatId: string;
  SeatType: string;
  SectorId: string;
  Row: number;
  Column: number;
}

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(new URL(`./fixtures/webtic/${name}`, import.meta.url), "utf8"));
}

function loadHall(file: string): Hall {
  const raw = readFixture(file) as { Data: { Screen: { LocalId: number; ScreenId: number; Seats: RawSeat[] } } };
  const screen = raw.Data.Screen;
  const seats: Seat[] = screen.Seats.map((seat) => {
    const [rowLabel = "", number = ""] = seat.SeatId.split("/");
    return {
      id: seat.SeatId,
      rowLabel,
      number: Number(number),
      row: seat.Row,
      column: seat.Column,
      sector: seat.SectorId,
      type: seat.SeatType,
    };
  });
  return { key: `${screen.LocalId}-${screen.ScreenId}`, seats, fetchedAt: 0 };
}

function loadOccupancy(file: string): Occupancy {
  const raw = readFixture(file) as {
    Data: { Occupancy: { LocalId: number; PerformanceId: number; Seats: { SeatId: string; SeatStatus: string }[] } };
  };
  const taken: Record<string, TakenStatus> = {};
  for (const seat of raw.Data.Occupancy.Seats) {
    taken[seat.SeatId] = seat.SeatStatus === "BLOCCATO" ? "blocked" : "sold";
  }
  return { key: `${raw.Data.Occupancy.LocalId}-${raw.Data.Occupancy.PerformanceId}`, taken };
}

const HALLS = [
  ["screen-5116-2.json", "occupancy-5116-575978.json"],
  ["screen-5116-14.json", "occupancy-5116-576749.json"],
  ["screen-5116-4.json", "occupancy-5116-576820.json"],
  ["screen-5124-69.json", "occupancy-5124-536257.json"],
] as const;

const SELLABLE = DEFAULT_SELLABLE_TYPES;
const RELATIVE_DEFAULT: Zone = {
  kind: "relative",
  rowsFromPercent: 40,
  rowsToPercent: 85,
  centerPercent: 60,
};

function rule(zone: Zone, together: number, sellableTypes: string[] = SELLABLE): SeatRule {
  return { zone, together, sellableTypes };
}

function absolute(rows: string[], seatFrom: number | null = null, seatTo: number | null = null): Zone {
  return { kind: "absolute", rows, seatFrom, seatTo };
}

function makeSeat(label: string, row: number, column: number, overrides: Partial<Seat> = {}): Seat {
  return {
    id: `${label}/${column}`,
    rowLabel: label,
    number: column,
    row,
    column,
    sector: "PT",
    type: "STANDARD",
    ...overrides,
  };
}

function makeHall(rows: { label: string; columns: number[] }[], overrides: Partial<Seat> = {}): Hall {
  const seats = rows.flatMap((row, index) =>
    row.columns.map((column) => makeSeat(row.label, index + 2, column, overrides)),
  );
  return { key: "1-1", seats, fetchedAt: 0 };
}

function emptyOccupancy(taken: Record<string, TakenStatus> = {}): Occupancy {
  return { key: "1-1", taken };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

describe("isSellable and seatState", () => {
  const standard = makeSeat("A", 2, 1);
  const occupancy = emptyOccupancy({ "A/2": "sold", "A/3": "blocked", "A/4": "other" });

  it("treats only listed types outside the accessible sector as sellable", () => {
    expect(isSellable(standard, SELLABLE)).toBe(true);
    expect(isSellable(makeSeat("A", 2, 1, { type: "RISERVATO" }), SELLABLE)).toBe(false);
    expect(isSellable(makeSeat("A", 2, 1, { sector: ACCESSIBLE_SECTOR }), SELLABLE)).toBe(false);
    expect(isSellable(makeSeat("A", 2, 1, { type: "VIP" }), ["STANDARD", "VIP"])).toBe(true);
  });

  it("maps seats to display states", () => {
    expect(seatState(standard, occupancy, SELLABLE)).toBe("free");
    expect(seatState(makeSeat("A", 2, 2), occupancy, SELLABLE)).toBe("sold");
    expect(seatState(makeSeat("A", 2, 3), occupancy, SELLABLE)).toBe("blocked");
    expect(seatState(makeSeat("A", 2, 4), occupancy, SELLABLE)).toBe("sold");
    expect(seatState(makeSeat("A", 2, 5, { type: "RISERVATO" }), occupancy, SELLABLE)).toBe("reserved");
    expect(seatState(makeSeat("A", 2, 6, { type: "DISABILE" }), occupancy, SELLABLE)).toBe("accessible");
    expect(seatState(makeSeat("A", 2, 7, { sector: "UN" }), occupancy, SELLABLE)).toBe("accessible");
  });
});

describe("Dune IMAX Verona preview", () => {
  const hall = loadHall("screen-5116-2.json");
  const occupancy = loadOccupancy("occupancy-5116-575978.json");

  it("counts sellable and free seats", () => {
    const analysis = analyzeSeats(hall, occupancy, rule(absolute(["F"]), 3));
    expect(hall.seats).toHaveLength(236);
    expect(analysis.sellable).toBe(228);
    expect(analysis.free).toBe(44);
    expect(analysis.taken).toBe(184);
    expect(analysis.unknownTypes).toEqual([]);
    expect(analysis.unknownTakenIds).toEqual([]);
  });

  it("summarizes free seats per row", () => {
    const analysis = analyzeSeats(hall, occupancy, rule(absolute(["F"]), 3));
    const perRow = Object.fromEntries(analysis.rows.map((row) => [row.rowLabel, [row.free, row.sellable]]));
    expect(perRow).toMatchObject({
      A: [20, 20],
      B: [18, 20],
      C: [4, 20],
      D: [1, 20],
      E: [1, 20],
      F: [0, 20],
      L: [0, 20],
      M: [0, 8],
      HX: [0, 0],
    });
    const rows = analysis.rows.map((row) => row.row);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it("finds nothing in the absolute zone F-L seats 5-16", () => {
    const analysis = analyzeSeats(hall, occupancy, rule(absolute(["F", "G", "H", "J", "K", "L"], 5, 16), 3));
    expect(analysis.ok).toBe(false);
    expect(analysis.freeInZone).toBe(0);
    expect(analysis.sellableInZone).toBe(72);
    expect(analysis.groups).toEqual([]);
    expect(analysis.best.length).toBeGreaterThan(0);
    expect(analysis.rows.find((row) => row.rowLabel === "F")?.inZone).toBe(true);
    expect(analysis.rows.find((row) => row.rowLabel === "A")?.inZone).toBe(false);
  });

  it("finds groups in the absolute zone A-B", () => {
    const analysis = analyzeSeats(hall, occupancy, rule(absolute(["a", "B"]), 3));
    expect(analysis.ok).toBe(true);
    expect(analysis.freeInZone).toBe(38);
    expect(analysis.best.some((group) => group.rowLabel === "A")).toBe(true);
  });

  it("excludes reserved and accessible seats from the zone", () => {
    const ids = zoneSeatIds(hall, absolute(["M", "HX"]), SELLABLE);
    expect([...ids].sort()).toEqual(["M/1", "M/17", "M/18", "M/19", "M/2", "M/20", "M/3", "M/4"]);
  });

  it("reports blocked seats as blocked", () => {
    const blockedIds = Object.keys(occupancy.taken).filter((id) => occupancy.taken[id] === "blocked");
    expect(blockedIds).toHaveLength(8);
    for (const id of blockedIds) {
      const seat = hall.seats.find((candidate) => candidate.id === id) as Seat;
      expect(["reserved", "accessible"]).toContain(seatState(seat, occupancy, SELLABLE));
      expect(seatState(seat, occupancy, [seat.type])).toBe(seat.sector === "UN" ? "accessible" : "blocked");
    }
    const hx = hall.seats.find((candidate) => candidate.id === "HX/1");
    if (hx) expect(seatState(hx, occupancy, SELLABLE)).toBe("accessible");
  });

  it("splits runs at column gaps", () => {
    const freeM: Occupancy = {
      ...occupancy,
      taken: Object.fromEntries(Object.entries(occupancy.taken).filter(([id]) => !id.startsWith("M/"))),
    };
    const analysis = analyzeSeats(hall, freeM, rule(absolute(["M"]), 4));
    const ids = analysis.groups.map((group) => group.seatIds);
    expect(ids).toEqual([
      ["M/1", "M/2", "M/3", "M/4"],
      ["M/17", "M/18", "M/19", "M/20"],
    ]);
    const five = analyzeSeats(hall, freeM, rule(absolute(["M"]), 5));
    expect(five.ok).toBe(false);
  });
});

describe("XL hall with a VIP sector", () => {
  const hall = loadHall("screen-5116-14.json");
  const occupancy = loadOccupancy("occupancy-5116-576749.json");

  it("treats sector HA as sellable", () => {
    const analysis = analyzeSeats(hall, occupancy, rule(absolute(["G", "H"]), 2));
    expect(analysis.sellableInZone).toBe(36);
    expect(isSellable(hall.seats.find((seat) => seat.sector === "HA") as Seat, SELLABLE)).toBe(true);
  });

  it("excludes reserved seats of the same hall", () => {
    const analysis = analyzeSeats(hall, occupancy, rule(absolute(["B"]), 1));
    const reserved = hall.seats.filter((seat) => seat.rowLabel === "B" && seat.type === "RISERVATO");
    expect(reserved.length).toBeGreaterThan(0);
    expect(analysis.sellableInZone).toBe(24 - reserved.length);
  });
});

describe("Luxe hall with reversed numbering", () => {
  const hall = loadHall("screen-5124-69.json");
  const occupancy = loadOccupancy("occupancy-5124-536257.json");

  it("uses the physical column for the relative zone", () => {
    const zone: Zone = { kind: "relative", rowsFromPercent: 0, rowsToPercent: 0, centerPercent: 50 };
    const ids = zoneSeatIds(hall, zone, SELLABLE);
    const rowA = hall.seats.filter((seat) => seat.rowLabel === "A");
    expect([...ids].sort()).toEqual(
      rowA
        .filter((seat) => Math.abs(seat.column - 14.5) <= 4.75)
        .map((seat) => seat.id)
        .sort(),
    );
    expect(ids.has("A/20")).toBe(false);
    expect(ids.has("A/10")).toBe(true);
  });

  it("orders group seat ids by column", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(absolute(["A"], 1, 3), 3));
    expect(analysis.groups[0]?.seatIds).toEqual(["A/3", "A/2", "A/1"]);
  });

  it("returns the group of the three lowest columns in the right order", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(absolute(["A"], 18, 20), 3));
    expect(analysis.groups[0]?.seatIds).toEqual(["A/20", "A/19", "A/18"]);
    expect(analyzeSeats(hall, occupancy, rule(absolute(["A"]), 1)).rows[0]?.rowLabel).toBe("A");
  });
});

describe("default relative zone on every hall", () => {
  it.each(HALLS)("%s has rows in zone", (screen, occ) => {
    const hall = loadHall(screen);
    const analysis = analyzeSeats(hall, loadOccupancy(occ), rule(RELATIVE_DEFAULT, 2));
    expect(analysis.rows.some((row) => row.inZone)).toBe(true);
    expect(analysis.sellableInZone).toBeGreaterThan(0);
    expect(analysis.sellableInZone).toBeLessThan(analysis.sellable);
    expect(analysis.zoneSeatIds).toHaveLength(analysis.sellableInZone);
    expect(analysis.best.length).toBeGreaterThan(0);
    expect(analysis.free).toBeLessThanOrEqual(analysis.sellable);
  });
});

describe("together and best selection", () => {
  const hall = makeHall([
    { label: "A", columns: range(1, 10) },
    { label: "B", columns: range(1, 10) },
    { label: "C", columns: range(1, 10) },
    { label: "D", columns: range(1, 10) },
    { label: "E", columns: range(1, 10) },
  ]);
  const everywhere = absolute(["A", "B", "C", "D", "E"]);

  it("handles together 1", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(everywhere, 1));
    expect(analysis.groups.every((group) => group.seatIds.length === 1)).toBe(true);
    expect(analysis.groups).toHaveLength(5);
  });

  it("is not ok when together exceeds the row", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(everywhere, 11));
    expect(analysis.ok).toBe(false);
    expect(analysis.groups).toEqual([]);
    expect(analysis.best).toEqual([]);
  });

  it("clamps together below 1", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(everywhere, 0));
    expect(analysis.groups.every((group) => group.seatIds.length === 1)).toBe(true);
  });

  it("returns at most three best groups, one per row, sorted by score", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(everywhere, 2));
    expect(analysis.best).toHaveLength(3);
    expect(new Set(analysis.best.map((group) => group.rowLabel)).size).toBe(3);
    const scores = analysis.best.map((group) => group.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(analysis.best[0]?.rowLabel).toBe("D");
    expect(analysis.best[0]?.seatIds).toEqual(["D/5", "D/6"]);
  });

  it("picks the most central window of the run", () => {
    const analysis = analyzeSeats(hall, emptyOccupancy(), rule(absolute(["C"]), 3));
    expect(analysis.groups).toHaveLength(1);
    expect(analysis.groups[0]?.seatIds).toEqual(["C/4", "C/5", "C/6"]);
  });

  it("falls back to the whole hall when the zone has no groups", () => {
    const taken: Record<string, TakenStatus> = {};
    for (const column of range(1, 10)) taken[`A/${column}`] = "sold";
    const analysis = analyzeSeats(hall, emptyOccupancy(taken), rule(absolute(["A"]), 2));
    expect(analysis.ok).toBe(false);
    expect(analysis.best).toHaveLength(3);
    expect(analysis.best.every((group) => group.rowLabel !== "A")).toBe(true);
  });

  it("works on a single row hall", () => {
    const single = makeHall([{ label: "A", columns: range(1, 7) }]);
    const analysis = analyzeSeats(single, emptyOccupancy(), rule(RELATIVE_DEFAULT, 3));
    expect(analysis.ok).toBe(true);
    expect(analysis.rows).toHaveLength(1);
    expect(analysis.groups[0]?.seatIds).toEqual(["A/3", "A/4", "A/5"]);
    expect(analysis.groups[0]?.score).toBeCloseTo(1 - 0.5 * (15 / 65), 4);
  });

  it("handles a row with a single seat", () => {
    const single = makeHall([{ label: "A", columns: [4] }]);
    const analysis = analyzeSeats(single, emptyOccupancy(), rule(RELATIVE_DEFAULT, 1));
    expect(analysis.ok).toBe(true);
    expect(analysis.groups[0]?.seatIds).toEqual(["A/4"]);
  });

  it("handles a hall without sellable seats", () => {
    const none = makeHall([{ label: "A", columns: range(1, 3) }], { type: "RISERVATO" });
    const analysis = analyzeSeats(none, emptyOccupancy(), rule(RELATIVE_DEFAULT, 1));
    expect(analysis.sellable).toBe(0);
    expect(analysis.ok).toBe(false);
    expect(analysis.best).toEqual([]);
    expect(analysis.rows[0]).toMatchObject({ sellable: 0, free: 0, inZone: false });
  });

  it("ignores seats without a number in numbered zones", () => {
    const unnumbered = makeHall([{ label: "A", columns: range(1, 4) }]);
    const seats = unnumbered.seats.map((seat) => ({ ...seat, number: null }));
    const whole = analyzeSeats({ ...unnumbered, seats }, emptyOccupancy(), rule(absolute(["A"]), 2));
    const limited = analyzeSeats({ ...unnumbered, seats }, emptyOccupancy(), rule(absolute(["A"], 1, 4), 2));
    expect(whole.ok).toBe(true);
    expect(limited.ok).toBe(false);
  });

  it("applies seatFrom and seatTo independently", () => {
    const onlyFrom = zoneSeatIds(hall, absolute(["A"], 8, null), SELLABLE);
    const onlyTo = zoneSeatIds(hall, absolute(["A"], null, 2), SELLABLE);
    expect([...onlyFrom].sort()).toEqual(["A/10", "A/8", "A/9"]);
    expect([...onlyTo].sort()).toEqual(["A/1", "A/2"]);
  });
});

describe("unknown data", () => {
  it("lists unknown seat types without duplicates", () => {
    const base = makeHall([{ label: "A", columns: range(1, 6) }]);
    const seats: Seat[] = base.seats.map((seat, index) => ({
      ...seat,
      type: ["STANDARD", "VIP", "VIP", "LOVE", "RISERVATO", "DISABILE"][index] ?? "STANDARD",
    }));
    const analysis = analyzeSeats({ ...base, seats }, emptyOccupancy(), rule(absolute(["A"]), 1));
    expect(analysis.unknownTypes).toEqual(["VIP", "LOVE"]);
    const withVip = analyzeSeats({ ...base, seats }, emptyOccupancy(), rule(absolute(["A"]), 1, ["STANDARD", "VIP"]));
    expect(withVip.unknownTypes).toEqual(["LOVE"]);
  });

  it("lists taken ids missing from the hall", () => {
    const hall = makeHall([{ label: "A", columns: range(1, 3) }]);
    const analysis = analyzeSeats(hall, emptyOccupancy({ "A/1": "sold", "Z/9": "sold" }), rule(absolute(["A"]), 1));
    expect(analysis.unknownTakenIds).toEqual(["Z/9"]);
    expect(analysis.taken).toBe(1);
  });
});

describe("properties on synthetic halls", () => {
  const hallArbitrary = fc.record({
    rows: fc.array(fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 6 }),
    takenFlags: fc.array(fc.boolean(), { minLength: 80, maxLength: 80 }),
    together: fc.integer({ min: 1, max: 5 }),
    zone: fc.record({
      from: fc.integer({ min: 0, max: 100 }),
      to: fc.integer({ min: 0, max: 100 }),
      center: fc.integer({ min: 0, max: 100 }),
    }),
  });

  interface Generated {
    hall: Hall;
    taken: Record<string, TakenStatus>;
    together: number;
    zone: Zone;
  }

  function build(value: {
    rows: boolean[][];
    takenFlags: boolean[];
    together: number;
    zone: { from: number; to: number; center: number };
  }, mirror: boolean): Generated {
    const seats: Seat[] = [];
    const taken: Record<string, TakenStatus> = {};
    let flag = 0;
    value.rows.forEach((columns, rowIndex) => {
      columns.forEach((present, index) => {
        if (!present && index !== 0) return;
        const column = mirror ? 20 - index : index;
        const seat = makeSeat(String.fromCharCode(65 + rowIndex), rowIndex + 2, column);
        seats.push(seat);
        if (value.takenFlags[flag++ % value.takenFlags.length]) taken[seat.id] = "sold";
      });
    });
    return {
      hall: { key: "1-1", seats, fetchedAt: 0 },
      taken,
      together: value.together,
      zone: {
        kind: "relative",
        rowsFromPercent: Math.min(value.zone.from, value.zone.to),
        rowsToPercent: Math.max(value.zone.from, value.zone.to),
        centerPercent: value.zone.center,
      },
    };
  }

  function run(generated: Generated) {
    return analyzeSeats(generated.hall, emptyOccupancy(generated.taken), rule(generated.zone, generated.together));
  }

  it("keeps counts, groups and scores consistent", () => {
    fc.assert(
      fc.property(hallArbitrary, (value) => {
        const generated = build(value, false);
        const analysis = run(generated);
        const byId = new Map(generated.hall.seats.map((seat) => [seat.id, seat]));
        const zoneIds = new Set(analysis.zoneSeatIds);
        expect(analysis.free).toBeLessThanOrEqual(analysis.sellable);
        expect(analysis.freeInZone).toBeLessThanOrEqual(analysis.sellableInZone);
        expect(analysis.ok).toBe(analysis.groups.length > 0);
        expect(analysis.best.length).toBeLessThanOrEqual(3);
        for (const group of analysis.groups) {
          const seats = group.seatIds.map((id) => byId.get(id) as Seat);
          expect(seats).toHaveLength(generated.together);
          expect(new Set(seats.map((seat) => seat.row)).size).toBe(1);
          seats.forEach((seat, index) => {
            expect(generated.taken[seat.id]).toBeUndefined();
            expect(zoneIds.has(seat.id)).toBe(true);
            if (index > 0) expect(seat.column).toBe((seats[index - 1] as Seat).column + 1);
          });
        }
        for (const group of [...analysis.groups, ...analysis.best]) {
          expect(group.score).toBeGreaterThanOrEqual(0);
          expect(group.score).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("scores mirrored halls equally", () => {
    fc.assert(
      fc.property(hallArbitrary, (value) => {
        const scores = (analysis: ReturnType<typeof run>) =>
          analysis.groups.map((group) => `${group.rowLabel}:${group.score.toFixed(3)}`).sort();
        const normal = scores(run(build(value, false)));
        const mirrored = scores(run(build(value, true)));
        expect(mirrored).toHaveLength(normal.length);
        mirrored.forEach((entry, index) => {
          const [rowA, scoreA] = entry.split(":");
          const [rowB, scoreB] = (normal[index] ?? "").split(":");
          expect(rowA).toBe(rowB);
          expect(Math.abs(Number(scoreA) - Number(scoreB))).toBeLessThanOrEqual(0.002);
        });
      }),
      { numRuns: 200 },
    );
  });
});
