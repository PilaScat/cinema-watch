import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadT18Venues } from "../src/circuits/t18.js";
import { createStore } from "../src/store.js";
import { createWatcher, type Watcher } from "../src/watcher.js";
import { T18_PROJECTION, T18_THEATER, textFixture } from "./support/fake-world.js";
import { andromedaVenues, createHarness, duneHunt, MINUTE, type Harness } from "./support/harness.js";

const ANDROMEDA = "roma.andromeda.18tickets.it";
const SLUG = "t18-roma-andromeda";
const SHOWING = `${SLUG}-${T18_PROJECTION}`;
const CART = `https://roma.andromeda.18tickets.it/film/81500/${T18_PROJECTION}#theater-init`;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function seedAndromedaHunt() {
  return harness.seed(
    (config) => {
      config.hunts = [
        duneHunt(config, {
          name: "Avengers Andromeda",
          theatres: [SLUG],
          movie: { kind: "slug", slugs: ["avengers-doomsday"] },
          formats: [],
          window: { kind: "fixed", from: "2026-12-16", to: "2026-12-16" },
          timeFrom: "17:00",
          timeTo: "18:00",
          zone: { kind: "relative", rowsFromPercent: 30, rowsToPercent: 80, centerPercent: 60 },
          together: 2,
        }),
      ];
    },
    { t18Venues: andromedaVenues(harness.now()) },
  );
}

function calls(page: string): number {
  return harness.world.t18Calls.filter((call) => call === page).length;
}

