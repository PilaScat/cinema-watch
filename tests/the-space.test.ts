import { describe, expect, it } from "vitest";
import {
  buildSpaceVenues,
  cinemaIdOfSlug,
  createSpaceCircuit,
  createSpaceClient,
  isSpaceKey,
  parseCinemaPage,
  parseCinemas,
  parseFilms,
  parseProgramming,
  parseSeats,
  spaceHallKey,
  theatreOf,
  type SpaceClient,
  type SpaceSeats,
} from "../src/circuits/the-space.js";
import { createTtlCache } from "../src/cache.js";
import type { PerformanceInfo, Seat } from "../src/types.js";
import { ApiShapeError } from "../src/errors.js";
import { createGuardedFetch, createHttpClient } from "../src/http.js";
import { analyzeSeats, DEFAULT_SELLABLE_TYPES } from "../src/seats.js";
import { createFakeWorld, fixture, textFixture } from "./support/fake-world.js";

const HOST = "www.thespacecinema.it";

function all() {
  return [...parseProgramming(fixture("space/programming-1028.json"), "1028").values()].flat();
}

function showing(sessionId: string) {
  return all().find((item) => item.key === `space-1028-${sessionId}`);
}

describe("cinemas", () => {
  it("lists the 35 cinemas with their page", () => {
    const cinemas = parseCinemas(fixture("space/cinemas.json"));

    expect(cinemas).toHaveLength(35);
    expect(cinemas.find((cinema) => cinema.cinemaId === "1028")).toEqual({ cinemaId: "1028", name: "Beinasco", pageUrl: "https://www.thespacecinema.it/cinema/beinasco/al-cinema" });
  });

  it("reads coordinates and province from the page of a cinema", () => {
    const page = parseCinemaPage(textFixture("space/cinema-beinasco.html"));

    expect(page).toEqual({ lat: 45.021899, lon: 7.594591, province: "TO", postalCode: "10149" });
    expect(theatreOf({ cinemaId: "1028", name: "Beinasco", pageUrl: null }, page)).toEqual({
      slug: "space-1028",
      name: "The Space Beinasco",
      city: "Beinasco",
      province: "TO",
      region: "Piemonte",
      isLuxe: false,
      screens: [],
      lat: 45.021899,
      lon: 7.594591,
      chain: "space",
    });
  });

  it("leaves place fields empty when the page has none", () => {
    expect(parseCinemaPage("<html></html>")).toEqual({ lat: null, lon: null, province: null, postalCode: null });
    expect(parseCinemaPage("q=0, 0")).toEqual({ lat: null, lon: null, province: null, postalCode: null });
    expect(theatreOf({ cinemaId: "9", name: "X", pageUrl: null }, null)).toMatchObject({ region: null, lat: null, province: null });
  });

  it("keeps coordinates up to the edge of the map and drops both when one is zero or off the map", () => {
    const at = (lat: string, lon: string) => {
      const page = parseCinemaPage(`<a href="https://maps.example/?q=${lat},${lon}">map</a>`);
      return [page.lat, page.lon];
    };

    expect(at("-45.5", "-7.25")).toEqual([-45.5, -7.25]);
    expect(at("90", "180")).toEqual([90, 180]);
    expect(at("-90", "-180")).toEqual([-90, -180]);
    expect(at("0", "7.5")).toEqual([null, null]);
    expect(at("45.5", "0")).toEqual([null, null]);
    expect(at("90.5", "7.5")).toEqual([null, null]);
    expect(at("-90.5", "7.5")).toEqual([null, null]);
    expect(at("45.5", "180.5")).toEqual([null, null]);
    expect(at("45.5", "-180.5")).toEqual([null, null]);
  });

  it("tells an answer of the wrong shape from a result that is not a list", () => {
    expect(() => parseCinemas(null)).toThrow("cinemas: unexpected shape");
    expect(() => parseCinemas("x")).toThrow("cinemas: unexpected shape");
    expect(() => parseCinemas({})).toThrow("cinemas: unexpected shape");
    expect(() => parseCinemas({ result: null })).toThrow("cinemas: unexpected shape");
    expect(() => parseCinemas({ result: 0 })).toThrow("cinemas: not a list");
    expect(() => parseCinemas({ result: "x" })).toThrow("cinemas: not a list");
    expect(parseCinemas({ result: [] })).toEqual([]);
  });

  it("takes the region from the postal code when the address has no province", () => {
    const region = (address: string) => theatreOf({ cinemaId: "1", name: "X", pageUrl: null }, parseCinemaPage(`<address class="a">${address}</address>`)).region;

    expect(region("Viale Europa, 5 Bologna 40128")).toBe("Emilia Romagna");
    expect(region("Via Noicattaro, 2 Casamassima (Bari) 70010 - presso Parco Commerciale Casamassima")).toBe("Puglia");
    expect(region("Via Pierluigi Nervi Corciano 06073")).toBe("Umbria");
    expect(region("Via Boscofangone, 80035 Località Gallo NA presso Centro Commerciale Vulcano Buono")).toBe("Campania");
    expect(region("Via Senza Numero")).toBeNull();
  });

  it("rejects an answer without a result", () => {
    expect(() => parseCinemas({ result: null })).toThrow(ApiShapeError);
    expect(() => parseCinemas({ result: "x" })).toThrow(ApiShapeError);
  });
});

