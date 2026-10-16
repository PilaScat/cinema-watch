import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/web/app.js";
import { createHarness, MINUTE, type Harness } from "./support/harness.js";
import { fixture } from "./support/fake-world.js";

const publicDir = fileURLToPath(new URL("../src/web/public/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function app() {
  const config = await harness.seed();
  const watcher = await harness.watcher();
  const instance = await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: {}, now: () => harness.now(), publicDir, assetsDir });
  return { instance, watcher, config };
}

async function page(instance: Awaited<ReturnType<typeof app>>["instance"], path: string, status = 200): Promise<string> {
  const response = await instance.request(path);
  const html = await response.text();
  const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1] ?? "";
  expect(response.status).toBe(status);
  expect(html).not.toContain("style=");
  expect([...html.matchAll(/<script\b[^>]*>/g)].every(([tag]) => tag.includes(`nonce="${nonce}"`))).toBe(true);
  return html;
}

function withoutSeats(occupancy: unknown, seatIds: string[]): unknown {
  const copyOf = structuredClone(occupancy) as { Data: { Occupancy: { Seats: Array<{ SeatId: string }> } } };
  copyOf.Data.Occupancy.Seats = copyOf.Data.Occupancy.Seats.filter((seat) => !seatIds.includes(seat.SeatId));
  return copyOf;
}

describe("theatres", () => {
  it("lists the theatres by region with their formats and filters by name or city", async () => {
    const { instance } = await app();

    const all = await page(instance, "/theatres");
    const filtered = await page(instance, "/theatres?q=verona");
    const none = await page(instance, "/theatres?q=xyz");

    expect(all).toContain("UCI Cinemas Verona");
    expect(all).toContain("UCI Cinemas Arezzo");
    expect(all).toContain("IMAX");
    expect(all).toContain('href="/theatres/uci-cinemas-verona"');
    expect(filtered).toContain("UCI Cinemas Verona");
    expect(filtered).not.toContain("Arezzo");
    expect(none).toContain("Nessun cinema.");
  });

  it("lists the movies of a theatre and rejects bad or unknown slugs", async () => {
    const { instance } = await app();

    const html = await page(instance, "/theatres/uci-cinemas-verona");

    expect(html).toContain("Dune: Parte Tre");
    expect(html).toContain("Avengers");
    expect(html).toContain('href="/theatres/uci-cinemas-verona/movies/dune-parte-tre"');
    expect(html).toContain("2 giorni");
    await page(instance, "/theatres/Bad_Slug", 404);
    await page(instance, "/theatres/uci-cinemas-nowhere", 404);
  });

  it("shows the showings of a movie with free seats, in time order", async () => {
    const { instance } = await app();

    const html = await page(instance, "/theatres/uci-cinemas-verona/movies/dune-parte-tre");

    expect(html).toContain("20:30");
    expect(html).toContain("SALA 1 IMAX");
    expect(html).toContain("44 liberi");
    expect(html).toContain("0 nella zona buona");
    expect(html).toContain('href="/performances/5116/575978?theatre=uci-cinemas-verona&amp;movie=dune-parte-tre"');
    expect(html).toContain('href="/hunts/new?theatre=uci-cinemas-verona&amp;movie=dune-parte-tre"');
    expect(html).toContain("Aggiungi caccia");
  });

  it("switches day with the day parameter", async () => {
    const { instance } = await app();

    const first = await page(instance, "/theatres/uci-cinemas-verona/movies/avengers-doomsday");
    const second = await page(instance, "/theatres/uci-cinemas-verona/movies/avengers-doomsday?day=2026-12-16");
    expect(second).toContain("09:40");
    expect(second).toContain("SALA 07 XL");
    expect(second).toContain("Mostrati i primi 12 spettacoli.");
    expect(second).toContain('href="/performances/5116/576749?');
    expect(first).not.toBe(second);
    expect(first).toContain('aria-current="page"');
    await page(instance, "/theatres/uci-cinemas-verona/movies/avengers-doomsday?day=nope", 404);
  });

  it("answers with an empty state for a movie that is not on the programme", async () => {
    const { instance } = await app();

    expect(await page(instance, "/theatres/uci-cinemas-verona/movies/no-such-movie")).toContain("Nessuno spettacolo.");
  });
});

