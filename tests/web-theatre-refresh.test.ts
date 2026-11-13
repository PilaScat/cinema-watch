import { beforeEach, describe, expect, it } from "vitest";
import { andromedaVenues, createHarness, type Harness } from "./support/harness.js";
import { createWebApp, post, UCI_HOST } from "./support/web.js";

const VERONA = "/theatres/uci-cinemas-verona";
const ANDROMEDA = "/theatres/t18-roma-andromeda";
const HALF_MINUTE = 30_000;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

function programmeReads(): number {
  return harness.world.requests.filter((request) => request === `GET ${UCI_HOST}/api/theatres/uci-cinemas-verona/programming`).length;
}

function homeReads(): number {
  return harness.world.requests.filter((request) => /^GET [a-z0-9.-]+\.18tickets\.it\/$/.test(request)).length;
}

describe("programme of a single cinema", () => {
  it("is reread when the page opens, at most once every 30 seconds", async () => {
    const { instance } = await createWebApp(harness);

    await instance.request(VERONA);
    const afterFirst = programmeReads();
    await instance.request(VERONA);
    const afterSecond = programmeReads();
    harness.advance(HALF_MINUTE);
    await instance.request(VERONA);
    const afterWait = programmeReads();
    harness.advance(HALF_MINUTE);
    await instance.request(VERONA, { headers: { "sec-purpose": "prefetch;prerender" } });
    await instance.request(`${VERONA}/movies/dune-parte-tre`);

    expect([afterFirst, afterSecond, afterWait, programmeReads()]).toEqual([1, 1, 2, 2]);
  });

  it("is reread with the button, which goes back to the page, with the same interval", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(VERONA)).text();
    const tooSoon = await instance.request(`${VERONA}/refresh`, post());
    const afterTooSoon = programmeReads();
    harness.advance(HALF_MINUTE);
    const pressed = await instance.request(`${VERONA}/refresh`, post());
    await instance.request(VERONA);

    expect(html).toContain(`<form method="post" action="${VERONA}/refresh" class="inline">`);
    expect(html).toContain("Aggiorna ora");
    expect([tooSoon.status, tooSoon.headers.get("location"), afterTooSoon]).toEqual([303, VERONA, 1]);
    expect([pressed.status, pressed.headers.get("location"), programmeReads()]).toEqual([303, VERONA, 2]);
    expect((await instance.request("/theatres/Bad_Slug/refresh", post())).status).toBe(404);
  });

  it("keeps the programme it has when the reread fails", async () => {
    const { instance } = await createWebApp(harness);
    await instance.request(VERONA);
    harness.advance(HALF_MINUTE);
    harness.world.failHost(UCI_HOST, 500);

    const html = await (await instance.request(VERONA)).text();

    expect(html).toContain('href="/theatres/uci-cinemas-verona/movies/dune-parte-tre"');
    expect(html).not.toContain("Programmazione non disponibile");
  });

  it("goes past the one minute cache of the 18Tickets home page", async () => {
    const { instance } = await createWebApp(harness, { t18Venues: andromedaVenues(harness.now()) });

    await instance.request(ANDROMEDA);
    const afterOpen = homeReads();
    harness.advance(HALF_MINUTE);
    await instance.request(`${ANDROMEDA}/refresh`, post());

    expect([afterOpen, homeReads()]).toEqual([1, 2]);
  });
});
