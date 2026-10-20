import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { ApiShapeError } from "../src/errors.js";
import type { HttpClient, Showing } from "../src/types.js";
import {
  UCI_API_BASE,
  UCI_HEADERS,
  createUciClient,
  filterShowings,
  formatEdition,
  matchesTitle,
  normalizeFormat,
  normalizeTitle,
  parseCartLink,
  parseMovie,
  parseMovieTheatres,
  parseProgrammingAll,
  parseProgrammingDay,
  parseTheatres,
} from "../src/uci.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/uci/${name}`, import.meta.url), "utf8"));
}

const verona15 = fixture("programming-uci-cinemas-verona-2026-12-15.json");
const verona16 = fixture("programming-uci-cinemas-verona-2026-12-16.json");
const campi = fixture("programming-uci-cinemas-campi-bisenzio-firenze-2026-10-16.json");

describe("normalizeFormat", () => {
  it.each([
    ["XL - INFINITY VISION", "XL"],
    ["2D - INFINITY VISION", "2D"],
    ["IMAX", "IMAX"],
    ["XL", "XL"],
    ["3D", "3D"],
    ["ISENSE", "ISENSE"],
    ["SCREENX", "SCREENX"],
    ["LUXE", "LUXE"],
    ["  screenx ", "SCREENX"],
    ["", ""],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeFormat(raw)).toBe(expected);
  });
});

describe("parseCartLink", () => {
  it("parses valid links", () => {
    expect(parseCartLink("/movies/dune-parte-tre/acquista/5116/9803/575978")).toEqual({
      movieSlug: "dune-parte-tre",
      localId: 5116,
      eventId: 9803,
      performanceId: 575978,
    });
  });

  it.each(["", "/movies/x/acquista/1/2", "/movies/x/acquista/a/2/3", "https://x/movies/x/acquista/1/2/3", "/movies/X/acquista/1/2/3"])(
    "rejects %j",
    (link) => {
      expect(parseCartLink(link)).toBeNull();
    },
  );
});

describe("parseTheatres", () => {
  it("parses the real list", () => {
    const theatres = parseTheatres(fixture("theatres.json"));
    expect(theatres).toHaveLength(33);
    expect(theatres.filter((t) => t.isLuxe)).toHaveLength(6);
    expect(theatres[0]).toEqual({
      slug: "uci-cinemas-arezzo",
      name: "UCI Cinemas Arezzo",
      city: "Arezzo",
      province: "Arezzo",
      region: "Toscana",
      isLuxe: false,
      screens: ["XL", "2D"],
      lat: 43.479041403496964,
      lon: 11.869633503004069,
      chain: "uci",
    });
  });

  it("drops entries without slug and tolerates missing fields", () => {
    const theatres = parseTheatres({
      data: [{ name: "no slug" }, null, "x", { slug: "a", province: null, screens: "bad", is_luxe: "yes" }],
    });
    expect(theatres).toEqual([
      { slug: "a", name: "", city: "", province: null, region: null, isLuxe: false, screens: [], lat: null, lon: null, chain: "uci" },
    ]);
  });
});

