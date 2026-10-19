import { describe, expect, it } from "vitest";
import { ApiShapeError, WebticError } from "../src/errors.js";
import { createHttpClient } from "../src/http.js";
import { regionOfPostalCode, regionOfProvince } from "../src/regions.js";
import { filterShowings } from "../src/uci.js";
import {
  createWebticDirectClient,
  localIdOfSlug,
  moviesOf,
  parseDirectOccupancy,
  parseMap,
  parsePerformanceInfo,
  parseScheduling,
  parseTitle,
  parseVenueCandidates,
  webticCartUrl,
  webticSlug,
} from "../src/webtic-direct.js";
import { createFakeWorld, fixture } from "./support/fake-world.js";

const MERLATA = "webtic-5779";
const NOW = new Date("2026-10-17T10:00:00Z");

function merlata() {
  return parseScheduling(fixture("webtic-direct/scheduling-5779.json"), MERLATA);
}

function all() {
  return [...merlata().values()].flat();
}

describe("parseVenueCandidates", () => {
  it("keeps the venues with films or a cinema name and drops UCI, stages and the rest", () => {
    const venues = parseVenueCandidates(fixture("webtic-direct/locals.json"));

    expect(venues.map((venue) => venue.slug)).toEqual(["webtic-5851", "webtic-5779", "webtic-5631", "webtic-5848"]);
  });

  it("maps a venue to a theatre with region, town and coordinates", () => {
    const venues = parseVenueCandidates(fixture("webtic-direct/locals.json"));

    expect(venues.find((venue) => venue.slug === MERLATA)).toEqual({
      slug: MERLATA,
      name: "Notorious Cascina Merlata",
      city: "Milano",
      province: "Milano",
      region: "Lombardia",
      isLuxe: false,
      screens: [],
      lat: 45.5111134,
      lon: 9.0989731,
      chain: "webtic",
    });
    expect(venues.find((venue) => venue.slug === "webtic-5848")).toMatchObject({ name: "Notorious Cinemas Ferrara", region: "Emilia Romagna", lat: null, lon: null });
  });

  it("rejects a refused or malformed answer", () => {
    expect(() => parseVenueCandidates(fixture("webtic-direct/scheduling-dead.json"))).toThrow(WebticError);
    expect(() => parseVenueCandidates({ DS: {} })).toThrow(ApiShapeError);
    expect(() => parseVenueCandidates({ userdata: { StatusOk: true }, DS: { LocalsTitles: "x" } })).toThrow(ApiShapeError);
  });

  it("tolerates broken entries and writes a lowercase town with capitals", () => {
    const venues = parseVenueCandidates({
      userdata: { StatusOk: true },
      DS: {
        LocalsTitles: {
          Locals: {
            "1": { LocalId: 1, Description: "CINEMA  PARIS", District: "", DistrictAbbreviation: "", Town: "sant'agata li battiati", Latitude: "abc", Longitude: "9" },
            "2": { LocalId: "x" },
            "3": null,
          },
          Titles: [{ Category: "DRAMMA", Locals: "bad" }, "x"],
        },
      },
    });

    expect(venues).toEqual([
      { slug: "webtic-1", name: "CINEMA PARIS", city: "Sant'Agata Li Battiati", province: null, region: null, isLuxe: false, screens: [], lat: null, lon: null, chain: "webtic" },
    ]);
  });
});

describe("parseTitle", () => {
  it("drops the language tag in brackets and the preview suffix", () => {
    expect(parseTitle("(Film In Inglese) Primetime")).toEqual({ title: "Primetime", slug: "primetime", edition: null });
    expect(parseTitle("(Lingua Orig) Avengers: Doomsday")).toEqual({ title: "Avengers: Doomsday", slug: "avengers-doomsday", edition: null });
    expect(parseTitle("Dune - Parte Tre Anteprima")).toEqual({ title: "Dune - Parte Tre", slug: "dune-parte-tre", edition: null });
  });

  it("reads the Infinity Vision edition from the title", () => {
    expect(parseTitle("Avengers: Doomsday Infinity Vision")).toEqual({ title: "Avengers: Doomsday", slug: "avengers-doomsday", edition: "INFINITY VISION" });
  });

  it("keeps a title that would become empty", () => {
    expect(parseTitle("(Kor) Anteprima").title).toBe("Anteprima");
    expect(parseTitle("(Kor)").title).toBe("(Kor)");
    expect(parseTitle("Fast & Furious - 25° Anniversario").slug).toBe("fast-furious-25-anniversario");
  });
});

