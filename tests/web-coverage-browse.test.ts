import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixture } from "./support/fake-world.js";
import { createHarness, MINUTE, type Harness } from "./support/harness.js";
import { createWebApp, failPath, mapKeys, occupancyWithout, occupancyWithTaken, rewriteJson, UCI_HOST, WEBTIC_HOST } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

const isTheatreList = (url: URL) => url.pathname.endsWith("/theatres");
const isProgramming = (url: URL) => url.pathname.includes("/programming");
const MOVIE_PAGE = "/theatres/uci-cinemas-verona/movies/dune-parte-tre";
const PERFORMANCE_PAGE = "/performances/5116/575978?movie=dune-parte-tre&theatre=uci-cinemas-verona";

describe("theatre list", () => {
  it("shows a notice and the empty state when the list cannot be read", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);

    const html = await (await instance.request("/theatres")).text();

    expect(html).toContain("Elenco dei cinema non disponibile.");
    expect(html).toContain("Nessun cinema.");
  });

  it("groups a theatre without a region under other regions", async () => {
    rewriteJson(harness, isTheatreList, (json) => ({ data: (json as { data: Array<{ slug: string }> }).data.map((theatre) => (theatre.slug === "uci-cinemas-verona" ? { ...theatre, region: null } : theatre)) }));
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/theatres?q=verona")).text();

    expect(html).toContain("Altre regioni");
    expect(html).toContain("UCI Cinemas Verona");
  });
});

describe("theatre page", () => {
  it("names the theatre by its slug and still lists the movies when only the cinema list is down", async () => {
    failPath(harness, isTheatreList);
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/theatres/uci-cinemas-verona");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("uci-cinemas-verona");
    expect(html).toContain("Dune: Parte Tre");
    expect(html).not.toContain("Programmazione non disponibile.");
  });

  it("says the programme is unavailable and lists no movies when it cannot be read", async () => {
    failPath(harness, isProgramming);
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/theatres/uci-cinemas-verona")).text();

    expect(html).toContain("UCI Cinemas Verona");
    expect(html).toContain("Programmazione non disponibile.");
    expect(html).toContain("Nessun film in programmazione.");
  });

  it("shows a placeholder for a movie without a poster and the single day wording", async () => {
    rewriteJson(harness, isProgramming, (json) => mapKeys(json, "poster", null));
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/theatres/uci-cinemas-verona")).text();

    expect(html).not.toContain("<img src=\"https://storage.googleapis.com");
    expect(html).toContain("Dune: Parte Tre");
  });
});

describe("movie page", () => {
  it("falls back to the slugs when the cinema list and the programme are both down", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);

    const response = await instance.request(MOVIE_PAGE);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("dune-parte-tre");
    expect(html).toContain("uci-cinemas-verona");
    expect(html).toContain("Programmazione non disponibile.");
    expect(html).toContain("Nessuno spettacolo.");
  });

  it("opens the first day when the requested day has no showings of the movie", async () => {
    const { instance } = await createWebApp(harness);

    const response = await instance.request(`${MOVIE_PAGE}?day=2026-12-31`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("20:30");
  });

  it("shows the language, and says the hall is unavailable when Webtic is down", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.failHost(WEBTIC_HOST, 500);

    const html = await (await instance.request(MOVIE_PAGE)).text();

    expect(html).toContain("ITA");
    expect(html).toContain("Pianta non disponibile");
    expect(html).not.toContain("liberi</span>");
  });

  it("leaves out the language when the programme does not give one", async () => {
    rewriteJson(harness, isProgramming, (json) => mapKeys(json, "language", null));
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(MOVIE_PAGE)).text();

    expect(html).toContain("20:30");
    expect(html).not.toMatch(/text-muted">ITA</);
  });

  it("highlights the free seats of the good zone when some are free", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));

    const html = await (await instance.request(MOVIE_PAGE)).text();

    expect(html).toContain("font-semibold text-gold\">3 nella zona buona");
  });
});