describe("parseProgrammingDay", () => {
  it("finds exactly one IMAX Dune showing in Verona on 15/12", () => {
    const dune = parseProgrammingDay(verona15, "uci-cinemas-verona").filter((s) => s.movie.slug === "dune-parte-tre");
    expect(dune).toHaveLength(1);
    expect(dune[0]).toMatchObject({
      key: "5116-575978",
      theatreSlug: "uci-cinemas-verona",
      format: "IMAX",
      formatGroup: "IMAX",
      language: "ITA",
      day: "2026-12-15",
      startsAt: "2026-12-15T20:30:00",
      time: "20:30",
      room: "SALA 1 IMAX",
      durationMinutes: 140,
      cartUrl: "https://ucicinemas.it/movies/dune-parte-tre/acquista/5116/9803/575978",
    });
    expect(dune[0]?.movie.title).toBe("Dune: Parte Tre");
    expect(dune[0]?.movie.poster).toMatch(/^https:/);
  });

  it("keeps the cinema day for after-midnight showings", () => {
    const avengers = parseProgrammingDay(verona15, "uci-cinemas-verona").filter(
      (s) => s.movie.slug === "avengers-doomsday",
    );
    expect(avengers).toHaveLength(7);
    const first = avengers.find((s) => s.time === "00:01");
    expect(first).toMatchObject({
      day: "2026-12-15",
      startsAt: "2026-12-16T00:01:00",
      format: "XL - INFINITY VISION",
      formatGroup: "XL",
    });
    expect(avengers.filter((s) => s.language === "ENG")).toHaveLength(1);
    expect(avengers.every((s) => s.day === "2026-12-15")).toBe(true);
  });

  it("parses the 16/12 programming", () => {
    expect(parseProgrammingDay(verona16, "uci-cinemas-verona").length).toBeGreaterThan(0);
  });

  it("normalizes formats on Campi Bisenzio", () => {
    const showings = parseProgrammingDay(campi, "uci-cinemas-campi-bisenzio-firenze");
    expect(showings).toHaveLength(13);
    const endgame = showings.find((s) => s.movie.slug === "avengers-endgame-extra-infinity-vision");
    expect(endgame).toMatchObject({ format: "2D - INFINITY VISION", formatGroup: "2D", durationMinutes: 185 });
    expect(showings.filter((s) => s.formatGroup === "XL")).toHaveLength(3);
    expect(new Set(showings.map((s) => s.key)).size).toBe(showings.length);
  });

  it("discards showings with a missing or invalid cart link and malformed performances", () => {
    const perf = {
      day: "2026-10-16",
      starts_at: "2026-10-16 18:00:00",
      actual_start_at: "8:05",
      room: "S",
      cart_link: "/movies/m/acquista/1/2/3",
    };
    const json = {
      data: [
        {
          slug: "m",
          title: "  Movie  ",
          poster: null,
          screens: [
            {
              "2D": [
                {
                  language: null,
                  duration: "bad",
                  performances: [
                    perf,
                    { ...perf, cart_link: "/oops" },
                    { ...perf, cart_link: undefined },
                    { ...perf, day: "2026-13-45" },
                    { ...perf, starts_at: "soon" },
                    { ...perf, actual_start_at: "" },
                    null,
                  ],
                },
                null,
                { language: "x", duration: null, performances: "bad" },
              ],
              BAD: "nope",
            },
            null,
            "x",
          ],
        },
        { slug: "no-title" },
        { slug: "no-screens", title: "T" },
        { slug: "bad-screens", title: "T", screens: "x" },
      ],
    };
    const showings = parseProgrammingDay(json, "t");
    expect(showings).toHaveLength(1);
    expect(showings[0]).toMatchObject({
      key: "1-3",
      time: "08:05",
      language: null,
      durationMinutes: null,
      movie: { title: "Movie", poster: null },
    });
  });

  it.each([null, {}, { data: "x" }, { data: null }, "<html></html>", 42, []])("rejects malformed root %j", (json) => {
    expect(() => parseProgrammingDay(json, "t")).toThrow(ApiShapeError);
  });

  it("accepts an empty data array", () => {
    expect(parseProgrammingDay({ data: [] }, "t")).toEqual([]);
  });
});

describe("parseProgrammingAll", () => {
  it("groups showings by day and ignores invalid entries", () => {
    const day15 = (verona15 as { data: unknown[] }).data;
    const day16 = (verona16 as { data: unknown[] }).data;
    const all = parseProgrammingAll(
      { data: [{ "2026-12-15": day15, "2026-12-16": day16, nonsense: day15, "2026-12-17": "x" }, null, "s", { "2026-12-15": [] }] },
      "uci-cinemas-verona",
    );
    expect([...all.keys()]).toEqual(["2026-12-15", "2026-12-16"]);
    expect(all.get("2026-12-15")).toEqual(parseProgrammingDay(verona15, "uci-cinemas-verona"));
    expect(all.get("2026-12-16")).toEqual(parseProgrammingDay(verona16, "uci-cinemas-verona"));
  });

  it("rejects a malformed root", () => {
    expect(() => parseProgrammingAll({}, "t")).toThrow(ApiShapeError);
    expect(() => parseProgrammingAll(null, "t")).toThrow(ApiShapeError);
  });
});

