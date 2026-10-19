import { describe, expect, it } from "vitest";
import { parseLegacyKey } from "../../src/circuits/legacy.js";
import { createHttpClient } from "../../src/http.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../../src/seats.js";
import { createMemoryHallStore, createSeatClient } from "../../src/webtic.js";
import { createWebticDirectClient, WEBTIC_DIRECT_BASE } from "../../src/webtic-direct.js";

const live = process.env.LIVE === "1";
const MERLATA = 5779;

const http = createHttpClient({
  allowedHosts: [new URL(WEBTIC_DIRECT_BASE).hostname],
  userAgent: "cinema-watch/live-test (+https://github.com/PilaScat/cinema-watch)",
});
const direct = createWebticDirectClient(http);
const seats = createSeatClient(direct.seats, { hallStore: createMemoryHallStore() });

describe.skipIf(!live)("live Webtic", () => {
  it("lists the candidate cinemas with the Notorious ones and without UCI", async () => {
    const venues = await direct.venueCandidates();

    expect(venues.length).toBeGreaterThan(200);
    expect(venues.map((venue) => venue.slug)).toContain(`webtic-${MERLATA}`);
    expect(venues.some((venue) => /\buci\b/i.test(venue.name))).toBe(false);
  });

  it("reads a Notorious showing, its hall and its occupancy end to end", async () => {
    const programming = await direct.scheduling(MERLATA);
    const now = new Date().toISOString().slice(0, 16);
    const showing = [...programming.values()].flat().find((item) => item.startsAt > now);
    if (!showing) throw new Error("Nessuno spettacolo futuro a Notorious Merlata");
    const [localId, performanceId] = parseLegacyKey(showing.key);
    const performance = await seats.performance(localId, performanceId);
    const occupancy = await seats.occupancy(localId, performanceId);
    const { hall } = await seats.hall(localId, parseLegacyKey(performance.hallKey)[1], occupancy);
    const analysis = analyzeSeats(hall, occupancy, {
      zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
      together: 2,
      sellableTypes: DEFAULT_SELLABLE_TYPES,
    });

    expect(showing.cartUrl).toContain(`/${performance.eventRef}/`);
    expect(hall.seats.length).toBeGreaterThan(20);
    expect(analysis.sellable).toBeGreaterThan(0);
    expect(analysis.free).toBeLessThanOrEqual(analysis.sellable);
    expect(analysis.unknownTypes).toEqual([]);
  });
});
