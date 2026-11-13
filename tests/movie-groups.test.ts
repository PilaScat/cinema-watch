import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupCatalog, groupOfSlug, titleKey } from "../src/movie-groups.js";
import type { CatalogMovie } from "../src/types.js";
import { normalizeTitle } from "../src/uci.js";

function movie(title: string, overrides: Partial<CatalogMovie> = {}): CatalogMovie {
  return { slug: normalizeTitle(title).replaceAll(" ", "-"), title, poster: null, firstDay: null, lastDay: null, formats: [], ...overrides };
}

function grouped(titles: string[]): string[][] {
  return groupCatalog(titles.map((title) => movie(title))).map((group) => group.variants.map((variant) => variant.title));
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(`tests/fixtures/catalog/${name}.json`, "utf8")) as T;
}

describe("the real catalogue of 12/11/2026", () => {
  const titles = fixture<Array<{ slug: string; title: string }>>("titles");
  const groups = groupCatalog(titles.map((entry) => movie(entry.title, { slug: entry.slug })));

  it("merges exactly the groups checked by hand", () => {
    const merged = Object.fromEntries(
      groups
        .filter((group) => group.variants.length > 1)
        .map((group) => [group.slug, group.variants.slice(1).map((variant) => variant.slug).sort()] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );

    expect([titles.length, groups.length]).toEqual([786, 609]);
    expect(merged).toEqual(fixture("groups"));
  });

  it("keeps every slug reachable in one group only", () => {
    const slugs = groups.flatMap((group) => group.variants.map((variant) => variant.slug));

    expect(slugs.length).toBe(titles.length);
    expect(new Set(slugs).size).toBe(titles.length);
    expect(groupOfSlug(groups, "avengers-doomsday-3d-it")?.slug).toBe("avengers-doomsday");
    expect(groupOfSlug(groups, "no-such-film")).toBeNull();
  });
});

describe("different films stay apart", () => {
  it.each([
    ["Dune: Parte Due (Re-Release)", "Dune - Parte Tre"],
    ["Blade Runner", "Blade Runner 2049"],
    ["Freeride Filmfestival 2026", "Freeride Filmfestival 2027"],
    ["Alien", "Aliens"],
    ["Alien", "Alien Evento"],
    ["Stop", "Stop It"],
    ["Pillow", "Pillow Talk"],
    ["Doomsday", "Energia Doomsday"],
    ["Rocky", "Rocky III"],
    ["Ninja Il Padrino - Parte II", "Ninja Il Padrino - Parte III"],
    ["Trenque Lauquen", "Trenque Lauquen 2a parte"],
    ["Kill Bill", "Kill Bill (Vol. 2)"],
    ["Wicked", "Wicked (Parte Due)"],
    ["Oceania", "Oceania (Live Action 2026)"],
    ["Incanto", "Incanto (Concerto Live)"],
    ["Festival In Corto Prg 3", "Festival In Corto Prg 4"],
    ["Cineforum A Sorpresa 1 2026/27", "Cineforum A Sorpresa 2 2026/27"],
    ["Bts World Tour Arirang - Live Jakarta", "Bts World Tour Arirang - Live Kaohsiung"],
    ["Carlo Acutis", "Carlo Acutis - Il Giovane Santo"],
    ["Avengers", "Avengers Infinity"],
    ["Spider-Man", "Spider"],
    ["Doomsday", "3d Doomsday"],
    ["Henry", "Henry V"],
    ["Il Padrino (1972)", "Il Padrino (2026)"],
  ])("%s and %s", (first, second) => {
    expect(grouped([first, second])).toEqual([[first], [second]]);
  });

  it("keeps two years apart, and a title without a year apart from both", () => {
    expect(grouped(["Il Padrino", "Il Padrino (1972)", "Il Padrino (2026)", "Il Padrino (2026) Screenx"])).toEqual([["Il Padrino"], ["Il Padrino (1972)"], ["Il Padrino (2026)", "Il Padrino (2026) Screenx"]]);
  });
});

describe("versions of one film go together", () => {
  it.each([
    ["Clayface", "Clayface (It)"],
    ["Clayface", "Clayface V.M.14"],
    ["Clayface", "Clayface Vm 14"],
    ["Clayface", "Atmos - Clayface"],
    ["Clayface", "Clayface - Atmos"],
    ["Clayface", "CLAYFACE - ORIGINAL LANGUAGE"],
    ["Clayface", "Clayface (H 1.50)"],
    ["Clayface", "Clayface Sala Imax"],
    ["Clayface", "Clayface - Film + Cena"],
    ["Clayface", "Clayface (The Original Title)"],
    ["Clayface", "Clayface (2026)"],
    ["Clayface", "Clayface C.A."],
    ["Clayface", "Clayface 3d (En)"],
    ["Clayface", "Clayface 16/12 Ore 00:01"],
    ["Clayface", "3d - Clayface"],
    ["Clayface", "Premiere - (O.V.) Clayface"],
    ["Clayface", "Premiere - Atmos Clayface I.V."],
    ["Clayface", "Clayface Infinity Vision-Atmos"],
    ["Clayface", "4senses- Clayface Infinity V."],
  ])("%s and %s", (first, second) => {
    expect(grouped([first, second])).toEqual([[first, second]]);
  });

  it("gives the group the slug that matches the plain title, else the shortest", () => {
    const [plain] = groupCatalog([movie("Clayface (It)"), movie("Clayface"), movie("Atmos - Clayface")]);
    const [shortest] = groupCatalog([movie("Clayface - Atmos"), movie("Clayface (It)")]);

    expect([plain?.slug, plain?.title]).toEqual(["clayface", "Clayface"]);
    expect(shortest?.slug).toBe("clayface-it");
  });

  it("joins poster, days and formats of the versions", () => {
    const [group] = groupCatalog([
      movie("Clayface", { firstDay: "2026-12-10", lastDay: "2026-12-12", formats: ["2D"] }),
      movie("Clayface (It)", { poster: "https://example.org/p.jpg", firstDay: "2026-12-08", lastDay: "2026-12-20", formats: ["2D", "IMAX"] }),
    ]);

    expect(group).toMatchObject({ poster: "https://example.org/p.jpg", firstDay: "2026-12-08", lastDay: "2026-12-20", formats: ["2D", "IMAX"] });
  });

  it("never leaves an empty key", () => {
    expect(titleKey("(It)")).toEqual({ text: "it", year: null });
    expect(titleKey("Atmos")).toEqual({ text: "atmos", year: null });
    expect(titleKey("3d")).toEqual({ text: "3d", year: null });
  });
});
