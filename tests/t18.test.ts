import { describe, expect, it } from "vitest";
import {
  buildT18Venues,
  createPacer,
  createT18Client,
  decodeEntities,
  isT18Key,
  isT18Slug,
  loadT18Venues,
  moviesOfHome,
  parseFilmPage,
  parseHome,
  parseSeatState,
  parseTheater,
  placeOf,
  programmingOf,
  saveT18Venues,
  t18Slug,
  t18VenuesDue,
  tenantOf,
  venueOf,
} from "../src/circuits/t18.js";
import { ApiShapeError, HttpError } from "../src/errors.js";
import { isT18Host } from "../src/keys.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../src/seats.js";
import { createStore } from "../src/store.js";
import { createFakeWorld, T18_PROJECTION, T18_THEATER, textFixture } from "./support/fake-world.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ANDROMEDA = "roma.andromeda.18tickets.it";
const DAY = 24 * 60 * 60 * 1000;

function home() {
  return parseHome(textFixture("t18/home-roma-andromeda.html"), ANDROMEDA);
}

function film(filmId: string) {
  const found = home().films.find((item) => item.filmId === filmId);
  if (!found) throw new Error(`no film ${filmId}`);
  return found;
}

function client(world = createFakeWorld()) {
  let clock = 0;
  const pacer = createPacer({
    intervalMs: 10_000,
    cooldownMs: 60_000,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
  });
  return { world, t18: createT18Client({ fetch: (url, init) => world.fetch(url, init), pacer, userAgent: "test" }), clock: () => clock };
}

describe("hosts, slugs and keys", () => {
  it("accepts only 18Tickets hosts and builds slugs and keys from them", () => {
    expect(isT18Host(ANDROMEDA)).toBe(true);
    expect(isT18Host("18tickets.it")).toBe(false);
    expect(isT18Host("evil.example.com")).toBe(false);
    expect(isT18Host("x.18tickets.it.example.com")).toBe(false);
    expect(t18Slug(ANDROMEDA)).toBe("t18-roma-andromeda");
    expect(isT18Slug("t18-roma-andromeda")).toBe(true);
    expect(isT18Key(`t18-roma-andromeda-${T18_PROJECTION}`)).toBe(true);
    expect(isT18Key("t18-roma-andromeda-123")).toBe(false);
    expect(tenantOf("nuovoolimpia.ccroma.18tickets.it")).toBe("ccroma");
    expect(tenantOf("splendorbari.18tickets.it")).toBe("splendorbari");
    expect(decodeEntities("L&#39;ESTRANEA &amp; &#x41;&nbsp;&bogus;")).toBe("L'ESTRANEA & A &bogus;");
  });
});

