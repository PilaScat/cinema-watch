import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { searchMovies } from "../src/movie-search.js";
import { parseCatalog } from "../src/uci.js";

const catalog = parseCatalog(JSON.parse(readFileSync(new URL("./fixtures/uci/movies.json", import.meta.url), "utf8")));

function slugs(query: string): string[] {
  return searchMovies(catalog, query).map((movie) => movie.slug);
}

describe("parseCatalog", () => {
  it("keeps slug, title, poster, days and formats of each film", () => {
    const dune = catalog.find((movie) => movie.slug === "dune-parte-tre");

    expect(catalog).toHaveLength(6);
    expect(dune).toEqual({
      slug: "dune-parte-tre",
      title: "Dune: Parte Tre",
      poster: expect.stringMatching(/^https:\/\/storage\.googleapis\.com\//),
      firstDay: "2026-10-01",
      lastDay: "2026-12-15",
      formats: ["IMAX", "ISENSE", "XL", "2D"],
    });
  });

  it("lists each format group once and adds the special editions", () => {
    expect(catalog.find((movie) => movie.slug === "avengers-doomsday")?.formats).toEqual(["ISENSE", "2D", "SCREENX", "XL", "3D", "INFINITY VISION"]);
  });

  it("skips entries without slug or title and survives an empty answer", () => {
    expect(parseCatalog({ data: [{ slug: "x" }, { title: "Y" }, { slug: "ok", title: "Ok" }] }).map((movie) => movie.slug)).toEqual(["ok"]);
    expect(parseCatalog({ data: [] })).toEqual([]);
  });
});

describe("searchMovies", () => {
  it("finds films from the start of a word", () => {
    expect(slugs("avenger")).toEqual(["avengers-doomsday", "avengers-endgame-extra", "avengers-endgame-extra-infinity-vision"]);
    expect(slugs("doomsday")).toEqual(["avengers-doomsday"]);
    expect(slugs("dun parte")).toEqual(["dune-parte-tre"]);
  });

  it("forgives a typo in longer words", () => {
    expect(slugs("avangers")).toEqual(["avengers-doomsday", "avengers-endgame-extra", "avengers-endgame-extra-infinity-vision"]);
    expect(slugs("odisea")).toEqual(["2001-odissea-nello-spazio"]);
    expect(slugs("doomday")).toEqual(["avengers-doomsday"]);
  });

  it("ignores case, accents and punctuation", () => {
    expect(slugs("DUNE: parte tre")).toEqual(["dune-parte-tre"]);
    expect(slugs("isola ricòrdi")).toEqual(["lisola-dei-ricordi"]);
    expect(slugs("2001")).toEqual(["2001-odissea-nello-spazio"]);
  });

  it("needs every word to match, so more words narrow the list", () => {
    expect(slugs("endgame infinity")).toEqual(["avengers-endgame-extra-infinity-vision"]);
    expect(slugs("avengers dune")).toEqual([]);
  });

  it("puts exact words before beginnings and typos, then shorter titles first", () => {
    expect(slugs("endgame")).toEqual(["avengers-endgame-extra", "avengers-endgame-extra-infinity-vision"]);
    expect(slugs("dune")[0]).toBe("dune-parte-tre");
  });

  it("finds nothing for unrelated words, an empty text or a single letter", () => {
    expect(slugs("xyz")).toEqual([]);
    expect(slugs("   ")).toEqual([]);
    expect(slugs("a")).toEqual([]);
    expect(slugs("du")).toEqual(["dune-parte-tre"]);
  });

  it("does not stretch short words into typos", () => {
    expect(slugs("dina")).toEqual([]);
  });
});
