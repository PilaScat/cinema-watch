import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../src/store.js";
import { loadVenueList } from "../src/venues.js";
import type { Watcher } from "../src/watcher.js";
import { fixture } from "./support/fake-world.js";
import { createHarness, duneHunt, merlataVenues, MINUTE, type Harness } from "./support/harness.js";

const MERLATA = "webtic-5779";
const PROXY = "uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app";
const DIRECT = "secure.webtic.it";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function requestsTo(host: string): string[] {
  return harness.world.requests.filter((request) => request.split(" ")[1]?.startsWith(`${host}/`));
}

async function probeDone(watcher: Watcher): Promise<void> {
  for (let attempt = 0; attempt < 400 && watcher.services.venueStatus().probing; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function seedMerlataHunt() {
  return harness.seed((config) => {
    config.hunts = [duneHunt(config, { name: "Dune Merlata", theatres: [MERLATA], formats: [], zone: { kind: "relative", rowsFromPercent: 30, rowsToPercent: 80, centerPercent: 60 } })];
  });
}

describe("hunts on a Webtic cinema", () => {
  it("reads programming and seats from Webtic directly and sends the hall with the Webtic purchase link", async () => {
    await seedMerlataHunt();
    const watcher = await harness.watcher();

    await watcher.tick();

    const photo = harness.world.telegram.find((call) => call.method === "sendPhoto");
    const summary = harness.world.telegram.find((call) => call.method === "sendMessage");
    expect(photo?.photos).toBe(1);
    expect(summary?.text).toContain("SALA 1");
    expect(JSON.stringify(summary?.replyMarkup)).toContain("https://secure.webtic.it/angwt/webtic.aspx?lid=5779&lng=it#/shoppingmode/it/0/5779/1223/51133");
    expect(requestsTo(PROXY)).toEqual([]);
    expect(requestsTo(DIRECT)).toHaveLength(4);
    expect(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun).toMatchObject({ ok: true, showings: 1 });
  });

  it("reads the programming of a cinema once per round for all the days of the hunt", async () => {
    await seedMerlataHunt();
    const watcher = await harness.watcher();

    await watcher.tick();
    harness.advance(10 * MINUTE);
    await watcher.tick();

    expect(harness.world.webticCalls.filter((call) => call === "getFullScheduling")).toHaveLength(2);
  });

  it("reads the programming of a cinema once also when refreshed by hand", async () => {
    await seedMerlataHunt();
    const watcher = await harness.watcher();

    await watcher.runNow();

    expect(harness.world.webticCalls.filter((call) => call === "getFullScheduling")).toHaveLength(1);
  });

  it("reports a Webtic showing that disappears as cancelled", async () => {
    await harness.seed((config) => {
      config.hunts = [duneHunt(config, { name: "Avengers Merlata", theatres: [MERLATA], movie: { kind: "slug", slugs: ["avengers-doomsday"] }, formats: [] })];
    });
    const watcher = await harness.watcher();
    await watcher.tick();
    const reduced = structuredClone(fixture("webtic-direct/scheduling-5779.json")) as { DS: { Scheduling: { Events: Array<{ EventId: number; Days: Array<{ Performances: Array<{ PerformanceId: number }> }> }> } } };
    for (const event of reduced.DS.Scheduling.Events) {
      for (const day of event.Days) day.Performances = day.Performances.filter((performance) => performance.PerformanceId !== 52159);
    }
    harness.world.setScheduling(5779, reduced);

    for (let round = 0; round < 2; round += 1) {
      harness.advance(10 * MINUTE);
      await watcher.tick();
    }

    expect(harness.world.telegram.some((call) => call.text?.includes("Annullati") === true)).toBe(true);
  });

  it("keeps the Webtic cinema names in the messages when UCI does not answer", async () => {
    await harness.seed(
      (config) => {
        config.hunts = [duneHunt(config, { name: "Dune Merlata", theatres: [MERLATA], formats: [] })];
      },
      { venues: merlataVenues(harness.now()) },
    );
    harness.world.failHost("myuci---uci-backend-production-nfluwp7wga-oc.a.run.app", 500);
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(harness.world.telegram.find((call) => call.method === "sendMessage")?.text).toContain("Notorious Cascina Merlata");
  });

  it("updates the films of a Webtic cinema in search with the programming read by a hunt", async () => {
    const stale = merlataVenues(harness.now());
    const venues = { ...stale, venues: stale.venues.map((venue) => ({ ...venue, movies: [] })) };
    await harness.seed((config) => {
      config.hunts = [duneHunt(config, { name: "Dune Merlata", theatres: [MERLATA], formats: [] })];
    }, { venues });
    const watcher = await harness.watcher();
    expect(await watcher.services.movieTheatres("primetime")).toEqual([]);

    await watcher.tick();

    expect((await watcher.services.movieTheatres("primetime")).map((theatre) => theatre.slug)).toEqual([MERLATA]);
    expect((await watcher.services.movies()).find((movie) => movie.slug === "primetime")).toMatchObject({ title: "Primetime" });
    expect(harness.world.webticCalls.filter((call) => call === "getFullScheduling")).toHaveLength(1);
  });

  it("reads only the programming of known Webtic cinemas", async () => {
    await harness.seed();
    const watcher = await harness.watcher();

    await expect(watcher.services.programming("webtic-999")).rejects.toThrow("unknown cinema");
    expect(harness.world.webticCalls).toEqual([]);
  });

  it("names Webtic as the source when the programming of a Webtic cinema cannot be read", async () => {
    await seedMerlataHunt();
    harness.world.failHost(DIRECT, 500);
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun?.error).toContain("Webtic");
  });

  it("picks the Webtic hall from the cinema of the link or from the showings seen, even without the cinema list", async () => {
    await seedMerlataHunt();
    const watcher = await harness.watcher();
    await watcher.tick();
    await watcher.saveConfig({ ...watcher.config(), hunts: [] });

    expect((await watcher.services.hall("5779-51133")).chain).toBe("webtic");
    expect((await watcher.services.hall("5779-51133", undefined, MERLATA)).chain).toBe("webtic");
    expect((await watcher.services.hall("5116-575978", undefined, "uci-cinemas-verona")).chain).toBe("uci");
  });

  it("shows a Webtic hall through the direct API and a UCI hall through the UCI proxy", async () => {
    await harness.seed(undefined, { venues: merlataVenues(harness.now()) });
    const watcher = await harness.watcher();

    const webtic = await watcher.services.hall("5779-51133");
    const uci = await watcher.services.hall("5116-575978");

    expect(webtic).toMatchObject({ chain: "webtic", performance: { hallKey: "5779-233" } });
    expect(webtic.analysis.sellable).toBeGreaterThan(0);
    expect(uci.chain).toBe("uci");
    expect(requestsTo(PROXY)).toHaveLength(3);
  });
});

describe("weekly check of the Webtic cinemas", () => {
  it("finds the cinemas with films, saves them and adds them to cinemas, catalog and search", async () => {
    await harness.seed(undefined, { venues: null });
    const watcher = await harness.watcher();

    await watcher.tick();
    await probeDone(watcher);

    const slugs = (await watcher.services.theatres()).map((theatre) => theatre.slug);
    expect(slugs).toContain(MERLATA);
    expect(slugs).toContain("uci-cinemas-verona");
    expect(watcher.services.venueStatus()).toEqual({ checkedAt: expect.any(Number) as number, probing: false, venues: 2 });
    expect((await loadVenueList(createStore(harness.dataDir)))?.venues.map((venue) => venue.theatre.slug)).toEqual(["webtic-5851", MERLATA]);
    const catalog = await watcher.services.movies();
    expect(catalog.find((movie) => movie.slug === "primetime")).toMatchObject({ title: "Primetime" });
    expect(catalog.find((movie) => movie.slug === "avengers-doomsday")?.formats).toContain("INFINITY VISION");
    const dune = (await watcher.services.movieTheatres("dune-parte-tre")).map((theatre) => theatre.slug);
    expect(dune).toContain(MERLATA);
    expect(dune).toContain("uci-cinemas-verona");
    expect((await watcher.services.movieTheatres("primetime")).map((theatre) => theatre.slug)).toEqual([MERLATA]);
  });

  it("does not check again within the week", async () => {
    await harness.seed(undefined, { venues: null });
    const watcher = await harness.watcher();
    await watcher.tick();
    await probeDone(watcher);
    const before = requestsTo(DIRECT).length;

    harness.advance(6 * 24 * 60 * MINUTE);
    await watcher.tick();
    await probeDone(watcher);

    expect(requestsTo(DIRECT)).toHaveLength(before);
  });

  it("shows the cinemas found so far while the first check is still running", async () => {
    await harness.seed(undefined, { venues: null });
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
    const watcher = await harness.watcher();

    await watcher.tick();
    for (let attempt = 0; attempt < 400 && watcher.services.venueStatus().venues === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(watcher.services.venueStatus()).toEqual({ checkedAt: null, probing: true, venues: 1 });
    expect((await watcher.services.theatres()).map((theatre) => theatre.slug)).toContain("webtic-5851");
    release();
    await probeDone(watcher);
    expect(watcher.services.venueStatus().venues).toBe(2);
  });

  it("keeps the old list and retries after an hour when the check fails or finds nothing", async () => {
    await harness.seed(undefined, { venues: null });
    harness.world.setScheduling(5779, { userdata: { StatusOk: true }, DS: { Scheduling: { LocalId: 5779, Events: [] } } });
    harness.world.setScheduling(5851, { userdata: { StatusOk: true }, DS: { Scheduling: { LocalId: 5851, Events: [] } } });
    const watcher = await harness.watcher();

    await watcher.tick();
    await probeDone(watcher);
    const afterFirst = requestsTo(DIRECT).length;
    harness.advance(30 * MINUTE);
    await watcher.tick();
    await probeDone(watcher);

    expect(requestsTo(DIRECT)).toHaveLength(afterFirst);
    expect(watcher.services.venueStatus().checkedAt).toBeNull();
    expect(await loadVenueList(createStore(harness.dataDir))).toBeNull();

    harness.advance(31 * MINUTE);
    await watcher.tick();
    await probeDone(watcher);
    expect(requestsTo(DIRECT).length).toBeGreaterThan(afterFirst);
  });

  it("stops the check on close without saving a partial list", async () => {
    await harness.seed(undefined, { venues: null });
    const original = harness.world.fetch;
    harness.world.fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.searchParams.get("localid") !== "5779") return original(input, init);
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    };
    const watcher = await harness.watcher();
    await watcher.tick();
    for (let attempt = 0; attempt < 400 && watcher.services.venueStatus().venues === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await watcher.close();

    expect(watcher.services.venueStatus().probing).toBe(false);
    expect(await loadVenueList(createStore(harness.dataDir))).toBeNull();
    await watcher.tick();
    expect(watcher.services.venueStatus().probing).toBe(false);
  });

  it("keeps the old list when Webtic fails in the middle of the weekly check", async () => {
    const checkedAt = harness.now() - 8 * 24 * 60 * MINUTE;
    await harness.seed(undefined, { venues: merlataVenues(checkedAt) });
    harness.world.failHost(DIRECT, 503);
    const watcher = await harness.watcher();

    await watcher.tick();
    await probeDone(watcher);

    expect(watcher.services.venueStatus()).toMatchObject({ checkedAt, venues: 1 });
    expect((await loadVenueList(createStore(harness.dataDir)))?.venues).toHaveLength(1);
  });

  it("does not check the cinemas in a dry run", async () => {
    await harness.seed(undefined, { venues: null });
    const { createWatcher } = await import("../src/watcher.js");
    const watcher = await createWatcher({
      dataDir: harness.dataDir,
      fetch: harness.world.fetch,
      now: () => harness.now(),
      version: "v0.0.0-test",
      logSink: () => undefined,
      outbox: () => Promise.resolve(),
    });

    await watcher.tick();

    expect(watcher.services.venueStatus().probing).toBe(false);
    expect(requestsTo(DIRECT)).toEqual([]);
  });
});