describe("home of a cinema", () => {
  it("reads name, address and the films with their projections", () => {
    const parsed = home();

    expect(parsed.title).toBe("Andromeda Roma");
    expect(parsed.places).toEqual(["Andromeda Roma"]);
    expect(parsed.address).toBe("Via Mattia Battistini, 191, 00167, Roma, RM");
    expect(parsed.cinemaHosts).toEqual([]);
    expect(parsed.films.map((item) => item.filmId)).toEqual(["81500", "81501", "80411", "85461", "76088"]);
  });

  it("reads a projection with the day of the cinema, the hall and the purchase link", () => {
    expect(film("81500")).toMatchObject({ slug: "avengers-doomsday", title: "AVENGERS: DOOMSDAY", format: "2D - INFINITY VISION", formatGroup: "2D", language: "ITA", durationMinutes: null });
    expect(film("81500").poster).toMatch(/^https:\/\/cdn\.18tickets\.net\/ccroma\/uploads\/film\/playbill\/81500\//);
    expect(film("81500").projections.find((item) => item.uuid === T18_PROJECTION)).toEqual({
      uuid: T18_PROJECTION,
      day: "2026-12-16",
      startsAt: "2026-12-16T17:30:00",
      time: "17:30",
      room: "Sala 1",
      cartUrl: `https://roma.andromeda.18tickets.it/film/81500/${T18_PROJECTION}#theater-init`,
    });
  });

  it("reads the original language from the label or the title and the duration from the title", () => {
    expect(film("81501")).toMatchObject({ slug: "avengers-doomsday", language: "VO", format: "2D" });
    expect(film("85461")).toMatchObject({ slug: "primetime", title: "PRIMETIME", language: "VO", durationMinutes: 110 });
    expect(film("80411")).toMatchObject({ slug: "l-estranea", title: "L'ESTRANEA", language: "ITA", durationMinutes: 115 });
    expect(film("76088")).toMatchObject({ slug: "dune-parte-tre", title: "DUNE – PARTE TRE" });
  });

  it("files the projections by day and lists the films for search", () => {
    const programming = programmingOf(home(), "t18-roma-andromeda");
    const movies = moviesOfHome(home());

    expect(programming.get("2026-12-16")?.map((showing) => showing.key)).toContain(`t18-roma-andromeda-${T18_PROJECTION}`);
    expect(programming.get("2026-12-16")?.find((showing) => showing.key.endsWith(T18_PROJECTION))).toMatchObject({ theatreSlug: "t18-roma-andromeda", room: "Sala 1", movie: { slug: "avengers-doomsday" } });
    expect(movies.find((movie) => movie.slug === "avengers-doomsday")).toMatchObject({ firstDay: "2026-12-16", formats: ["2D - INFINITY VISION", "2D"] });
  });

  it("skips blocks without a title and projections before a day", () => {
    const html = `<div class='movie movie--preview'>nothing</div><div class='movie movie--preview'><a class='movie__title' href='https://x.18tickets.it/film/7'>
???
</a><a data-time='1797438600000' href='https://evil.example.com/film/7/${T18_PROJECTION}#theater-init'>
<li class='btn'>
<i class='fas'></i>
17:30
<br>
Sala 2
</li>
</a></div>`;
    const parsed = parseHome(html, "x.18tickets.it");

    expect(parsed.title).toBe("");
    expect(parsed.address).toBeNull();
    expect(parsed.films).toEqual([expect.objectContaining({ slug: "film-7", projections: [], language: "ITA" }) as unknown]);
  });

  it("builds a purchase link on the cinema host when the link points elsewhere", () => {
    const html = `<div class='movie movie--preview'><a class='movie__title' href='https://x.18tickets.it/film/7'>Film 3D</a>
<i class='fa fa-calendar'></i>
Lunedì 01/02/2027
<a data-time='1801490400000' href='https://evil.example.com/film/7/${T18_PROJECTION}#theater-init'>
<li class='btn'>
<i class='fas'></i>
15:00
<br>
Sala 2
</li>
</a></div>`;

    expect(parseHome(html, "x.18tickets.it").films[0]).toMatchObject({ format: "3D", projections: [{ day: "2027-02-01", startsAt: "2027-02-01T15:00:00", cartUrl: `https://x.18tickets.it/film/7/${T18_PROJECTION}#theater-init` }] });
  });

  it("reads city, province and region from the address", () => {
    expect(placeOf("Via Mattia Battistini, 191, 00167, Roma, RM")).toEqual({ city: "Roma", province: "RM", region: "Lazio" });
    expect(placeOf("Via Chiaia 149, 80121")).toEqual({ city: "", province: null, region: "Campania" });
    expect(placeOf(null)).toEqual({ city: "", province: null, region: null });
    expect(venueOf(ANDROMEDA, home()).theatre).toEqual({ slug: "t18-roma-andromeda", name: "Andromeda Roma", city: "Roma", province: "RM", region: "Lazio", isLuxe: false, screens: [], lat: null, lon: null, chain: "t18" });
  });
});

describe("group pages", () => {
  it("lists the cinemas of a group from its home and from its choice page", () => {
    const group = parseHome(textFixture("t18/home-ccroma.html"), "ccroma.18tickets.it");
    const select = parseHome(textFixture("t18/select-cdr.html"), "cdr.18tickets.it");

    expect(group.places.length).toBeGreaterThan(1);
    expect(group.cinemaHosts).toHaveLength(8);
    expect(group.cinemaHosts).toContain("nuovoolimpia.ccroma.18tickets.it");
    expect(select.cinemaHosts.sort()).toEqual(["intrastevere.cdr.18tickets.it", "lux.cdr.18tickets.it", "odeon.cdr.18tickets.it", "tibur.cdr.18tickets.it"]);
  });
});

describe("hall and seats", () => {
  const theater = () => parseTheater(textFixture(`t18/theater-${T18_THEATER}.svg`));

  it("reads the projections of a film page with their hall", () => {
    expect(parseFilmPage(textFixture("t18/film-roma-andromeda-81500.html")).get(T18_PROJECTION)).toBe(T18_THEATER);
  });

  it("reads the hall without the hidden seats, with row A next to the screen", () => {
    const seats = theater();

    expect(seats).toHaveLength(321);
    expect(seats[0]).toEqual({ id: "12_17", rowLabel: "M", number: 12, row: 12, column: 17, sector: "PT", type: "STANDARD" });
    expect(seats.find((seat) => seat.rowLabel === "A")?.row).toBe(2);
  });

  it("marks sold and held seats on the hall", () => {
    const taken = parseSeatState(JSON.parse(textFixture(`t18/seats-${T18_PROJECTION}.json`)));
    const seats = theater();
    const analysis = analyzeSeats({ key: "h", seats, fetchedAt: 0 }, { key: "s", taken }, { zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 }, together: 2, sellableTypes: DEFAULT_SELLABLE_TYPES });

    expect(Object.keys(taken)).toHaveLength(105);
    expect(taken["12_9"]).toBe("sold");
    expect(Object.keys(taken).every((id) => seats.some((seat) => seat.id === id))).toBe(true);
    expect(analysis.sellable).toBe(321);
    expect(analysis.free).toBe(216);
    expect(parseSeatState({ bought: [], locked: [{ x: 1, y: 2 }, "bad"], reserved: [{ x: 1, y: 2 }], total: 1 })).toEqual({ "2_1": "blocked" });
  });

  it("refuses an answer that is not a seat state and a hall without seats", () => {
    expect(() => parseSeatState({})).toThrow(ApiShapeError);
    expect(() => parseSeatState("x")).toThrow(ApiShapeError);
    expect(() => parseTheater("<svg></svg>")).toThrow("no seats");
    expect(parseTheater("<g class='posto special' data-row='A' data-seat='H' id='g_1_2'><g class='posto' id='bad'>")).toEqual([
      { id: "1_2", rowLabel: "A", number: null, row: 1, column: 2, sector: "", type: "RISERVATO" },
    ]);
  });
});