describe("programming", () => {
  it("reads a session with its key, room, language, purchase link and poster", () => {
    expect(showing("58489")).toEqual({
      key: "space-1028-58489",
      theatreSlug: "space-1028",
      movie: {
        slug: "avengers-doomsday",
        title: "AVENGERS: DOOMSDAY",
        poster: "https://www.thespacecinema.it/-/media/the-space-cinema/schede-film/2026/12/avengers-doomsday/locandina_avengersdoomsday.jpg?rev=0c8d5108eb654969bd3988bc31029aa1",
      },
      format: "2D",
      formatGroup: "2D",
      language: "ITA",
      day: "2026-12-16",
      startsAt: "2026-12-16T14:10:00",
      time: "14:10",
      room: "Sala 7",
      durationMinutes: 165,
      cartUrl: "https://www.thespacecinema.it/prenotare-il-biglietto/summary/1028/HO00003467/58489",
    });
  });

  it("keeps the sessions after midnight in the day of the cinema", () => {
    const late = all().filter((item) => item.day === "2026-12-15");

    expect(late).toHaveLength(5);
    expect(late.every((item) => item.startsAt.startsWith("2026-12-16T00:"))).toBe(true);
  });

  it("reads Infinity Vision as an edition, 3D as the screen and the original language", () => {
    expect(showing("58192")).toMatchObject({ format: "2D - INFINITY VISION", formatGroup: "2D" });
    expect(showing("58203")).toMatchObject({ format: "3D", formatGroup: "3D" });
    expect(showing("58196")?.language).toBe("VO");
  });

  it("skips films without sessions and broken entries", () => {
    const programming = parseProgramming(
      {
        result: [
          null,
          { filmId: "HO1", filmTitle: "Senza", showingGroups: [] },
          { filmId: "HO2", filmTitle: "(Kor)", showingGroups: [{ date: "bad", sessions: [] }, { date: "2026-11-02T00:00:00", sessions: [{ sessionId: "7", startTime: "2026-11-02T21:00:00", attributes: [{ value: "" }] }, { sessionId: "x" }] }] },
        ],
      },
      "9",
    );

    expect([...programming.keys()]).toEqual(["2026-11-02"]);
    expect(programming.get("2026-11-02")).toEqual([
      expect.objectContaining({ key: "space-9-7", movie: { slug: "kor", title: "(Kor)", poster: null }, format: "2D", language: null, room: "", cartUrl: "https://www.thespacecinema.it", durationMinutes: null }) as unknown,
    ]);
  });
});

describe("films", () => {
  it("lists the films with their release day and the cinemas that show them", () => {
    const films = parseFilms(fixture("space/films.json"));
    const avengers = films.find((film) => film.slug === "avengers-doomsday");

    expect(avengers).toMatchObject({ title: "AVENGERS: DOOMSDAY", firstDay: "2026-12-16", lastDay: null, formats: [] });
    expect(avengers?.cinemaIds).toContain("1028");
    expect(parseFilms({ result: [{ filmId: "HO9", filmTitle: "ゴジラ", releaseDate: null }] })[0]).toMatchObject({ slug: "film-ho9", firstDay: null });
  });
});

