import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHttpClient } from "../src/http.js";
import { createStore } from "../src/store.js";
import type { CatalogMovie } from "../src/types.js";
import { loadVenueList, mergeCatalogs, probeVenues, saveVenueList, VENUE_CHECK_MS, VENUE_FILE, venuesDue, venuesWithMovie, venueTheatres } from "../src/venues.js";
import { createWebticDirectClient, type WebticVenue } from "../src/webtic-direct.js";
import { createFakeWorld } from "./support/fake-world.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "cinema-watch-venues-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function direct(world = createFakeWorld()) {
  return createWebticDirectClient(createHttpClient({ allowedHosts: ["secure.webtic.it"], userAgent: "test", fetch: world.fetch }));
}

function movie(slug: string, overrides: Partial<CatalogMovie> = {}): CatalogMovie {
  return { slug, title: slug, poster: null, firstDay: "2026-12-16", lastDay: "2026-12-20", formats: ["2D"], ...overrides };
}

function venue(localId: number, movies: CatalogMovie[]): WebticVenue {
  return {
    theatre: { slug: `webtic-${localId}`, name: `Cinema ${localId}`, city: "", province: null, region: null, isLuxe: false, screens: [], lat: null, lon: null, chain: "webtic" },
    movies,
  };
}

describe("probeVenues", () => {
  it("keeps the candidates with films in programming and skips the ones Webtic refuses", async () => {
    const found: string[] = [];
    const list = await probeVenues(direct(), () => 42, { onFound: (item) => found.push(item.theatre.slug) });

    expect(list.checkedAt).toBe(42);
    expect(list.venues.map((item) => item.theatre.slug)).toEqual(["webtic-5851", "webtic-5779"]);
    expect(found).toEqual(["webtic-5851", "webtic-5779"]);
    expect(list.venues[0]?.movies.map((item) => item.slug)).toEqual(["fammi-il-piacere"]);
  });

  it("drops a cinema whose programming has no films", async () => {
    const world = createFakeWorld();
    world.setScheduling(5851, { userdata: { StatusOk: true }, DS: { Scheduling: { LocalId: 5851, Events: [] } } });

    const list = await probeVenues(direct(world), () => 0);

    expect(list.venues.map((item) => item.theatre.slug)).toEqual(["webtic-5779"]);
  });

  it("stops instead of saving a cut list when Webtic fails in the middle", async () => {
    const world = createFakeWorld();
    const original = world.fetch;
    world.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.searchParams.get("localid") === "5779") return Promise.resolve(new Response("{}", { status: 503 }));
      return original(input, init);
    };

    await expect(probeVenues(direct(world), () => 0)).rejects.toThrow("Status 503");
  });

  it("skips a cinema that does not answer in time", async () => {
    const world = createFakeWorld();
    const original = world.fetch;
    world.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.searchParams.get("localid") === "5851") return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
      return original(input, init);
    };
    const client = createWebticDirectClient(createHttpClient({ allowedHosts: ["secure.webtic.it"], userAgent: "test", fetch: world.fetch, timeoutMs: 1, backoffBaseMs: 0, backoffMaxMs: 0 }));

    const list = await probeVenues(client, () => 0);

    expect(list.venues.map((item) => item.theatre.slug)).toEqual(["webtic-5779"]);
  });

  it("stops when asked to", async () => {
    await expect(probeVenues(direct(), () => 0, { stopped: () => true })).rejects.toThrow("stopped");
  });

  it("fails when the list of venues cannot be read", async () => {
    const world = createFakeWorld();
    world.failHost("secure.webtic.it", 500);

    await expect(probeVenues(direct(world), () => 0)).rejects.toThrow();
  });
});

describe("venuesDue", () => {
  it("is due without a list and once a week after the last check", () => {
    expect(venuesDue(null, 0)).toBe(true);
    expect(venuesDue({ checkedAt: 0, venues: [] }, VENUE_CHECK_MS - 1)).toBe(false);
    expect(venuesDue({ checkedAt: 0, venues: [] }, VENUE_CHECK_MS)).toBe(true);
  });
});

describe("venue file", () => {
  it("saves and reads the list back", async () => {
    const store = createStore(dataDir);
    const list = { checkedAt: 7, venues: [venue(1, [movie("dune-parte-tre")])] };

    await saveVenueList(store, list);

    expect(await loadVenueList(store)).toEqual(list);
    expect(venueTheatres(list).map((theatre) => theatre.slug)).toEqual(["webtic-1"]);
    expect(venueTheatres(null)).toEqual([]);
  });

  it("ignores a missing, broken or foreign file", async () => {
    const store = createStore(dataDir);
    expect(await loadVenueList(store)).toBeNull();

    await writeFile(join(dataDir, VENUE_FILE), "{");
    expect(await loadVenueList(store)).toBeNull();

    await writeFile(join(dataDir, VENUE_FILE), JSON.stringify({ checkedAt: 1, venues: [{ theatre: { chain: "uci" }, movies: [] }] }));
    expect(await loadVenueList(store)).toBeNull();
  });
});

describe("mergeCatalogs", () => {
  it("adds the Webtic films and widens dates and formats of the ones UCI already has", () => {
    const uci = [movie("dune-parte-tre", { poster: null, formats: ["IMAX"], firstDay: "2026-12-16", lastDay: null })];
    const venues = [
      venue(1, [movie("dune-parte-tre", { poster: "p.jpg", formats: ["2D", "IMAX"], firstDay: "2026-12-15", lastDay: "2026-12-31" })]),
      venue(2, [movie("primetime", { firstDay: null, lastDay: null })]),
    ];

    const merged = mergeCatalogs(uci, venues);

    expect(merged).toEqual([
      movie("dune-parte-tre", { poster: "p.jpg", formats: ["IMAX", "2D"], firstDay: "2026-12-15", lastDay: "2026-12-31" }),
      movie("primetime", { firstDay: null, lastDay: null }),
    ]);
    expect(uci[0]?.formats).toEqual(["IMAX"]);
  });

  it("keeps the UCI dates when the Webtic ones are missing or narrower", () => {
    const merged = mergeCatalogs([movie("a", { poster: "uci.jpg" })], [venue(1, [movie("a", { poster: "w.jpg", firstDay: null, lastDay: "2026-12-18" })])]);

    expect(merged).toEqual([movie("a", { poster: "uci.jpg" })]);
  });
});

describe("venuesWithMovie", () => {
  it("lists the Webtic cinemas that show a film", () => {
    const venues = [venue(1, [movie("a")]), venue(2, [movie("b")])];

    expect(venuesWithMovie(venues, "b")).toEqual([{ slug: "webtic-2", name: "Cinema 2", variants: [] }]);
  });
});
