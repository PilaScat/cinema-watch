import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, merlataVenues, type Harness } from "./support/harness.js";
import { createWebApp } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function app() {
  return (await createWebApp(harness, { venues: merlataVenues(harness.now()) })).instance;
}

async function page(path: string): Promise<string> {
  return (await (await app()).request(path)).text();
}

describe("Webtic cinemas in the web UI", () => {
  it("lists a Webtic cinema in its region with the circuit label", async () => {
    const html = await page("/theatres");

    expect(html).toContain("I cinema, raggruppati per regione.");
    expect(html).toContain('href="/theatres/webtic-5779"');
    expect(html).toContain("Notorious Cascina Merlata");
    expect(html).toContain(">Webtic</span>");
    expect(html).toContain(">UCI</span>");
    expect(html.indexOf(">Lombardia</h2>")).toBeLessThan(html.indexOf("Notorious Cascina Merlata"));
  });

  it("shows the programming of a Webtic cinema and the showings of a film", async () => {
    const theatre = await page("/theatres/webtic-5779");
    const movie = await page("/theatres/webtic-5779/movies/dune-parte-tre");

    expect(theatre).toContain('href="/theatres/webtic-5779/movies/dune-parte-tre"');
    expect(theatre).toContain("https://secure.webtic.it/api/HandlerLocandinaEx.ashx");
    expect(movie).toContain('href="/performances/5779/51133?theatre=webtic-5779&amp;movie=dune-parte-tre"');
    expect(movie).toContain("SALA 1");
  });

  it("buys a Webtic showing on Webtic", async () => {
    const html = await page("/performances/5779/51133?theatre=webtic-5779&movie=dune-parte-tre");

    expect(html).toContain("https://secure.webtic.it/angwt/webtic.aspx?lid=5779&amp;lng=it#/shoppingmode/it/0/5779/1223/51133");
    expect(html).not.toContain("ucicinemas.it/movies");
    expect(html).toContain("Dune - Parte Tre");
  });

  it("finds a film shown only on Webtic and the Webtic cinemas of a UCI film", async () => {
    const results = await page("/search?q=primetime");
    const primetime = await page("/search?movie=primetime");
    const dune = await page("/search?movie=dune-parte-tre");

    expect(results).toContain("/search?q=primetime&amp;movie=primetime");
    expect(primetime).toContain('href="/theatres/webtic-5779/movies/primetime"');
    expect(dune).toContain('href="/theatres/webtic-5779/movies/dune-parte-tre"');
    expect(dune).toContain('href="/theatres/uci-cinemas-verona/movies/dune-parte-tre"');
  });

  it("offers Webtic cinemas in the hunt form", async () => {
    const html = await page("/hunts/new");

    expect(html).toContain('value="webtic-5779"');
  });

  it("allows the Webtic posters in the content security policy", async () => {
    const response = await (await app()).request("/theatres");

    expect(response.headers.get("content-security-policy")).toContain("https://secure.webtic.it");
  });

  it("says that the first check of the Webtic cinemas is still running", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = harness.world.fetch;
    harness.world.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.searchParams.get("localid") === "5779") await gate;
      return original(input, init);
    };
    const { instance, watcher } = await createWebApp(harness, { venues: null });
    await watcher.tick();
    for (let attempt = 0; attempt < 400 && watcher.services.venueStatus().venues === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const html = await (await instance.request("/theatres")).text();
    release();
    for (let attempt = 0; attempt < 400 && watcher.services.venueStatus().probing; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(html).toContain("Primo controllo dei cinema Webtic in corso: 1 trovati finora.");
    expect(html).toContain("CINEMA TEATRO JOLLY OLGINATE");
  });
});