describe("seats", () => {
  const read = () => parseSeats(fixture("space/seats-1028-58489.json"));

  it("reads the hall of Sala 7 with row A first, as the site shows it", () => {
    const seats = read();

    expect(seats.screenName).toBe("Sala 7");
    expect(seats.seats).toHaveLength(243);
    expect(seats.seats[0]).toEqual({ id: "A22", rowLabel: "A", number: 22, row: 1, column: 1, sector: "0000000005", type: "STANDARD" });
    expect(seats.seats.filter((seat) => seat.rowLabel === "E")[0]?.row).toBe(6);
  });

  it("counts sold seats, keeps wheelchair and companion seats apart and takes the price from the sellable areas", () => {
    const seats = read();
    const analysis = analyzeSeats({ key: "space-1028-sala-7", seats: seats.seats, fetchedAt: 0 }, { key: "space-1028-58489", taken: seats.taken }, {
      zone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
      together: 2,
      sellableTypes: DEFAULT_SELLABLE_TYPES,
    });

    expect(Object.values(seats.taken)).toEqual(Array<string>(6).fill("sold"));
    expect(seats.seats.filter((seat) => seat.sector === "UN")).toHaveLength(4);
    expect(analysis.sellable).toBe(239);
    expect(analysis.free).toBe(233);
    expect(seats.priceFrom).toBe(4.7);
  });

  it("maps every seat status", () => {
    const seat = (name: string, seatStatus: number) => ({ name, seatStatus, areaCategoryCode: "A" });
    const parsed = parseSeats({
      result: {
        seatRows: [{ rowLabel: "A", columns: [seat("A1", 4), seat("A2", 8), seat("A3", 10), seat("A4", 9), seat("A5", 11), seat("A6", 12), seat("A7", 5), null] }],
        areaCategories: [{ areaCategoryCode: "A", areaMainPriceInCents: null }],
      },
    });

    expect(parsed.taken).toEqual({ A1: "blocked", A2: "blocked", A3: "blocked", A4: "sold", A5: "sold" });
    expect(parsed.seats.map((item) => item.type)).toEqual(["STANDARD", "DISABILE", "DISABILE", "DISABILE", "DISABILE", "RISERVATO"]);
    expect(parsed.priceFrom).toBeNull();
    expect(parsed.screenName).toBe("");
  });

  it("refuses a hall without seats or of an unexpected shape", () => {
    expect(() => parseSeats({ result: { seatRows: [] } })).toThrow("no seats");
    expect(() => parseSeats({ result: { seatRows: "x" } })).toThrow(ApiShapeError);
  });
});

describe("keys and slugs", () => {
  it("recognises The Space slugs, keys and halls", () => {
    expect(cinemaIdOfSlug("space-1028")).toBe("1028");
    expect(cinemaIdOfSlug("webtic-1028")).toBeNull();
    expect(isSpaceKey("space-1028-58489")).toBe(true);
    expect(isSpaceKey("1028-58489")).toBe(false);
    expect(spaceHallKey("1028", "Sala 7")).toBe("space-1028-sala-7");
    expect(spaceHallKey("1028", "!!")).toBe("space-1028-sala");
  });
});

