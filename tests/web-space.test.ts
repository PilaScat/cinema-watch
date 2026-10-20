import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { beinascoVenues, createHarness, type Harness } from "./support/harness.js";
import { createWebApp } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function request(path: string): Promise<Response> {
  return (await createWebApp(harness, { spaceVenues: beinascoVenues(harness.now()) })).instance.request(path);
}

async function page(path: string): Promise<string> {
  return (await request(path)).text();
}

describe("The Space cinemas in the web UI", () => {
  it("lists a The Space cinema in its region with the circuit label", async () => {
    const html = await page("/theatres");

    expect(html).toContain('href="/theatres/space-1028"');
    expect(html).toContain("The Space Beinasco");
    expect(html).toContain(">The Space</span>");
    expect(html.indexOf(">Piemonte</h2>")).toBeLessThan(html.indexOf("The Space Beinasco"));
  });

  it("shows the programming of a The Space cinema and the showings of a film", async () => {
    const theatre = await page("/theatres/space-1028");
    const movie = await page("/theatres/space-1028/movies/avengers-doomsday?day=2026-12-16");

    expect(theatre).toContain('href="/theatres/space-1028/movies/avengers-doomsday"');
    expect(theatre).toContain("https://www.thespacecinema.it/-/media/");
    expect(movie).toContain('href="/showings/space-1028-58489?theatre=space-1028&amp;movie=avengers-doomsday&amp;from=');
    expect(movie).toContain("Sala 7");
  });

  it("buys a The Space showing on The Space and lets its posters through the content policy", async () => {
    const response = await request("/showings/space-1028-58489?theatre=space-1028&movie=avengers-doomsday");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("https://www.thespacecinema.it/prenotare-il-biglietto/summary/1028/HO00003467/58489");
    expect(html).toContain("Sala 7");
    expect(response.headers.get("content-security-policy")).toContain("https://www.thespacecinema.it");
  });

  it("shows a notice for a session that is not in the programming", async () => {
    expect(await page("/showings/space-1028-1")).toContain("Pianta non disponibile.");
  });

  it("finds the The Space cinemas of a film", async () => {
    expect(await page("/search?movie=avengers-doomsday")).toContain('href="/theatres/space-1028/movies/avengers-doomsday?from=');
  });
});
