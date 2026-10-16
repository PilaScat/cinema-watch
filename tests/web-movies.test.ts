import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp, failPath, huntForm, post } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function optionsOf(html: string): Array<{ value: string; label: string; selected: boolean }> {
  const select = /<select[^>]*name="movieListed"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  return [...select.matchAll(/<option value="([^"]*)"( selected="")?[^>]*>([^<]*)<\/option>/g)].map((match) => ({
    value: match[1] ?? "",
    label: match[3] ?? "",
    selected: match[2] !== undefined,
  }));
}

describe("film menu in the hunt form", () => {
  it("lists the films programmed in the chosen theatre with formats and first day", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts/new?theatre=uci-cinemas-verona")).text();

    expect(optionsOf(html).filter((option) => option.value !== "")).toEqual([
      { value: "avengers-doomsday", label: "Avengers: Doomsday · XL, 2D · dal mar 15/12", selected: false },
      { value: "dune-parte-tre", label: "Dune: Parte Tre · IMAX · dal mar 15/12", selected: false },
    ]);
    expect(html).toMatch(/name="movieKind" value="listed" checked/);
    expect(html).toContain('src="/assets/movie-picker.js"');
  });

  it("asks to choose the theatres first when none is checked", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts/new")).text();

    expect(optionsOf(html)).toEqual([{ value: "", label: "Scegliere prima i cinema", selected: false }]);
  });

  it("says the list is unavailable when the programming cannot be read", async () => {
    failPath(harness, (url) => url.pathname.endsWith("/programming"), 500);
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts/new?theatre=uci-cinemas-verona")).text();

    expect(optionsOf(html)).toEqual([{ value: "", label: "Elenco dei film non disponibile", selected: false }]);
  });

  it("saves the film picked from the menu as a slug", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request(
      "/hunts",
      post(huntForm({ name: "Avengers XL", movieKind: "listed", movieListed: "avengers-doomsday", movieSlugs: "", format: ["XL"] })),
    );

    expect(response.status).toBe(303);
    expect(watcher.config().hunts.at(-1)?.movie).toEqual({ kind: "slug", slugs: ["avengers-doomsday"] });
  });

  it("rejects the menu choice when no film is picked and keeps the list", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request("/hunts", post(huntForm({ movieKind: "listed", movieListed: "", movieSlugs: "dune-parte-tre" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(watcher.config().hunts).toHaveLength(1);
    expect(html).toMatch(/name="movieKind" value="listed" checked/);
    expect(optionsOf(html).map((option) => option.value)).toContain("dune-parte-tre");
    expect(html).toMatch(/<select[^>]*name="movieListed"[^>]*aria-invalid="true"/);
  });

  it("still saves a film typed by slug that is not programmed yet", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request("/hunts", post(huntForm({ name: "Futuro", movieKind: "slug", movieSlugs: "film-futuro, altro-film" })));

    expect(response.status).toBe(303);
    expect(watcher.config().hunts.at(-1)?.movie).toEqual({ kind: "slug", slugs: ["film-futuro", "altro-film"] });
  });

  it("prefills the menu when the film in the query is programmed", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts/new?theatre=uci-cinemas-verona&movie=dune-parte-tre")).text();

    expect(html).toMatch(/name="movieKind" value="listed" checked/);
    expect(optionsOf(html).find((option) => option.selected)?.value).toBe("dune-parte-tre");
  });

  it("prefills the manual slug when the film in the query is not programmed", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts/new?theatre=uci-cinemas-verona&movie=film-futuro")).text();

    expect(html).toMatch(/name="movieKind" value="slug" checked/);
    expect(html).toMatch(/name="movieSlugs"[^>]*value="film-futuro"/);
    expect(optionsOf(html).some((option) => option.selected)).toBe(false);
  });

  it("shows an existing hunt on a programmed film in the menu", async () => {
    const { instance, huntId } = await createWebApp(harness);

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toMatch(/name="movieKind" value="listed" checked/);
    expect(optionsOf(html).find((option) => option.selected)?.value).toBe("dune-parte-tre");
  });

  it("keeps an existing hunt on several slugs in the manual field", async () => {
    const { instance, huntId } = await createWebApp(harness, {
      mutate: (config) => {
        const hunt = config.hunts[0];
        if (hunt) hunt.movie = { kind: "slug", slugs: ["dune-parte-tre", "film-futuro"] };
      },
    });

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toMatch(/name="movieKind" value="slug" checked/);
    expect(html).toMatch(/name="movieSlugs"[^>]*value="dune-parte-tre, film-futuro"/);
  });

  it("keeps a hunt by title words on the title choice", async () => {
    const { instance, huntId } = await createWebApp(harness, {
      mutate: (config) => {
        const hunt = config.hunts[0];
        if (hunt) hunt.movie = { kind: "title", words: ["dune"], confirmedSlugs: [] };
      },
    });

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toMatch(/name="movieKind" value="title" checked/);
    expect(html).toMatch(/name="movieWords"[^>]*value="dune"/);
  });
});

describe("GET /api/movies", () => {
  it("returns the programmed films of the theatres", async () => {
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/api/movies?theatres=uci-cinemas-verona");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { slug: "avengers-doomsday", title: "Avengers: Doomsday", formats: ["XL", "2D"], firstDay: "2026-12-15", label: "Avengers: Doomsday · XL, 2D · dal mar 15/12" },
      { slug: "dune-parte-tre", title: "Dune: Parte Tre", formats: ["IMAX"], firstDay: "2026-12-15", label: "Dune: Parte Tre · IMAX · dal mar 15/12" },
    ]);
  });

  it("returns an empty list without theatres", async () => {
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/api/movies?theatres=");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("rejects more than 3 theatres", async () => {
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/api/movies?theatres=a,b,c,d");

    expect(response.status).toBe(400);
  });

  it("rejects a theatre that is not a slug", async () => {
    const { instance } = await createWebApp(harness);

    expect((await instance.request("/api/movies?theatres=uci-cinemas-verona,Bad%21")).status).toBe(400);
    expect((await instance.request("/api/movies")).status).toBe(400);
  });

  it("answers 502 when no programming can be read", async () => {
    failPath(harness, (url) => url.pathname.endsWith("/programming"), 500);
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/api/movies?theatres=uci-cinemas-verona");

    expect(response.status).toBe(502);
  });

  it("skips a theatre that fails when another one answers", async () => {
    failPath(harness, (url) => url.pathname.includes("/theatres/uci-cinemas-bicocca/"));
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/api/movies?theatres=uci-cinemas-bicocca,uci-cinemas-verona");

    expect(response.status).toBe(200);
    const movies = (await response.json()) as Array<{ slug: string }>;
    expect(movies.map((movie) => movie.slug)).toEqual(["avengers-doomsday", "dune-parte-tre"]);
  });
});