describe("parseMovieTheatres and parseMovie", () => {
  it("parses the theatres of a movie", () => {
    const theatres = parseMovieTheatres(fixture("movie-dune-parte-tre-theatres.json"));
    expect(theatres.length).toBeGreaterThan(20);
    expect(theatres[0]).toEqual({ slug: "uci-cinemas-arezzo", name: "UCI Cinemas Arezzo", variants: [4006] });
    expect(theatres.find((t) => t.slug === "uci-cinemas-campi-bisenzio-firenze")?.variants).toEqual([4007]);
  });

  it("tolerates broken entries", () => {
    expect(parseMovieTheatres({ data: [{ name: "x" }, { slug: "a", movie_variants: "x" }] })).toEqual([
      { slug: "a", name: "", variants: [] },
    ]);
    expect(() => parseMovieTheatres({ data: {} })).toThrow(ApiShapeError);
  });

  it("parses a movie", () => {
    const movie = parseMovie(fixture("movie-dune-parte-tre.json"));
    expect(movie.slug).toBe("dune-parte-tre");
    expect(movie.title).toBe("Dune: Parte Tre");
    expect(movie.poster).toMatch(/^https:/);
  });

  it("accepts a null poster and rejects malformed movies", () => {
    expect(parseMovie({ data: { slug: "a", title: " T ", poster: null } })).toEqual({ slug: "a", title: "T", poster: null });
    for (const json of [null, {}, { data: null }, { data: { slug: "a" } }, { data: { title: "x" } }, "<html>"]) {
      expect(() => parseMovie(json)).toThrow(ApiShapeError);
    }
  });
});

describe("title matching", () => {
  it("normalizes accents, case and punctuation", () => {
    expect(normalizeTitle("  Dune: Parte  Tre! ")).toBe("dune parte tre");
    expect(normalizeTitle("Perché è già così")).toBe("perche e gia cosi");
  });

  it("matches words as tokens", () => {
    expect(matchesTitle("Dune - Parte Tre", ["dune", "tre"])).toBe(true);
    expect(matchesTitle("Dune: Parte Tre", ["DUNE", "Parte", "Tre"])).toBe(true);
    expect(matchesTitle("Dune: Parte Tre", ["dune", "quattro"])).toBe(false);
    expect(matchesTitle("Dune: Parte Tre", ["dun"])).toBe(false);
    expect(matchesTitle("Perché no", ["perche"])).toBe(true);
    expect(matchesTitle("Dune: Parte Tre", ["parte tre"])).toBe(true);
    expect(matchesTitle("Dune", [])).toBe(true);
  });
});