describe("performance", () => {
  const path = "/performances/5116/575978?movie=dune-parte-tre&theatre=uci-cinemas-verona";

  it("draws the live hall in a light and a dark version with buy and hunt links", async () => {
    const { instance } = await app();

    const html = await page(instance, path);

    expect([...html.matchAll(/<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width=/g)]).toHaveLength(2);
    expect(html).toContain('class="hall-svg dark:hidden"');
    expect(html).toContain('class="hall-svg hidden dark:block"');
    expect(html).toContain("https://ucicinemas.it/movies/dune-parte-tre/acquista/5116/");
    expect(html).toContain("/575978");
    expect(html).toContain("Acquista");
    expect(html).toContain("Aggiungi caccia");
    expect(html).toContain("from=2026-12-15");
    expect(html).toContain("to=2026-12-15");
    expect(html).toContain("format=IMAX");
    expect(html).toContain("Andamento disponibile dopo due letture diverse.");
    expect(html).not.toContain("/assets/chart.js");
    expect(html).toContain("Dune: Parte Tre");
    expect(html).not.toContain("Parte Tre Sala Imax");
  });

  it("has no buy or hunt links without the movie and rejects non numeric ids", async () => {
    const { instance } = await app();

    const html = await page(instance, "/performances/5116/575978");

    expect(html).not.toContain("Acquista");
    expect(html).not.toContain("Aggiungi caccia");
    await page(instance, "/performances/abc/575978", 404);
    await page(instance, "/performances/5116/1x", 404);
    await page(instance, "/performances/5116/575978?movie=Bad_Slug", 404);
  });

  it("uses the zone of the hunt when one is given", async () => {
    const { instance, config } = await app();
    const hunt = config.hunts[0]?.id ?? "";

    const byDefault = await page(instance, path);
    const byHunt = await page(instance, `${path}&hunt=${hunt}`);

    expect(byHunt).toMatch(/Liberi nella zona buona<\/dt><dd[^>]*>0</);
    expect(byDefault).toMatch(/Liberi nella zona buona<\/dt><dd[^>]*>\d+</);
  });

  it("shows a notice when the hall cannot be read", async () => {
    const { instance } = await app();

    expect(await page(instance, "/performances/5116/1")).toContain("Pianta non disponibile.");
  });

  it("charts the trend once two different readings exist, with the script and a table", async () => {
    const { instance, watcher } = await app();
    await watcher.tick();
    harness.world.setOccupancy(5116, 575978, withoutSeats(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));
    harness.advance(6 * MINUTE);
    await watcher.tick();

    const html = await page(instance, path);

    expect(html).toContain("chart-line-1");
    expect(html).toContain("chart-line-2");
    expect(html).toContain('src="/assets/chart.js"');
    expect(html).toContain("<table");
    expect(html).toContain("data-trend-tooltip");
    expect([...html.matchAll(/fill="transparent"/g)]).toHaveLength(2);
    expect((await instance.request("/assets/chart.js")).status).toBe(200);
  });

  it("keeps the waiting text with a single reading", async () => {
    const { instance, watcher } = await app();
    await watcher.tick();

    const html = await page(instance, path);

    expect(html).toContain("Andamento disponibile dopo due letture diverse.");
    expect(html).not.toContain("chart-line-1");
  });
});

describe("search", () => {
  it("finds the theatres that show a movie by its title", async () => {
    const { instance } = await app();

    const html = await page(instance, "/search?q=dune%20parte%20tre");

    expect(html).toContain('href="/theatres/uci-cinemas-verona/movies/dune-parte-tre"');
  });

  it("suggests titles already seen by the hunts", async () => {
    const { instance, watcher } = await app();
    await watcher.tick();

    const html = await page(instance, "/search?q=dune");

    expect(html).toContain("Film già nelle cacce");
    expect(html).toContain("Dune: Parte Tre");
  });

  it("shows only the form without a query and an empty state without results", async () => {
    const { instance } = await app();

    const blank = await page(instance, "/search");
    const none = await page(instance, "/search?q=zzzz");

    expect(blank).toContain('name="q"');
    expect(blank).not.toContain("Nessun risultato.");
    expect(none).toContain("Nessun risultato.");
  });
});

describe("assets", () => {
  it("ships a chart script without inline markup injection", () => {
    const source = readFileSync(new URL("../src/web/public/chart.js", import.meta.url), "utf8");

    expect(source).not.toContain("innerHTML");
    expect(source).toContain("textContent");
  });
});