describe("parseScheduling", () => {
  it("files the showings by cinema day, so the 00:10 of the 16th counts for the 15th", () => {
    const programming = merlata();
    const late = programming.get("2026-12-15")?.find((showing) => showing.key === "5779-52182");

    expect(late).toMatchObject({ day: "2026-12-15", startsAt: "2026-12-16T00:10:00", time: "00:10" });
  });

  it("reads a showing with the purchase link, the poster and the duration", () => {
    const dune = all().find((showing) => showing.key === "5779-51133");

    expect(dune).toEqual({
      key: "5779-51133",
      theatreSlug: MERLATA,
      movie: { slug: "dune-parte-tre", title: "Dune - Parte Tre", poster: "https://secure.webtic.it/api/HandlerLocandinaEx.ashx?idcinema=5779&idevento=1223&i=jpg-m&t=090920261302" },
      format: "2D",
      formatGroup: "2D",
      language: "ITA",
      day: "2026-12-15",
      startsAt: "2026-12-15T21:00:00",
      time: "21:00",
      room: "SALA 1",
      durationMinutes: 140,
      cartUrl: "https://secure.webtic.it/angwt/webtic.aspx?lid=5779&lng=it#/shoppingmode/it/0/5779/1223/51133",
    });
  });

  it("reads the language from the event properties", () => {
    const languages = new Map(all().map((showing) => [showing.cartUrl.split("/").at(-2), showing.language]));

    expect(languages.get("1337")).toBe("ENG");
    expect(languages.get("1343")).toBe("KOR");
    expect(languages.get("1291")).toBe("ITA");
  });

  it("gives the Infinity Vision titles an edition, so the hunt format picks only them", () => {
    const vision = filterShowings(all(), { movieSlugs: ["avengers-doomsday"], formats: ["INFINITY VISION"] }, NOW);

    expect(new Set(vision.map((showing) => showing.cartUrl.split("/").at(-2)))).toEqual(new Set(["1289"]));
    expect(vision[0]).toMatchObject({ format: "2D - INFINITY VISION", formatGroup: "2D" });
    expect(filterShowings(all(), { movieSlugs: ["avengers-doomsday"], formats: ["2D"] }, NOW)).toHaveLength(11);
  });

  it("keeps only the films and drops plays and concerts", () => {
    const showings = [...parseScheduling(fixture("webtic-direct/scheduling-5851.json"), "webtic-5851").values()].flat();

    expect(new Set(showings.map((showing) => showing.movie.title))).toEqual(new Set(["Fammi Il Piacere"]));
  });

  it("skips broken events, days and showings and defaults the format", () => {
    const programming = parseScheduling(
      {
        userdata: { StatusOk: true },
        DS: {
          Scheduling: {
            LocalId: 9,
            Events: [
              null,
              { EventId: 1, Title: "Film 3D", Type: "cinema", Is3D: true, Duration: null, Picture: "http://x/y.jpg", Days: [{ Day: "bad", Performances: [] }, { Day: "2026-11-02T00:00:00", Performances: [{ PerformanceId: 4, Time: "9:05", ScreenName: " SALA  A ", StartTime: "2026-11-02T09:05:00" }, { PerformanceId: 5 }] }] },
              { EventId: 2, Title: "Film", Type: "CINEMA", Picture: "", EventProperties: [{ EventProperty: "O.V." }], Days: [{ Day: "2026-11-02T00:00:00", Performances: [{ PerformanceId: 6, Time: "21:00", StartTime: "2026-11-02T21:00:00" }] }] },
            ],
          },
        },
      },
      "webtic-9",
    );
    const [first, second] = programming.get("2026-11-02") ?? [];

    expect(first).toMatchObject({ key: "9-4", format: "3D", time: "09:05", room: "SALA A", durationMinutes: null, movie: { poster: null }, language: "ITA" });
    expect(second).toMatchObject({ key: "9-6", format: "2D", language: null, room: "", movie: { poster: null } });
  });

  it("gives a film without Latin letters a slug of its own", () => {
    const programming = parseScheduling(
      { userdata: { StatusOk: true }, DS: { Scheduling: { LocalId: 9, Events: [{ EventId: 77, Title: "君の名は", Type: "CINEMA", Days: [{ Day: "2026-11-02T00:00:00", Performances: [{ PerformanceId: 1, Time: "21:00", StartTime: "2026-11-02T21:00:00" }] }] }] } } },
      "webtic-9",
    );

    expect(programming.get("2026-11-02")?.[0]?.movie.slug).toBe("film-77");
  });

  it("rejects a cinema that Webtic refuses", () => {
    expect(() => parseScheduling(fixture("webtic-direct/scheduling-dead.json"), MERLATA)).toThrow(WebticError);
  });
});

describe("moviesOf", () => {
  it("joins the formats and the dates of a film across its titles", () => {
    const avengers = moviesOf(merlata()).find((movie) => movie.slug === "avengers-doomsday");

    expect(avengers).toMatchObject({ title: "Avengers: Doomsday", firstDay: "2026-12-15", lastDay: "2026-12-17", formats: ["2D", "INFINITY VISION"] });
    expect(moviesOf(merlata()).map((movie) => movie.slug)).toEqual(["avengers-doomsday", "dune-parte-tre", "primetime", "stray-kids-wt-run-it-live-view"]);
  });
});

