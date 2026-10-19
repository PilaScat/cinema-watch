import { describe, expect, it } from "vitest";
import { buildSpaceVenues, createSpaceClient, SPACE_SITE } from "../../src/circuits/the-space.js";
import { createGuardedFetch, createHttpClient } from "../../src/http.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../../src/seats.js";

const live = process.env.LIVE === "1";
const BEINASCO = "1028";
const USER_AGENT = "cinema-watch/live-test (+https://github.com/PilaScat/cinema-watch)";
const host = new URL(SPACE_SITE).hostname;

const space = createSpaceClient({
  http: createHttpClient({ allowedHosts: [host], userAgent: USER_AGENT }),
  fetch: createGuardedFetch([host]),
  userAgent: USER_AGENT,
  now: () => Date.now(),
});

describe.skipIf(!live)("live The Space", () => {
  it("lists the cinemas with Beinasco placed in Piemonte", async () => {
    const list = await buildSpaceVenues(space, () => Date.now());

    expect(list.theatres.length).toBeGreaterThan(25);
    expect(list.theatres.find((theatre) => theatre.slug === `space-${BEINASCO}`)).toMatchObject({ region: "Piemonte", province: "TO" });
    expect(list.theatres.filter((theatre) => theatre.lat !== null).length).toBeGreaterThan(list.theatres.length / 2);
    expect(list.theatres.filter((theatre) => theatre.region === null).map((theatre) => theatre.name)).toEqual([]);
  });

  it("reads a Beinasco session, its hall and its occupancy end to end", async () => {
    const programming = await space.programming(BEINASCO);
    const now = new Date().toISOString().slice(0, 16);
    const showing = [...programming.values()].flat().find((item) => item.startsAt > now);
    if (!showing) throw new Error("Nessuno spettacolo futuro a The Space Beinasco");
    const read = await space.seats(BEINASCO, showing.key.split("-")[2] ?? "");
    const analysis = analyzeSeats({ key: "live", seats: read.seats, fetchedAt: 0 }, { key: showing.key, taken: read.taken }, {
      zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
      together: 2,
      sellableTypes: DEFAULT_SELLABLE_TYPES,
    });

    expect(showing.cartUrl).toMatch(/^https:\/\/www\.thespacecinema\.it\/prenotare-il-biglietto\/summary\/1028\//);
    expect(read.seats.length).toBeGreaterThan(50);
    expect(read.seats[0]?.rowLabel).toBe("A");
    expect(analysis.sellable).toBeGreaterThan(0);
    expect(read.priceFrom).toBeGreaterThan(0);
    expect((await space.films()).length).toBeGreaterThan(5);
  });
});