describe("performance page", () => {
  it("lists the best seats once some are free together in the zone", async () => {
    const { instance, huntId } = await createWebApp(harness);
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));

    const html = await (await instance.request(`${PERFORMANCE_PAGE}&hunt=${huntId}`)).text();

    expect(html).toContain("Migliori posti");
    expect(html).not.toContain("Nessun posto vicino nella zona buona.");
    expect(html).toContain("H 9-11");
  });

  it("says there are no best seats when the hall is full", async () => {
    const { instance } = await createWebApp(harness);
    const screen = fixture("webtic/screen-5116-2.json") as { Data: { Screen: { Seats: Array<{ SeatId: string }> } } };
    const everySeat = screen.Data.Screen.Seats.map((seat) => seat.SeatId);
    harness.world.setOccupancy(5116, 575978, everySeat.reduce((occupancy, seatId) => occupancyWithTaken(occupancy, seatId), fixture("webtic/occupancy-5116-575978.json")));

    const html = await (await instance.request(PERFORMANCE_PAGE)).text();

    expect(html).toContain("Nessun posto vicino nella zona buona.");
  });

  it("ignores an unknown hunt id", async () => {
    const { instance } = await createWebApp(harness);

    const response = await instance.request(`${PERFORMANCE_PAGE}&hunt=zzzzzzzz`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Liberi nella zona buona");
  });

  it("keeps the title and drops the format when the programme cannot be read", async () => {
    failPath(harness, isProgramming);
    const { instance } = await createWebApp(harness);

    const response = await instance.request(PERFORMANCE_PAGE);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Aggiungi caccia");
    expect(html).not.toContain("format=");
    expect(html).toContain("from=2026-12-15");
  });

  it("drops the format when the showing is not in the programme of that theatre", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/performances/5116/575978?movie=dune-parte-tre&theatre=uci-cinemas-milano")).text();

    expect(html).toContain("Aggiungi caccia");
    expect(html).not.toContain("format=");
  });

  it("answers 404 for a malformed theatre slug", async () => {
    const { instance } = await createWebApp(harness);

    expect((await instance.request("/performances/5116/575978?theatre=Bad_Slug")).status).toBe(404);
  });

  it("shows the lowest price in the heading", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(PERFORMANCE_PAGE)).text();

    expect(html).toMatch(/SALA 1 IMAX · mar 15\/12 20:30 · da 14,90\s€/);
  });

  it("leaves the price out of the heading when Webtic gives none", async () => {
    rewriteJson(harness, (url) => url.pathname.endsWith("/Performance"), (json) => mapKeys(json, "Tickets", null));
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(PERFORMANCE_PAGE)).text();

    expect(html).toContain("SALA 1 IMAX · mar 15/12 20:30<");
    expect(html).not.toContain("da 14,90");
  });

  it("charts the trend and the history of a showing that was followed", async () => {
    const { instance, watcher } = await createWebApp(harness);
    await watcher.tick();
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture("webtic/occupancy-5116-575978.json"), ["H/9"]));
    harness.advance(6 * MINUTE);
    await watcher.tick();

    const html = await (await instance.request(PERFORMANCE_PAGE)).text();

    expect(html).toContain('src="/assets/chart.js"');
  });
});

describe("search", () => {
  it("says nothing was found when UCI is down", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);

    const html = await (await instance.request("/search?q=zzzz")).text();

    expect(html).toContain("Catalogo dei film non disponibile");
    expect(html).toContain("Nessun film trovato.");
  });

  it("falls back to the exact title when only the catalog is down", async () => {
    failPath(harness, (url) => url.pathname === "/api/movies");
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/search?q=Dune%3A%20Parte%20Tre")).text();

    expect(html).toContain("Catalogo dei film non disponibile");
    expect(html).toContain('href="/theatres/uci-cinemas-verona/movies/dune-parte-tre"');
  });

  it("says no theatre shows the chosen film when UCI lists none", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/search?q=isola&movie=lisola-dei-ricordi")).text();

    expect(html).toContain("Nessun cinema lo proietta per ora.");
  });

  it("limits the query to one hundred characters", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(`/search?q=${"a".repeat(150)}`)).text();

    expect(html).toContain(`value="${"a".repeat(100)}"`);
    expect(html).not.toContain("a".repeat(101));
  });
});