describe("filterShowings", () => {
  const now = new Date("2026-10-16T10:00:00Z");
  const base: Showing = {
    key: "1-1",
    theatreSlug: "t",
    movie: { slug: "dune-parte-tre", title: "Dune: Parte Tre", poster: null },
    format: "XL - INFINITY VISION",
    formatGroup: "XL",
    language: "ITA",
    day: "2026-10-17",
    startsAt: "2026-10-17T20:30:00",
    time: "20:30",
    room: "S1",
    durationMinutes: 140,
    cartUrl: "u",
  };
  const make = (patch: Partial<Showing>): Showing => ({ ...base, ...patch });

  it("returns everything upcoming with an empty filter", () => {
    expect(filterShowings([base], {}, now)).toEqual([base]);
  });

  it("always excludes showings already started (Rome time)", () => {
    const past = make({ startsAt: "2026-10-16T11:59:00", day: "2026-10-16", time: "11:59" });
    const future = make({ startsAt: "2026-10-16T12:00:00", day: "2026-10-16", time: "12:00", key: "2-2" });
    expect(filterShowings([past, future], {}, now)).toEqual([future]);
  });

  it("filters by movie slug and title words", () => {
    const other = make({ movie: { slug: "other", title: "Altro Film", poster: null } });
    expect(filterShowings([base, other], { movieSlugs: ["other"] }, now)).toEqual([other]);
    expect(filterShowings([base, other], { movieSlugs: ["x", "dune-parte-tre"] }, now)).toEqual([base]);
    expect(filterShowings([base, other], { titleWords: ["altro"] }, now)).toEqual([other]);
    expect(filterShowings([base, other], { titleWords: ["dune", "tre"] }, now)).toEqual([base]);
  });

  it("filters formats by group or raw value, case-insensitively", () => {
    const imax = make({ format: "IMAX", formatGroup: "IMAX" });
    expect(filterShowings([base, imax], { formats: ["xl"] }, now)).toEqual([base]);
    expect(filterShowings([base, imax], { formats: ["xl - infinity vision"] }, now)).toEqual([base]);
    expect(filterShowings([base, imax], { formats: ["Imax", "3D"] }, now)).toEqual([imax]);
    expect(filterShowings([base, imax], { formats: ["3D"] }, now)).toEqual([]);
  });

  it("filters by edition: INFINITY VISION takes every Infinity Vision hall and no plain one", () => {
    const xlPlain = make({ key: "1-2", format: "XL", formatGroup: "XL" });
    const twoD = make({ key: "1-3", format: "2D", formatGroup: "2D" });
    const twoDiv = make({ key: "1-4", format: "2D - INFINITY VISION", formatGroup: "2D" });
    const isenseIv = make({ key: "1-5", format: "ISENSE - INFINITY VISION", formatGroup: "ISENSE" });
    const screenxIv = make({ key: "1-6", format: "SCREENX - INFINITY VISION", formatGroup: "SCREENX" });
    const all = [base, xlPlain, twoD, twoDiv, isenseIv, screenxIv];

    expect(filterShowings(all, { formats: ["INFINITY VISION"] }, now)).toEqual([base, twoDiv, isenseIv, screenxIv]);
    expect(filterShowings(all, { formats: ["XL"] }, now)).toEqual([base, xlPlain]);
    expect(filterShowings(all, { formats: ["2D"] }, now)).toEqual([twoD, twoDiv]);
  });

  it("reads the edition of a hall name", () => {
    expect(formatEdition("XL - INFINITY VISION")).toBe("INFINITY VISION");
    expect(formatEdition("2d - Infinity Vision ")).toBe("INFINITY VISION");
    expect(formatEdition("IMAX")).toBeNull();
  });

  it("filters by window", () => {
    const later = make({ day: "2026-10-25", startsAt: "2026-10-25T20:30:00" });
    expect(filterShowings([base, later], { window: { kind: "next", days: 2 } }, now)).toEqual([base]);
    expect(filterShowings([base, later], { window: { kind: "fixed", from: "2026-10-01", to: "2026-10-25" } }, now)).toEqual([
      base,
      later,
    ]);
    expect(filterShowings([base, later], { window: { kind: "fixed", from: "2026-10-24", to: "2026-10-30" } }, now)).toEqual([
      later,
    ]);
  });

  it("filters by time range, including across midnight", () => {
    const night = make({ time: "00:30", startsAt: "2026-10-18T00:30:00" });
    expect(filterShowings([base, night], { timeFrom: "20:00", timeTo: "21:00" }, now)).toEqual([base]);
    expect(filterShowings([base, night], { timeFrom: "18:00", timeTo: "01:00" }, now)).toEqual([base, night]);
    expect(filterShowings([base, night], { timeFrom: "21:00" }, now)).toEqual([]);
    expect(filterShowings([base, night], { timeTo: "01:00" }, now)).toEqual([night]);
  });

  it("filters by weekday of the cinema day", () => {
    const sunday = make({ day: "2026-10-18", startsAt: "2026-10-18T20:30:00" });
    expect(filterShowings([base, sunday], { weekdays: [7] }, now)).toEqual([sunday]);
    expect(filterShowings([base, sunday], { weekdays: [6] }, now)).toEqual([base]);
    expect(filterShowings([base, sunday], { weekdays: [1, 2] }, now)).toEqual([]);
  });

  it("uses the times of the day in place of the general ones", () => {
    const saturday = make({ key: "sat", time: "16:00", startsAt: "2026-10-17T16:00:00" });
    const monday = make({ key: "mon", day: "2026-10-19", time: "16:00", startsAt: "2026-10-19T16:00:00" });
    const mondayEvening = make({ key: "mon-late", day: "2026-10-19", time: "20:30", startsAt: "2026-10-19T20:30:00" });
    const saturdayNight = make({ key: "sat-night", time: "00:30", startsAt: "2026-10-18T00:30:00" });

    expect(filterShowings([saturday, monday, mondayEvening], { timeFrom: "19:00", dayTimes: { "6": { from: "15:00" } } }, now)).toEqual([saturday, mondayEvening]);
    expect(filterShowings([base, saturday], { timeFrom: "19:00", timeTo: "21:00", dayTimes: { "6": { from: "15:00" } } }, now)).toEqual([base, saturday]);
    expect(filterShowings([base, saturday, saturdayNight], { dayTimes: { "6": { from: "20:00", to: "01:00" } } }, now)).toEqual([base, saturdayNight]);
  });

  it("filters by language, case-insensitively", () => {
    const eng = make({ language: "ENG" });
    const none = make({ language: null });
    expect(filterShowings([base, eng, none], { languages: ["eng"] }, now)).toEqual([eng]);
    expect(filterShowings([base, eng, none], { languages: ["ITA", "ENG"] }, now)).toEqual([base, eng]);
  });

  it("combines filters", () => {
    const imax = make({ format: "IMAX", formatGroup: "IMAX", key: "3-3" });
    const result = filterShowings(
      [base, imax],
      {
        titleWords: ["dune"],
        formats: ["IMAX"],
        window: { kind: "next", days: 7 },
        timeFrom: "19:00",
        timeTo: "23:00",
        weekdays: [6],
        languages: ["ita"],
        movieSlugs: ["dune-parte-tre"],
      },
      now,
    );
    expect(result).toEqual([imax]);
  });
});

