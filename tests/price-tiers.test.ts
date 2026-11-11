import { describe, expect, it } from "vitest";
import { copy } from "../src/copy.js";
import { parseSeats } from "../src/circuits/the-space.js";
import { romeMidnight, romeMidnightsBetween } from "../src/dates.js";
import { formatDayTime, formatTier } from "../src/format.js";
import { HALL_PALETTE, TIER_PALETTE, renderHallSvg } from "../src/hall-svg.js";
import { renderTrendSvg } from "../src/chart-svg.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../src/seats.js";
import type { SeatRule } from "../src/types.js";
import { parseHall, parseOccupancy, parsePerformance } from "../src/webtic.js";
import { fixture } from "./support/fake-world.js";

const rule: SeatRule = { zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 }, together: 2, sellableTypes: DEFAULT_SELLABLE_TYPES };
const plain = (text: string): string => text.replaceAll(" ", " ");

describe("price tiers of a showing", () => {
  it("reads name and full price of each sector in the Infinity Vision hall in Verona", () => {
    expect(parsePerformance(fixture("webtic/performance-5116-576749.json")).priceTiers).toEqual([
      { sector: "PT", name: "Normale", price: 12.9 },
      { sector: "HA", name: "Vip", price: 13.9 },
    ]);
  });

  it("names a sector VIP from its tickets when the sector has no name, and leaves the other with the price alone", () => {
    const tiers = parsePerformance(fixture("webtic/performance-5116-576820.json")).priceTiers ?? [];

    expect(tiers).toEqual([
      { sector: "PT", name: "", price: 10.9 },
      { sector: "HA", name: "VIP", price: 11.9 },
    ]);
    expect(tiers.map((tier) => plain(formatTier(tier)))).toEqual(["10,90 €", "VIP 11,90 €"]);
  });

  it("reads the four areas on sale at The Space, without the one for wheelchairs and without names that are colours", () => {
    const tiers = parseSeats(fixture("space/seats-1028-58489.json")).priceTiers;

    expect(tiers.map((tier) => plain(formatTier(tier)))).toEqual(["4,70 €", "9,20 €", "12,20 €", "Vip 14,20 €"]);
  });
});

describe("hall with more than one price", () => {
  const hall = parseHall(fixture("webtic/screen-5116-14.json"), 0);
  const occupancy = parseOccupancy(fixture("webtic/occupancy-5116-576749.json"));
  const tiers = parsePerformance(fixture("webtic/performance-5116-576749.json")).priceTiers ?? [];
  const draw = (theme: "dark" | "light", shown = tiers, compact = false) =>
    renderHallSvg(hall, occupancy, analyzeSeats(hall, occupancy, rule), rule, { title: "Avengers", subtitle: "SALA 07 XL", labels: copy.hall.labels, theme, tiers: shown, compact });
  const filled = (svg: string, color: string): number => [...svg.matchAll(new RegExp(`<rect data-seat="[^"]*"[^>]*fill="${color}"`, "g"))].length;

  it("paints the free VIP seats in their own colour and lists both prices in the legend", () => {
    const svg = draw("dark");
    const freeVip = hall.seats.filter((seat) => seat.sector === "HA" && seat.type === "STANDARD" && occupancy.taken[seat.id] === undefined).length;

    expect(hall.seats.filter((seat) => seat.sector === "HA")).toHaveLength(36);
    expect(freeVip).toBeGreaterThan(0);
    expect(filled(svg, TIER_PALETTE.dark[0] ?? "")).toBe(freeVip);
    expect(plain(svg)).toContain(">Normale 12,90 €</text>");
    expect(plain(svg)).toContain(">Vip 13,90 €</text>");
    expect(filled(draw("light"), TIER_PALETTE.light[0] ?? "")).toBe(freeVip);
  });

  it("stays as before when there is one price or none", () => {
    const without = draw("dark", []);

    expect(draw("dark", tiers.slice(0, 1))).toBe(without);
    expect(filled(without, TIER_PALETTE.dark[0] ?? "")).toBe(0);
    expect(filled(without, HALL_PALETTE.dark.free)).toBeGreaterThan(0);
  });

  it("drops title and subtitle in the compact version", () => {
    const compact = draw("dark", tiers, true);

    expect(compact).not.toContain(">Avengers</text>");
    expect(compact).not.toContain("SALA 07 XL");
    expect(compact).toContain("Vip");
  });
});

describe("trend across days", () => {
  const start = Date.parse("2026-12-15T19:30:00Z");
  const points = [
    { t: start, free: 44, freeGood: 0 },
    { t: start + 20 * 3_600_000, free: 40, freeGood: 2 },
    { t: start + 44 * 3_600_000, free: 30, freeGood: 5 },
  ];

  it("writes day and time, not the time alone", () => {
    expect(formatDayTime(start)).toBe("mar 15/12 20:30");
  });

  it("finds the midnights in Rome between two moments, in winter and in summer", () => {
    expect(romeMidnightsBetween(start, start + 44 * 3_600_000).map((t) => new Date(t).toISOString())).toEqual(["2026-12-15T23:00:00.000Z", "2026-12-16T23:00:00.000Z"]);
    expect(new Date(romeMidnight("2026-07-01")).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("draws a line for each new day, names the day and gives every point its full label", () => {
    const marks = romeMidnightsBetween(points[0]?.t ?? 0, points[2]?.t ?? 0).map((t) => ({ t, label: `D${new Date(t).getUTCDate()}` }));
    const svg = renderTrendSvg(points, { width: 640, height: 240, labels: { free: "Liberi", freeGood: "Zona", time: formatDayTime }, dayMarks: marks });

    expect([...svg.matchAll(/<line [^>]*data-day="/g)]).toHaveLength(2);
    expect(svg).toContain(">D16</text>");
    expect(svg).not.toContain(">D15</text>");
    expect(svg).toContain(">mar 15/12 20:30</text>");
    expect(svg).toContain('data-label="mer 16/12 16:30"');
  });

  it("draws no day line when everything happened on one day", () => {
    const svg = renderTrendSvg(points.slice(0, 1), { width: 640, height: 240, labels: { free: "Liberi", freeGood: "Zona", time: formatDayTime }, dayMarks: [] });

    expect(svg).not.toContain("data-day");
  });
});
