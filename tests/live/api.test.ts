import { describe, expect, it } from "vitest";
import { addDays, romeToday } from "../../src/dates.js";
import { createHttpClient } from "../../src/http.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../../src/seats.js";
import type { Showing } from "../../src/types.js";
import { createUciClient, UCI_API_BASE } from "../../src/uci.js";
import { createMemoryHallStore, createWebticClient, WEBTIC_API_BASE } from "../../src/webtic.js";

const live = process.env.LIVE === "1";

const http = createHttpClient({
  allowedHosts: [new URL(UCI_API_BASE).hostname, new URL(WEBTIC_API_BASE).hostname],
  userAgent: "cinema-watch/live-test (+https://github.com/PilaScat/cinema-watch)",
});
const uci = createUciClient(http);
const webtic = createWebticClient(http, { hallStore: createMemoryHallStore() });

async function someShowing(): Promise<Showing> {
  const today = romeToday(new Date());
  for (let offset = 0; offset < 7; offset += 1) {
    const showings = await uci.programmingDay("uci-cinemas-verona", addDays(today, offset));
    const later = showings.find((showing) => showing.startsAt > new Date().toISOString().slice(0, 16));
    if (later) return later;
  }
  throw new Error("Nessuno spettacolo a Verona nei prossimi 7 giorni");
}

describe.skipIf(!live)("live UCI and Webtic", () => {
  it("lists the UCI cinemas with Verona among them", async () => {
    const theatres = await uci.theatres();

    expect(theatres.length).toBeGreaterThan(20);
    expect(theatres.find((theatre) => theatre.slug === "uci-cinemas-verona")?.screens).toContain("IMAX");
  });

  it("reads a showing, its hall and its occupancy end to end", async () => {
    const showing = await someShowing();
    const performance = await webtic.performance(showing.localId, showing.performanceId);
    const occupancy = await webtic.occupancy(showing.localId, showing.performanceId);
    const { hall } = await webtic.hall(showing.localId, performance.screenId, occupancy);
    const analysis = analyzeSeats(hall, occupancy, {
      zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
      together: 2,
      sellableTypes: DEFAULT_SELLABLE_TYPES,
    });

    expect(performance.screenId).toBeGreaterThan(0);
    expect(hall.seats.length).toBeGreaterThan(20);
    expect(analysis.sellable).toBeGreaterThan(0);
    expect(analysis.free).toBeLessThanOrEqual(analysis.sellable);
    expect(analysis.unknownTypes).toEqual([]);
  });
});