describe("pacing", () => {
  it("waits between two pages of the same operator and longer after a refusal, not between operators", async () => {
    let clock = 0;
    const waits: number[] = [];
    const pacer = createPacer({
      intervalMs: 10_000,
      cooldownMs: 60_000,
      now: () => clock,
      sleep: (ms) => {
        waits.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });

    await pacer.turn("ccroma");
    await pacer.turn("ccroma");
    await pacer.turn("cdr");
    pacer.cooldown("ccroma");
    await pacer.turn("ccroma");

    expect(waits).toEqual([10_000, 60_000]);
  });
});

describe("client", () => {
  it("reads home, film page, hall and seats of a cinema", async () => {
    const { t18, world, clock } = client();

    expect((await t18.home(ANDROMEDA)).films).toHaveLength(5);
    expect((await t18.theaters(ANDROMEDA, "81500")).get(T18_PROJECTION)).toBe(T18_THEATER);
    expect(await t18.theater(ANDROMEDA, T18_THEATER)).toHaveLength(321);
    expect(Object.keys(await t18.seats(ANDROMEDA, T18_PROJECTION))).toHaveLength(105);
    expect(world.t18Calls).toHaveLength(4);
    expect(clock()).toBe(20_000);
  });

  it("returns a redirect as it is and fails on refusals, bad answers and other hosts", async () => {
    const { t18, world, clock } = client();
    world.setT18Page(ANDROMEDA, "/seats/x", "not json");
    world.setT18Page(ANDROMEDA, "/film/1", 429);

    expect(await t18.page("cdr.18tickets.it")).toEqual({ kind: "redirect", location: "https://cdr.18tickets.it/select_cinema?mandatory=true" });
    await expect(t18.page("lux.cdr.18tickets.it")).rejects.toThrow("Status 404");
    await expect(t18.theaters(ANDROMEDA, "1")).rejects.toThrow("Status 429");
    const before = clock();
    await t18.home(ANDROMEDA);
    expect(clock() - before).toBe(60_000);
    await expect(t18.seats(ANDROMEDA, "x")).rejects.toThrow("Response is not JSON");
    await expect(t18.seats(ANDROMEDA, "y")).rejects.toThrow("Status 404");
    await expect(t18.home("evil.example.com")).rejects.toThrow(HttpError);
  });

  it("reports a network failure as a network error", async () => {
    const pacer = createPacer({ intervalMs: 0, cooldownMs: 0, now: () => 0, sleep: () => Promise.resolve() });
    const failing = createT18Client({ fetch: () => Promise.reject(new Error("socket hang up")), pacer, userAgent: "test" });
    const odd = createT18Client({ fetch: () => Promise.reject(new HttpError("host", "x", "blocked")), pacer, userAgent: "test" });

    await expect(failing.home(ANDROMEDA)).rejects.toMatchObject({ kind: "network", message: "socket hang up" });
    await expect(odd.home(ANDROMEDA)).rejects.toMatchObject({ kind: "host" });
  });
});

describe("weekly check", () => {
  it("keeps the cinemas, follows group pages and choice pages, and records every host checked", async () => {
    const { t18, world } = client();
    const found: string[] = [];

    const list = await buildT18Venues(t18, { hosts: [ANDROMEDA, "ccroma.18tickets.it", "cdr.18tickets.it", "evil.example.com", ANDROMEDA], previous: null, now: () => 7, onVenue: (venue) => found.push(venue.host) });

    expect(list.checkedAt).toBe(7);
    expect(list.venues.map((venue) => venue.theatre.slug)).toEqual(["t18-roma-andromeda"]);
    expect(found).toEqual([ANDROMEDA]);
    expect(list.checkedHosts).toHaveLength(15);
    expect(list.checkedHosts).toContain("tibur.cdr.18tickets.it");
    expect(world.t18Calls).toContain("cdr.18tickets.it/select_cinema?mandatory=true");
  });

  it("keeps a cinema of the previous list that does not answer and refuses an empty list", async () => {
    const { t18, world } = client();
    const previous = await buildT18Venues(t18, { hosts: [ANDROMEDA], previous: null, now: () => 1 });
    world.setT18Page(ANDROMEDA, "/", 503);

    expect((await buildT18Venues(t18, { hosts: [ANDROMEDA], previous, now: () => 2 })).venues).toEqual(previous.venues);
    await expect(buildT18Venues(t18, { hosts: [ANDROMEDA], previous: null, now: () => 3 })).rejects.toThrow("no cinemas");
    await expect(buildT18Venues(t18, { hosts: [ANDROMEDA], previous, now: () => 3, stopped: () => true })).rejects.toThrow("check stopped");
  });

  it("tries again once, at the end, a host that refused or failed for a moment", async () => {
    const world = createFakeWorld();
    const refused = new Set<string>();
    const pacer = createPacer({ intervalMs: 0, cooldownMs: 0, now: () => 0, sleep: () => Promise.resolve() });
    const flaky = createT18Client({
      pacer,
      userAgent: "test",
      fetch: (url, init) => {
        const host = new URL(url).hostname;
        if (host === ANDROMEDA && !refused.has(host)) {
          refused.add(host);
          return Promise.resolve(new Response("", { status: 429 }));
        }
        return world.fetch(url, init);
      },
    });

    const list = await buildT18Venues(flaky, { hosts: [ANDROMEDA, "lux.cdr.18tickets.it"], previous: null, now: () => 1 });

    expect(list.venues.map((venue) => venue.host)).toEqual([ANDROMEDA]);
    expect(list.checkedHosts).toEqual([ANDROMEDA, "lux.cdr.18tickets.it"]);
  });

  it("gives up on a host that keeps failing and keeps its previous data", async () => {
    const { t18, world } = client();
    const previous = await buildT18Venues(t18, { hosts: [ANDROMEDA], previous: null, now: () => 1 });
    world.setT18Page(ANDROMEDA, "/", 429);

    expect((await buildT18Venues(t18, { hosts: [ANDROMEDA], previous, now: () => 2 })).venues).toEqual(previous.venues);
    expect(world.t18Calls.filter((call) => call === `${ANDROMEDA}/`)).toHaveLength(3);
  });

  it("ignores a redirect to another place", async () => {
    const { t18, world } = client();
    world.setT18Page("cdr.18tickets.it", "/", 302);
    world.setT18Page("cdr.18tickets.it", "/select_cinema?mandatory=true", 404);

    await expect(buildT18Venues(t18, { hosts: ["cdr.18tickets.it"], previous: null, now: () => 1 })).rejects.toThrow("no cinemas");
  });

  it("saves and reads the list and tells when it is due", async () => {
    const dir = await mkdtemp(join(tmpdir(), "t18-"));
    const store = createStore(dir);
    const { t18 } = client();
    const list = await buildT18Venues(t18, { hosts: [ANDROMEDA], previous: null, now: () => 0 });

    expect(await loadT18Venues(store)).toBeNull();
    await saveT18Venues(store, list);
    expect(await loadT18Venues(store)).toEqual(list);
    await store.writeJson("t18-venues.json", { checkedAt: "x" });
    expect(await loadT18Venues(store)).toBeNull();
    expect(t18VenuesDue(null, 0)).toBe(true);
    expect(t18VenuesDue(list, 6 * DAY)).toBe(false);
    expect(t18VenuesDue(list, 7 * DAY)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
