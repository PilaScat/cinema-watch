import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { T18_PROJECTION } from "./support/fake-world.js";
import { andromedaVenues, createHarness, type Harness } from "./support/harness.js";
import { createWebApp } from "./support/web.js";

const SHOWING = `t18-roma-andromeda-${T18_PROJECTION}`;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function request(path: string): Promise<Response> {
  return (await createWebApp(harness, { t18Venues: andromedaVenues(harness.now()) })).instance.request(path);
}

async function page(path: string): Promise<string> {
  return (await request(path)).text();
}

describe("18Tickets cinemas in the web UI", () => {
  it("lists an 18Tickets cinema in its region with the circuit label", async () => {
    const html = await page("/theatres");

    expect(html).toContain('href="/theatres/t18-roma-andromeda"');
    expect(html).toContain("Andromeda Roma");
    expect(html).toContain(">18Tickets</span>");
    expect(html.indexOf(">Lazio</h2>")).toBeLessThan(html.indexOf("Andromeda Roma"));
  });

  it("shows the programming of an 18Tickets cinema and the projections of a film", async () => {
    const theatre = await page("/theatres/t18-roma-andromeda");
    const movie = await page("/theatres/t18-roma-andromeda/movies/avengers-doomsday?day=2026-12-16");

    expect(theatre).toContain('href="/theatres/t18-roma-andromeda/movies/l-estranea"');
    expect(theatre).toContain("https://cdn.18tickets.net/");
    expect(movie).toContain(`href="/showings/${SHOWING}?theatre=t18-roma-andromeda&amp;movie=avengers-doomsday&amp;from=`);
    expect(movie).toContain("Sala 1");
  });

  it("buys an 18Tickets projection on 18Tickets and lets its posters through the content policy", async () => {
    const response = await request(`/showings/${SHOWING}?theatre=t18-roma-andromeda&movie=avengers-doomsday`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(`https://roma.andromeda.18tickets.it/film/81500/${T18_PROJECTION}#theater-init`);
    expect(html).toContain("Sala 1");
    expect(response.headers.get("content-security-policy")).toContain("https://cdn.18tickets.net");
  });

  it("finds the 18Tickets cinemas of a film", async () => {
    expect(await page("/search?movie=l-estranea")).toContain('href="/theatres/t18-roma-andromeda/movies/l-estranea?from=');
  });
});