describe("createUciClient", () => {
  function fakeHttp(responses: Record<string, unknown>) {
    const getJson = vi.fn((url: string) => {
      const path = url.slice(UCI_API_BASE.length);
      if (!(path in responses)) {
        throw new Error(`unexpected ${path}`);
      }
      return Promise.resolve(responses[path]);
    });
    return { http: { getJson, postJson: vi.fn() } as unknown as HttpClient, getJson };
  }

  it("calls the expected URLs with the Referer header and parses the results", async () => {
    const { http, getJson } = fakeHttp({
      "/theatres": fixture("theatres.json"),
      "/theatres/uci-cinemas-verona/programming/2026-12-15": verona15,
      "/theatres/uci-cinemas-verona/programming": { data: [{ "2026-12-15": (verona15 as { data: unknown[] }).data }] },
      "/movies/dune-parte-tre": fixture("movie-dune-parte-tre.json"),
      "/movies/dune-parte-tre/theatres": fixture("movie-dune-parte-tre-theatres.json"),
    });
    const client = createUciClient(http);
    expect(await client.theatres()).toHaveLength(33);
    expect(await client.programmingDay("uci-cinemas-verona", "2026-12-15")).toHaveLength(8);
    expect((await client.programmingAll("uci-cinemas-verona")).get("2026-12-15")).toHaveLength(8);
    expect((await client.movie("dune-parte-tre")).title).toBe("Dune: Parte Tre");
    expect((await client.movieTheatres("dune-parte-tre")).length).toBeGreaterThan(20);
    expect(getJson.mock.calls.map((c) => c[0])).toEqual([
      `${UCI_API_BASE}/theatres`,
      `${UCI_API_BASE}/theatres/uci-cinemas-verona/programming/2026-12-15`,
      `${UCI_API_BASE}/theatres/uci-cinemas-verona/programming`,
      `${UCI_API_BASE}/movies/dune-parte-tre`,
      `${UCI_API_BASE}/movies/dune-parte-tre/theatres`,
    ]);
    for (const call of getJson.mock.calls as unknown as Array<[string, { headers: unknown }]>) {
      expect(call[1].headers).toEqual(UCI_HEADERS);
    }
  });

  it("rejects invalid slugs and days without making a request", async () => {
    const { http, getJson } = fakeHttp({});
    const client = createUciClient(http);
    await expect(client.programmingDay("../etc", "2026-12-15")).rejects.toBeInstanceOf(ApiShapeError);
    await expect(client.programmingDay("ok", "2026-02-30")).rejects.toBeInstanceOf(ApiShapeError);
    await expect(client.programmingAll("Bad Slug")).rejects.toBeInstanceOf(ApiShapeError);
    await expect(client.movie("a/b")).rejects.toBeInstanceOf(ApiShapeError);
    await expect(client.movieTheatres("")).rejects.toBeInstanceOf(ApiShapeError);
    expect(getJson).not.toHaveBeenCalled();
  });

  it("surfaces unexpected response shapes as ApiShapeError", async () => {
    const { http } = fakeHttp({ "/theatres": "<html>", "/movies/x": { data: null } });
    const client = createUciClient(http);
    await expect(client.theatres()).rejects.toBeInstanceOf(ApiShapeError);
    await expect(client.movie("x")).rejects.toBeInstanceOf(ApiShapeError);
  });
});
