import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp, interceptFetch, UCI_HOST } from "./support/web.js";

const PLAIN = "avengers-endgame-extra";
const VISION = "avengers-endgame-extra-infinity-vision";
const VERONA = { name: "UCI Cinemas Verona", slug: "uci-cinemas-verona", movie_variants: [1] };
const AREZZO = { name: "UCI Cinemas Arezzo", slug: "uci-cinemas-arezzo", movie_variants: [1] };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
  interceptFetch(harness, (url, passthrough) => {
    if (url.hostname !== UCI_HOST) return passthrough();
    if (url.pathname === `/api/movies/${PLAIN}/theatres`) return Promise.resolve(Response.json({ data: [VERONA, AREZZO] }));
    if (url.pathname === `/api/movies/${VISION}/theatres`) return Promise.resolve(Response.json({ data: [VERONA] }));
    return passthrough();
  });
});

afterEach(async () => {
  await harness.dispose();
});

function theatreReads(): string[] {
  return harness.world.requests.filter((request) => request.endsWith("/theatres") && request.includes("/api/movies/"));
}

describe("search with the versions of a film merged", () => {
  it("shows one result for the film, whatever version matches", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/search?q=avenger")).text();

    expect(html.match(/movie=avengers-endgame-extra[^"]*"/g)).toEqual(['movie=avengers-endgame-extra"']);
    expect(html).not.toContain("Avengers: Endgame Extra (Infinity Vision)");
    expect(html).toContain("INFINITY VISION");
  });

  it("lists each cinema once, with its versions when it has more than one", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(`/search?q=avenger&movie=${PLAIN}&all=1`)).text();

    expect(html).toContain("Cinema con Avengers: Endgame Extra");
    expect(html.match(/UCI Cinemas Verona/g)).toHaveLength(1);
    expect(html).toContain(`href="/theatres/uci-cinemas-arezzo/movies/${PLAIN}?from=`);
    expect(html).toContain(`href="/theatres/uci-cinemas-verona/movies/${PLAIN}?from=`);
    expect(html).toContain(`href="/theatres/uci-cinemas-verona/movies/${VISION}?from=`);
    expect(html).toContain(">Avengers: Endgame Extra (Infinity Vision)</a>");
    expect(html).not.toContain(`href="/theatres/uci-cinemas-arezzo/movies/${VISION}`);
  });

  it("takes the slug of any version and shows the whole film", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(`/search?movie=${VISION}&all=1`)).text();

    expect(html).toContain("Cinema con Avengers: Endgame Extra");
    expect(html).toContain(`href="/theatres/uci-cinemas-arezzo/movies/${PLAIN}?from=`);
  });

  it("asks UCI only for the films of its own catalogue", async () => {
    const { instance } = await createWebApp(harness);

    await instance.request("/search?q=avenger&movie=not-a-uci-film");

    expect(theatreReads()).toEqual([]);
  });
});
