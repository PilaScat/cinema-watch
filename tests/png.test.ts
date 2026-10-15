import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { renderHallSvg } from "../src/hall-svg.js";
import { FONT_DIR, svgToPng, TELEGRAM_PHOTO_WIDTH } from "../src/png.js";
import { analyzeSeats } from "../src/seats.js";
import type { Hall, HallLabels, Occupancy, Seat, SeatRule, TakenStatus } from "../src/types.js";

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(new URL(`./fixtures/webtic/${name}`, import.meta.url), "utf8"));
}

function loadHall(file: string): Hall {
  const raw = readFixture(file) as {
    Data: {
      Screen: {
        LocalId: number;
        ScreenId: number;
        Seats: { SeatId: string; SeatType: string; SectorId: string; Row: number; Column: number }[];
      };
    };
  };
  const seats: Seat[] = raw.Data.Screen.Seats.map((seat) => {
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
  return { localId: raw.Data.Screen.LocalId, screenId: raw.Data.Screen.ScreenId, seats, fetchedAt: 0 };
}

function loadOccupancy(file: string): Occupancy {
  const raw = readFixture(file) as {
    Data: { Occupancy: { LocalId: number; PerformanceId: number; Seats: { SeatId: string; SeatStatus: string }[] } };
  };
  const taken: Record<string, TakenStatus> = {};
  for (const seat of raw.Data.Occupancy.Seats) {
    taken[seat.SeatId] = seat.SeatStatus === "BLOCCATO" ? "blocked" : "sold";
  }
  return { localId: raw.Data.Occupancy.LocalId, performanceId: raw.Data.Occupancy.PerformanceId, taken };
}

const LABELS: HallLabels = {
  screen: "SCHERMO",
  free: "Liberi",
  sold: "Venduti",
  blocked: "Nel carrello",
  reserved: "Riservati",
  accessible: "Disabili",
  best: "Migliori",
  zone: "Zona buona",
};

const RULE: SeatRule = {
  zone: { kind: "absolute", rows: ["F", "G", "H", "J", "K", "L"], seatFrom: 5, seatTo: 16 },
  together: 3,
  sellableTypes: ["STANDARD"],
};

const hall = loadHall("screen-5116-2.json");
const occupancy = loadOccupancy("occupancy-5116-575978.json");
const svg = renderHallSvg(hall, occupancy, analyzeSeats(hall, occupancy, RULE), RULE, {
  title: "Dune: Parte Tre",
  subtitle: "UCI Verona · SALA 1 IMAX · 15/12 20:30",
  labels: LABELS,
  theme: "dark",
});
const SIZE = /width="(\d+)" height="(\d+)"/.exec(svg);
const SVG_WIDTH = Number(SIZE?.[1]);
const SVG_HEIGHT = Number(SIZE?.[2]);

function header(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe("svgToPng", () => {
  it("produces a PNG with the signature", () => {
    const png = svgToPng(svg);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("scales the dimensions by 2 by default", () => {
    expect(header(svgToPng(svg))).toEqual({ width: SVG_WIDTH * 2, height: SVG_HEIGHT * 2 });
  });

  it("honors an explicit scale", () => {
    expect(header(svgToPng(svg, { scale: 1 }))).toEqual({ width: SVG_WIDTH, height: SVG_HEIGHT });
    expect(header(svgToPng(svg, { scale: 3 }))).toEqual({ width: SVG_WIDTH * 3, height: SVG_HEIGHT * 3 });
  });

  it("works with an explicit font directory", () => {
    expect(FONT_DIR.replaceAll("\\", "/")).toMatch(/assets\/fonts\/$/);
    const png = svgToPng(svg, { fontDir: FONT_DIR });
    expect(png.length).toBeGreaterThan(1000);
  });

  it("renders at the width Telegram keeps for photos", () => {
    const png = svgToPng(svg, { width: TELEGRAM_PHOTO_WIDTH });
    expect(png.readUInt32BE(16)).toBe(1280);
  });

  it.skipIf(process.platform === "win32" || process.env.STRYKER_MUTATOR_WORKER !== undefined)("renders the Dune hall for Telegram in under 500 ms on Linux after warm-up", () => {
    svgToPng(svg, { width: TELEGRAM_PHOTO_WIDTH });
    const start = performance.now();
    svgToPng(svg, { width: TELEGRAM_PHOTO_WIDTH });
    expect(performance.now() - start).toBeLessThan(500);
  });
});