describe("seats", () => {
  it("reads the performance without a price", () => {
    expect(parsePerformanceInfo(fixture("webtic-direct/performance-5779-51133.json"))).toEqual({
      key: "5779-51133",
      hallKey: "5779-233",
      eventRef: "1223",
      screenName: "SALA 1",
      startTime: "2026-12-15T21:00:00",
      title: "Dune - Parte Tre",
      priceFrom: null,
    });
  });

  it("reads the map with the same axis as UCI: row A is Row 2", () => {
    const hall = parseMap(fixture("webtic-direct/map-5779-233.json"), 5779, 233, 1);

    expect(hall.seats).toHaveLength(188);
    expect(hall.seats[0]).toEqual({ id: "A/24", rowLabel: "A", number: 24, row: 2, column: 2, sector: "PT", type: "STANDARD" });
    expect(hall).toMatchObject({ key: "5779-233", fetchedAt: 1 });
  });

  it("refuses a map without seats", () => {
    expect(() => parseMap({ userdata: { StatusOk: true }, DS: { MapSeats: { posti: [{ idposto: "" }] } } }, 1, 1, 1)).toThrow(ApiShapeError);
  });

  it("reads sold and blocked seats", () => {
    const occupancy = parseDirectOccupancy(fixture("webtic-direct/occupancy-5779-51133.json"), 5779, 51133);
    const statuses = Object.values(occupancy.taken);

    expect(statuses.filter((status) => status === "sold")).toHaveLength(47);
    expect(statuses.filter((status) => status === "blocked")).toHaveLength(3);
    expect(parseDirectOccupancy({ userdata: { StatusOk: true }, DS: { Occupancy: { posti: [{ idposto: "A/1", status: "ALTRO" }] } } }, 1, 2).taken).toEqual({ "A/1": "other" });
  });
});

describe("slugs and links", () => {
  it("turns a LocalId into a slug and back", () => {
    expect(webticSlug(5779)).toBe(MERLATA);
    expect(localIdOfSlug(MERLATA)).toBe(5779);
    expect(localIdOfSlug("uci-cinemas-verona")).toBeNull();
    expect(localIdOfSlug("webtic-007")).toBeNull();
    expect(localIdOfSlug("webtic-0")).toBeNull();
    expect(webticCartUrl(1, 2, 3)).toBe("https://secure.webtic.it/angwt/webtic.aspx?lid=1&lng=it#/shoppingmode/it/0/1/2/3");
  });

  it("knows the region of every province abbreviation it meets", () => {
    expect(regionOfProvince("mi ")).toBe("Lombardia");
    expect(regionOfProvince("SU")).toBe("Sardegna");
    expect(regionOfPostalCode("65015")).toBe("Abruzzo");
    expect(regionOfPostalCode("16128")).toBe("Liguria");
    expect(regionOfPostalCode("00100")).toBe("Lazio");
    expect(regionOfPostalCode("49000")).toBeNull();
    expect(regionOfPostalCode("1234")).toBeNull();
    expect(regionOfProvince("00")).toBeNull();
  });
});

describe("createWebticDirectClient", () => {
  function client() {
    const world = createFakeWorld();
    const http = createHttpClient({ allowedHosts: ["secure.webtic.it"], userAgent: "test", fetch: world.fetch });
    return { world, direct: createWebticDirectClient(http) };
  }

  it("reads venues, programming, performance, map and occupancy from the public API", async () => {
    const { world, direct } = client();

    expect(await direct.venueCandidates()).toHaveLength(4);
    expect((await direct.scheduling(5779)).get("2026-12-15")).toHaveLength(4);
    expect((await direct.seats.performance(5779, 51133)).hallKey).toBe("5779-233");
    expect((await direct.seats.screen(5779, 233, 5)).seats).toHaveLength(188);
    expect(Object.keys((await direct.seats.occupancy(5779, 51133)).taken)).toHaveLength(50);
    expect(world.requests).toEqual([
      "GET secure.webtic.it/api/wtjsonservices.ashx",
      "GET secure.webtic.it/api/wtjsonservices.ashx",
      "GET secure.webtic.it/api/wtjsonservices.ashx",
      "POST secure.webtic.it/api/wtjsonservices.ashx",
      "POST secure.webtic.it/api/wtjsonservices.ashx",
    ]);
  });

  it("refuses ids that are not positive integers before calling", async () => {
    const { world, direct } = client();

    await expect(direct.scheduling(0)).rejects.toThrow(ApiShapeError);
    await expect(direct.seats.performance(5779, -1)).rejects.toThrow(ApiShapeError);
    await expect(direct.seats.occupancy(1.5, 1)).rejects.toThrow(ApiShapeError);
    await expect(direct.seats.screen(5779, 0, 1)).rejects.toThrow(ApiShapeError);
    expect(world.requests).toEqual([]);
  });
});