describe("client", () => {
  function client(world = createFakeWorld(), now = () => 0) {
    const http = createHttpClient({ allowedHosts: [HOST], userAgent: "test", fetch: world.fetch, now });
    return { world, space: createSpaceClient({ http, fetch: createGuardedFetch([HOST], world.fetch), userAgent: "test", now }) };
  }

  it("asks a guest token once and reuses it", async () => {
    const { world, space } = client();

    expect(await space.cinemas()).toHaveLength(35);
    expect((await space.programming("1028")).get("2026-12-16")).toHaveLength(4);
    expect((await space.seats("1028", "58489")).seats).toHaveLength(243);
    expect(await space.films()).toHaveLength(3);
    expect(world.spaceCalls.filter((call) => call === "/auth/token")).toHaveLength(1);
  });

  it("asks a new token when the old one is refused or has expired", async () => {
    let clock = 0;
    const { world, space } = client(createFakeWorld(), () => clock);
    await space.cinemas();
    world.expireSpaceToken();

    expect(await space.cinemas()).toHaveLength(35);
    clock = 12 * 60 * 60 * 1000;
    await space.cinemas();
    expect(world.spaceCalls.filter((call) => call === "/auth/token")).toHaveLength(3);
  });

  it("waits a minute before asking a refused guest token again", async () => {
    const world = createFakeWorld();
    let clock = 0;
    let asked = 0;
    const refuse = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname.endsWith("/auth/token")) return world.fetch(input, init);
      asked += 1;
      return Promise.resolve(new Response("", { status: 429 }));
    };
    const http = createHttpClient({ allowedHosts: [HOST], userAgent: "test", fetch: refuse });
    const space = createSpaceClient({ http, fetch: createGuardedFetch([HOST], refuse), userAgent: "test", now: () => clock });

    await expect(space.cinemas()).rejects.toThrow("guest token refused (429)");
    await expect(space.programming("1028")).rejects.toThrow("guest token refused (429)");
    const whileWaiting = asked;
    clock = 61_000;
    await expect(space.cinemas()).rejects.toThrow("guest token refused (429)");

    expect(whileWaiting).toBe(1);
    expect(asked).toBe(2);
  });

  it("fails clearly when the guest token is refused and passes other errors on", async () => {
    const world = createFakeWorld();
    const refuse = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname.endsWith("/auth/token") ? Promise.resolve(new Response("", { status: 403 })) : world.fetch(input, init);
    const http = createHttpClient({ allowedHosts: [HOST], userAgent: "test", fetch: refuse });
    const space = createSpaceClient({ http, fetch: createGuardedFetch([HOST], refuse), userAgent: "test", now: () => 0 });

    await expect(space.cinemas()).rejects.toThrow("guest token refused (403)");
    const { space: working } = client();
    await expect(working.seats("1028", "1")).rejects.toThrow("Status 404");
  });

  it("keeps the token up to its last millisecond and renews it at the eleventh hour", async () => {
    let clock = 0;
    const { world, space } = client(createFakeWorld(), () => clock);
    const tokens = () => world.spaceCalls.filter((call) => call === "/auth/token").length;
    await space.cinemas();

    clock = 11 * 60 * 60 * 1000 - 1;
    await space.cinemas();
    const beforeExpiry = tokens();
    clock = 11 * 60 * 60 * 1000;
    await space.cinemas();

    expect(beforeExpiry).toBe(1);
    expect(tokens()).toBe(2);
  });

  it("does not ask a new token after an error that is not a refusal", async () => {
    const { world, space } = client();

    await expect(space.seats("1028", "1")).rejects.toThrow("Status 404");

    expect(world.spaceCalls.filter((call) => call === "/auth/token")).toHaveLength(1);
    expect(world.spaceCalls.filter((call) => call.includes("/seats"))).toHaveLength(1);
  });

  it("names the app when it asks the token and the page of a cinema", async () => {
    const world = createFakeWorld();
    const sent: Array<{ path: string; method: string; headers: Headers }> = [];
    const spy = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      sent.push({ path: new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
      return world.fetch(input, init);
    };
    const http = createHttpClient({ allowedHosts: [HOST], userAgent: "test", fetch: world.fetch });
    const space = createSpaceClient({ http, fetch: createGuardedFetch([HOST], spy), userAgent: "cinema-watch/test", now: () => 0 });

    await space.cinemas();
    await space.cinemaPage("https://www.thespacecinema.it/cinema/beinasco/al-cinema");

    const token = sent.find((call) => call.path.endsWith("/auth/token"));
    const page = sent.find((call) => call.path === "/cinema/beinasco/al-cinema");
    expect(token?.method).toBe("POST");
    expect(token?.headers.get("user-agent")).toBe("cinema-watch/test");
    expect(token?.headers.get("accept")).toBe("application/json");
    expect(page?.headers.get("user-agent")).toBe("cinema-watch/test");
  });

  it("builds the list of cinemas with the place read from each page", async () => {
    const { space } = client();

    const list = await buildSpaceVenues(space, () => 42);

    expect(list.checkedAt).toBe(42);
    expect(list.theatres).toHaveLength(35);
    expect(list.theatres.find((theatre) => theatre.slug === "space-1028")).toMatchObject({ region: "Piemonte", lat: 45.021899 });
    await expect(space.cinemaPage("https://www.thespacecinema.it/manca")).rejects.toThrow("Status 401");
  });
});

