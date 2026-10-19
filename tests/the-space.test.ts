import { describe, expect, it } from "vitest";
import {
  buildSpaceVenues,
  cinemaIdOfSlug,
  createSpaceClient,
  isSpaceKey,
  parseCinemaPage,
  parseCinemas,
  parseFilms,
  parseProgramming,
  parseSeats,
  spaceHallKey,
  theatreOf,
} from "../src/circuits/the-space.js";
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

  it("builds the list of cinemas with the place read from each page", async () => {
    const { space } = client();

    const list = await buildSpaceVenues(space, () => 42);

    expect(list.checkedAt).toBe(42);
    expect(list.theatres).toHaveLength(35);
    expect(list.theatres.find((theatre) => theatre.slug === "space-1028")).toMatchObject({ region: "Piemonte", lat: 45.021899 });
    await expect(space.cinemaPage("https://www.thespacecinema.it/manca")).rejects.toThrow("Status 401");
  });
});
