import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp, interceptFetch, rewriteJson, UCI_HOST } from "./support/web.js";

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

  it("lists each cinema once, leading to the film in that cinema", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(`/search?q=avenger&movie=${PLAIN}&all=1`)).text();

    expect(html).toContain("Cinema con Avengers: Endgame Extra");
    expect(html.match(/UCI Cinemas Verona/g)).toHaveLength(1);
    expect(html).toContain(`href="/theatres/uci-cinemas-arezzo/movies/${PLAIN}?from=`);
    expect(html).toContain(`href="/theatres/uci-cinemas-verona/movies/${PLAIN}?from=`);
    expect(html).not.toContain(`/movies/${VISION}`);
  });

  it("takes the slug of any version and shows the whole film", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request(`/search?movie=${VISION}&all=1`)).text();

    expect(html).toContain("Cinema con Avengers: Endgame Extra");
    expect(html).toContain(`href="/theatres/uci-cinemas-arezzo/movies/${PLAIN}?from=`);
  });

  it("merges the versions on the page of a cinema and lists them all on the page of the film", async () => {
    rewriteJson(
      harness,
      (url) => url.hostname === UCI_HOST && url.pathname === "/api/theatres/uci-cinemas-verona/programming",
      (json) => {
        const days = (json as { data: Array<Record<string, Array<{ slug: string; title: string }>>> }).data;
        for (const film of days.flatMap((day) => day["2026-12-16"] ?? [])) if (film.slug === "avengers-doomsday") Object.assign(film, { slug: "avengers-doomsday-it", title: "Avengers: Doomsday (It)" });
        return json;
      },
    );
    const { instance } = await createWebApp(harness);

    const theatre = await (await instance.request("/theatres/uci-cinemas-verona")).text();
    const first = await (await instance.request("/theatres/uci-cinemas-verona/movies/avengers-doomsday?day=2026-12-16")).text();
    const version = await (await instance.request("/theatres/uci-cinemas-verona/movies/avengers-doomsday-it")).text();

    expect(theatre.match(/href="\/theatres\/uci-cinemas-verona\/movies\/avengers-doomsday[^"]*"/g)).toEqual(['href="/theatres/uci-cinemas-verona/movies/avengers-doomsday"']);
    expect(first).toContain(">Avengers: Doomsday (It)</span>");
    expect(first).toContain("movie=avengers-doomsday-it&amp;from=");
    expect(first).toContain("?day=2026-12-15");
    expect(version).toContain("?day=2026-12-16");
    expect(version).toContain("movie=avengers-doomsday&amp;from=");
  });

  it("asks UCI only for the films of its own catalogue", async () => {
    const { instance } = await createWebApp(harness);

    await instance.request("/search?q=avenger&movie=not-a-uci-film");

    expect(theatreReads()).toEqual([]);
  });
});