describe("circuit", () => {
  const KEY = "space-1028-58489";
  const PERFORMANCE: PerformanceInfo = { key: KEY, hallKey: "space-1028-sala-7", eventRef: "", screenName: "Sala 7", startTime: "2026-12-16T14:10:00", title: "AVENGERS: DOOMSDAY", priceFrom: null, priceTiers: [] };
  const seat =(id: string): Seat => ({ id, rowLabel: id.slice(0, 1), number: Number(id.slice(1)), row: 1, column: Number(id.slice(1)), sector: "A", type: "STANDARD" });

  function circuit() {
    let programming = parseProgramming(fixture("space/programming-1028.json"), "1028");
    let seats: SpaceSeats = { screenName: "Sala 7", seats: [seat("A1"), seat("A2")], taken: { A1: "sold" }, priceFrom: 9.2, priceTiers: [{ sector: "A", name: "", price: 9.2 }] };
    const calls = { programming: 0, seats: 0 };
    const client = {
      programming: () => {
        calls.programming += 1;
        return Promise.resolve(programming);
      },
      seats: () => {
        calls.seats += 1;
        return Promise.resolve(seats);
      },
    } as unknown as SpaceClient;
    const subject = createSpaceCircuit({ client, schedule: createTtlCache({ ttlMs: 60_000 }), seats: createTtlCache({ ttlMs: 60_000 }), describe: () => null, now: () => 77 });
    return {
      subject,
      calls,
      setSeats: (next: Partial<SpaceSeats>) => {
        seats = { ...seats, ...next };
      },
      setProgramming: (next: typeof programming) => {
        programming = next;
      },
    };
  }

  it("reads the seats of a session it has not listed yet, with its hall, time, title and prices", async () => {
    const { subject, calls } = circuit();

    const read = await subject.seats(KEY, false);

    expect(calls.programming).toBe(1);
    expect(read.performance).toEqual({ key: KEY, hallKey: "space-1028-sala-7", eventRef: "", screenName: "Sala 7", startTime: "2026-12-16T14:10:00", title: "AVENGERS: DOOMSDAY", priceFrom: 9.2, priceTiers: [{ sector: "A", name: "", price: 9.2 }] });
    expect(read.hall).toEqual({ key: "space-1028-sala-7", seats: [seat("A1"), seat("A2")], fetchedAt: 77 });
    expect(read.occupancy).toEqual({ key: KEY, taken: { A1: "sold" } });
    expect(read.hallChanged).toBe(false);
  });

  it("says the hall changed only when its seats are different, whatever their order", async () => {
    const { subject, setSeats } = circuit();
    const first = await subject.seats(KEY, true);
    setSeats({ seats: [seat("A2"), seat("A1")] });
    const reordered = await subject.seats(KEY, true);
    setSeats({ seats: [seat("A1"), seat("A2"), seat("A3")] });
    const grown = await subject.seats(KEY, true);
    const settled = await subject.seats(KEY, true);
    setSeats({ screenName: "Sala 8", seats: [seat("B1")] });
    const otherHall = await subject.seats(KEY, true);

    expect([first, reordered, grown, settled, otherHall].map((read) => read.hallChanged)).toEqual([false, false, true, false, false]);
    expect(otherHall.hall.key).toBe("space-1028-sala-8");
  });

  it("reads the seats again only when asked for fresh ones", async () => {
    const { subject, calls } = circuit();

    await subject.seats(KEY, false);
    await subject.seats(KEY, false);
    const cached = calls.seats;
    await subject.seats(KEY, true);

    expect(cached).toBe(1);
    expect(calls.seats).toBe(2);
  });

  it("refuses a session that the programme does not have", async () => {
    const { subject } = circuit();

    await expect(subject.seats("space-1028-1", false)).rejects.toThrow("unknown session: space-1028-1");
  });

  it("forgets the sessions that left the programme and gives the days asked, empty ones included", async () => {
    const { subject, setProgramming } = circuit();
    await subject.programming("space-1028", false);
    const known = subject.cartUrl(KEY, PERFORMANCE, undefined);
    setProgramming(new Map());
    await subject.programming("space-1028", false);

    expect(known).toBe("https://www.thespacecinema.it/prenotare-il-biglietto/summary/1028/HO00003467/58489");
    expect(subject.cartUrl(KEY, PERFORMANCE, undefined)).toBeNull();
    expect(await subject.programmingDays("space-1028", ["2026-12-16", "2026-12-17"], true)).toEqual([
      { day: "2026-12-16", showings: [] },
      { day: "2026-12-17", showings: [] },
    ]);
  });
});