async function venuesSaved(watcher: Watcher, slug: string): Promise<void> {
  for (let attempt = 0; attempt < 400 && !(await watcher.services.theatres()).some((theatre) => theatre.slug === slug); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("hunts on an 18Tickets cinema", () => {
  it("reads programming and seats from 18Tickets and sends the hall with the 18Tickets purchase link", async () => {
    await seedAndromedaHunt();
    const watcher = await harness.watcher();

    await watcher.tick();

    const photo = harness.world.telegram.find((call) => call.method === "sendPhoto");
    const summary = harness.world.telegram.find((call) => call.method === "sendMessage");
    expect(photo?.photos).toBe(1);
    expect(summary?.text).toContain("Sala 1");
    expect(summary?.text).toContain("Andromeda Roma");
    expect(JSON.stringify(summary?.replyMarkup)).toContain(CART);
    const id = watcher.config().hunts[0]?.id ?? "";
    expect(watcher.state().hunts[id]?.lastRun).toMatchObject({ ok: true, showings: 1 });
    expect(watcher.state().hunts[id]?.showings[SHOWING]).toMatchObject({ hallKey: `${SLUG}-${T18_THEATER}`, room: "Sala 1" });
  });

  it("reads the home every round but the film page and the hall only once", async () => {
    await seedAndromedaHunt();
    const watcher = await harness.watcher();

    await watcher.tick();
    harness.advance(10 * MINUTE);
    await watcher.tick();

    expect(calls(`${ANDROMEDA}/`)).toBe(2);
    expect(calls(`${ANDROMEDA}/film/81500`)).toBe(1);
    expect(calls(`${ANDROMEDA}/theater/${T18_THEATER}.svg`)).toBe(1);
    expect(calls(`${ANDROMEDA}/seats/${T18_PROJECTION}`)).toBe(2);
  });

  it("reports an 18Tickets projection that disappears as cancelled", async () => {
    await seedAndromedaHunt();
    const watcher = await harness.watcher();
    await watcher.tick();

    harness.world.setT18Page(ANDROMEDA, "/", textFixture("t18/home-roma-andromeda.html").replace(`/film/81500/${T18_PROJECTION}#theater-init`, "/film/81500/gone"));
    for (let round = 0; round < 2; round += 1) {
      harness.advance(10 * MINUTE);
      await watcher.tick();
    }

    expect(harness.world.telegram.some((call) => call.text?.includes("Annullati") === true)).toBe(true);
  });

  it("names 18Tickets as the source when the programming cannot be read", async () => {
    await seedAndromedaHunt();
    harness.world.setT18Page(ANDROMEDA, "/", 503);
    const watcher = await harness.watcher();

    await watcher.tick();

    const lastRun = watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun;
    expect(lastRun).toMatchObject({ ok: false });
    expect(JSON.stringify(lastRun)).toContain("18Tickets");
  });

  it("shows an 18Tickets hall with its purchase link, also after a restart", async () => {
    await seedAndromedaHunt();
    const first = await harness.watcher();
    await first.tick();
    await first.close();
    const watcher = await harness.watcher();
    const before = calls(`${ANDROMEDA}/`);

    const view = await watcher.services.hall(SHOWING, undefined, SLUG);

    expect(view.chain).toBe("t18");
    expect(view.analysis.free).toBe(216);
    expect(view.performance).toMatchObject({ screenName: "Sala 1", startTime: "2026-12-16T17:30:00", hallKey: `${SLUG}-${T18_THEATER}` });
    expect(view.cartUrl(undefined)).toBe(CART);
    expect(calls(`${ANDROMEDA}/`)).toBe(before);
  });

  it("reads the home for a projection it does not know yet and refuses one that is not there", async () => {
    await harness.seed(undefined, { t18Venues: andromedaVenues(harness.now()) });
    const watcher = await harness.watcher();

    expect((await watcher.services.hall(SHOWING)).performance.startTime).toBe("2026-12-16T17:30:00");
    await expect(watcher.services.hall(`${SLUG}-00000000-0000-0000-0000-000000000000`)).rejects.toThrow("unknown projection");
    await expect(watcher.services.hall(`t18-nowhere-${T18_PROJECTION}`)).rejects.toThrow("unknown cinema");
  });
});

describe("18Tickets in cinemas, catalog and search", () => {
  it("adds the cinemas, the films and the cinemas that show a film", async () => {
    await harness.seed(undefined, { t18Venues: andromedaVenues(harness.now()) });
    const watcher = await harness.watcher();

    expect((await watcher.services.theatres()).find((theatre) => theatre.slug === SLUG)).toMatchObject({ name: "Andromeda Roma", region: "Lazio", chain: "t18" });
    expect((await watcher.services.movies()).find((movie) => movie.slug === "l-estranea")).toBeDefined();
    expect((await watcher.services.movieTheatres("l-estranea")).map((theatre) => theatre.slug)).toEqual([SLUG]);
    expect((await watcher.services.programming(SLUG)).get("2026-12-16")?.length).toBe(3);
  });

  it("checks the 18Tickets cinemas once a week, following the group pages, and saves them", async () => {
    await harness.seed(undefined, { t18Venues: null });
    const watcher = await harness.watcher();

    await watcher.tick();
    await venuesSaved(watcher, SLUG);
    await watcher.close();

    const saved = await loadT18Venues(createStore(harness.dataDir));
    expect(saved?.venues.map((venue) => venue.host)).toEqual([ANDROMEDA]);
    expect(saved?.checkedHosts).toContain("tibur.cdr.18tickets.it");
    expect(saved?.checkedHosts).toContain("nuovoolimpia.ccroma.18tickets.it");
  });

  it("checks again within the week when a cinema is added in the settings", async () => {
    await harness.seed(
      (config) => {
        config.settings.t18Hosts = ["vittoria.18tickets.it"];
      },
      { t18Venues: { ...andromedaVenues(harness.now()), venues: [] } },
    );
    harness.world.setT18Page("vittoria.18tickets.it", "/", textFixture("t18/home-roma-andromeda.html"));
    const watcher = await harness.watcher();

    await watcher.tick();
    await venuesSaved(watcher, "t18-vittoria");
    await watcher.close();

    expect((await loadT18Venues(createStore(harness.dataDir)))?.checkedHosts).toContain("vittoria.18tickets.it");
    expect((await watcher.services.theatres()).some((theatre) => theatre.slug === "t18-vittoria")).toBe(true);
  });

  it("stops at once on close while the check waits between two pages of the same operator", async () => {
    await harness.seed(undefined, { t18Venues: null });
    const watcher = await createWatcher({ dataDir: harness.dataDir, fetch: harness.world.fetch, now: () => harness.now(), version: "v0.0.0-test", logSink: () => undefined, env: {} });
    await watcher.tick();
    for (let attempt = 0; attempt < 400 && harness.world.t18Calls.length < 3; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    const started = Date.now();

    await watcher.close();

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(await loadT18Venues(createStore(harness.dataDir))).toBeNull();
  });

  it("keeps the old list and waits an hour when the check finds nothing", async () => {
    await harness.seed(undefined, { t18Venues: andromedaVenues(harness.now() - 8 * 24 * 60 * MINUTE) });
    harness.world.setT18Page(ANDROMEDA, "/", 503);
    const watcher = await harness.watcher();

    await watcher.tick();
    await watcher.close();

    expect((await loadT18Venues(createStore(harness.dataDir)))?.venues).toHaveLength(1);
  });
});
