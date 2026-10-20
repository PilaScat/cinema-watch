import { describe, expect, it } from "vitest";
import { createPacer, createT18Client, parseHome, programmingOf, t18Slug } from "../../src/circuits/t18.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../../src/seats.js";

const live = process.env.LIVE === "1";
const ANDROMEDA = "roma.andromeda.18tickets.it";

const t18 = createT18Client({
  fetch: (url, init) => fetch(url, init),
  pacer: createPacer({ intervalMs: 10_000, cooldownMs: 60_000, now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }),
  userAgent: "cinema-watch/live-test (+https://github.com/PilaScat/cinema-watch)",
});

describe.skipIf(!live)("live 18Tickets", () => {
  it("reads a future projection of Andromeda Roma, its hall and its taken seats end to end", { timeout: 120_000 }, async () => {
    const home = await t18.home(ANDROMEDA);
    const now = new Date().toISOString().slice(0, 16);
    const showing = [...programmingOf(home, t18Slug(ANDROMEDA)).values()].flat().find((item) => item.startsAt > now);
    if (!showing) throw new Error("Nessuna proiezione futura ad Andromeda Roma");
    const film = home.films.find((item) => item.projections.some((projection) => showing.key.endsWith(projection.uuid)));
    const uuid = showing.key.slice(-36);
    const theater = (await t18.theaters(ANDROMEDA, film?.filmId ?? "")).get(uuid);
    if (theater === undefined) throw new Error("Sala non trovata nella pagina del film");
    const seats = await t18.theater(ANDROMEDA, theater);
    const taken = await t18.seats(ANDROMEDA, uuid);
    const analysis = analyzeSeats({ key: "live", seats, fetchedAt: 0 }, { key: showing.key, taken }, {
      zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
      together: 2,
      sellableTypes: DEFAULT_SELLABLE_TYPES,
    });

    expect(home.places).toEqual(["Andromeda Roma"]);
    expect(showing.cartUrl).toMatch(/^https:\/\/roma\.andromeda\.18tickets\.it\/film\/\d+\/[0-9a-f-]{36}#theater-init$/);
    expect(seats.length).toBeGreaterThan(50);
    expect(Object.keys(taken).every((id) => seats.some((seat) => seat.id === id))).toBe(true);
    expect(analysis.sellable).toBeGreaterThan(0);
  });

  it("lists the cinemas of a group from its home", { timeout: 60_000 }, async () => {
    const page = await t18.page("ccroma.18tickets.it");
    if (page.kind !== "page") throw new Error("ccroma reindirizza");

    expect(parseHome(page.html, "ccroma.18tickets.it").cinemaHosts.length).toBeGreaterThan(4);
  });
});
