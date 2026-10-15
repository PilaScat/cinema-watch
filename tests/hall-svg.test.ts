import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { HALL_PALETTE, escapeXml, renderHallSvg } from "../src/hall-svg.js";
import { analyzeSeats } from "../src/seats.js";
import type {
  Hall,
  HallLabels,
  HallRenderOptions,
  Occupancy,
  Seat,
  SeatRule,
  TakenStatus,
  ThemeName,
} from "../src/types.js";

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
const analysis = analyzeSeats(hall, occupancy, RULE);

function options(theme: ThemeName, title = "Dune: Parte Tre"): HallRenderOptions {
  return { title, subtitle: "UCI Verona · SALA 1 IMAX · 15/12 20:30", labels: LABELS, theme };
}

function render(theme: ThemeName, title?: string): string {
  return renderHallSvg(hall, occupancy, analysis, RULE, options(theme, title));
}

describe("renderHallSvg", () => {
  it("matches the dark snapshot", () => {
    expect(render("dark")).toMatchSnapshot();
  });

  it("matches the light snapshot", () => {
    expect(render("light")).toMatchSnapshot();
  });

  it.each(["dark", "light"] as const)("contains no style attribute or element in %s", (theme) => {
    const svg = render(theme);
    expect(svg).not.toContain("style=");
    expect(svg).not.toContain("<style");
    expect(svg).not.toContain("<script");
    expect(svg).not.toContain("href");
  });

  it("is a standalone svg with matching dimensions", () => {
    const svg = render("dark");
    const match = /^<svg [^>]*width="(\d+)" height="(\d+)" viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(match?.[3]);
    expect(match?.[2]).toBe(match?.[4]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
  });

  it("escapes the title", () => {
    const svg = render("dark", `<script>&"'`);
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).not.toContain("<script>");
  });

  it("draws one seat rect per seat", () => {
    const svg = render("dark");
    expect(svg.match(/<rect data-seat=/g)).toHaveLength(hall.seats.length);
  });

  it("writes the row letters and the seat numbers", () => {
    const svg = render("dark");
    for (const letter of ["A", "F", "L", "M"]) {
      expect(svg.match(new RegExp(`font-weight="700"[^>]*>${letter}</text>`, "g"))).toHaveLength(2);
    }
    expect(svg).toContain(">20</text>");
  });

  it("shows the legend with counts", () => {
    const svg = render("dark");
    const bestSeats = new Set(analysis.best.flatMap((group) => group.seatIds)).size;
    expect(svg).toContain(">Liberi 44</text>");
    expect(svg).toContain(`>Migliori ${bestSeats}</text>`);
    expect(svg).toContain(`>Zona buona ${analysis.sellableInZone}</text>`);
    expect(svg).toContain(">Disabili 4</text>");
    expect(svg).toContain(">Riservati 4</text>");
    expect(svg).toContain(">Venduti 184</text>");
    expect(svg).toContain(">Nel carrello 0</text>");
    expect(svg).toContain(">SCHERMO</text>");
  });

  it("highlights best seats in the best color", () => {
    const bestId = analysis.best[0]?.seatIds[0] ?? "";
    const svg = render("dark");
    const seatRect = new RegExp(`<rect data-seat="${bestId}"[^>]*fill="${HALL_PALETTE.dark.best}"`);
    expect(svg).toMatch(seatRect);
  });

  it("draws dashed zone outlines in the zone color", () => {
    const svg = render("light");
    expect(svg).toContain(`stroke="${HALL_PALETTE.light.zone}"`);
    expect(svg).toContain('stroke-dasharray="5 3"');
  });

  it("handles seats without a number and halls narrower than the minimum", () => {
    const tiny: Hall = {
      ...hall,
      seats: [{ id: "A/1", rowLabel: "A", number: null, row: 2, column: 1, sector: "PT", type: "STANDARD" }],
    };
    const tinyRule: SeatRule = { ...RULE, zone: { kind: "absolute", rows: ["A"], seatFrom: null, seatTo: null } };
    const empty: Occupancy = { localId: 1, performanceId: 1, taken: {} };
    const svg = renderHallSvg(tiny, empty, analyzeSeats(tiny, empty, tinyRule), tinyRule, options("light"));
    expect(svg).toContain('width="560"');
    expect(svg.match(/<rect data-seat=/g)).toHaveLength(1);
    expect(svg).not.toContain(">1</text>");
  });
});

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;");
  });
});
