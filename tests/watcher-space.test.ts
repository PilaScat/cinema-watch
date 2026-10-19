import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSpaceVenues } from "../src/circuits/the-space.js";
import { createStore } from "../src/store.js";
import type { Watcher } from "../src/watcher.js";
import { fixture } from "./support/fake-world.js";
import { beinascoVenues, createHarness, duneHunt, MINUTE, type Harness } from "./support/harness.js";

const BEINASCO = "space-1028";
const SHOWING = "space-1028-58489";
const SPACE = "www.thespacecinema.it";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function seedBeinascoHunt() {
  return harness.seed(
    (config) => {
      config.hunts = [
        duneHunt(config, {
          name: "Avengers Beinasco",
          theatres: [BEINASCO],
          movie: { kind: "slug", slugs: ["avengers-doomsday"] },
          formats: [],
          window: { kind: "fixed", from: "2026-12-16", to: "2026-12-16" },
          timeFrom: "14:00",
          timeTo: "14:30",
          zone: { kind: "relative", rowsFromPercent: 30, rowsToPercent: 80, centerPercent: 60 },
          together: 2,
        }),
      ];
    },
    { spaceVenues: beinascoVenues(harness.now()) },
  );
}

async function spaceVenuesSaved(watcher: Watcher): Promise<void> {
  for (let attempt = 0; attempt < 400 && !(await watcher.services.theatres()).some((theatre) => theatre.slug === BEINASCO); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("hunts on a The Space cinema", () => {
  it("reads programming and seats from The Space and sends the hall with the The Space purchase link", async () => {
    await seedBeinascoHunt();
    const watcher = await harness.watcher();

    await watcher.tick();

    const photo = harness.world.telegram.find((call) => call.method === "sendPhoto");
    const summary = harness.world.telegram.find((call) => call.method === "sendMessage");
    expect(photo?.photos).toBe(1);
    expect(summary?.text).toContain("Sala 7");
    expect(summary?.text).toContain("The Space Beinasco");
    expect(JSON.stringify(summary?.replyMarkup)).toContain("https://www.thespacecinema.it/prenotare-il-biglietto/summary/1028/HO00003467/58489");
    const id = watcher.config().hunts[0]?.id ?? "";
    expect(watcher.state().hunts[id]?.lastRun).toMatchObject({ ok: true, showings: 1 });
    expect(watcher.state().hunts[id]?.showings[SHOWING]).toMatchObject({ hallKey: "space-1028-sala-7" });
    expect(harness.world.spaceCalls.filter((call) => call === "/showings/cinemas/1028/films")).toHaveLength(1);
  });

  it("reads the programming once per round and asks a new token only when it expires", async () => {
    await seedBeinascoHunt();
    const watcher = await harness.watcher();

    await watcher.tick();
    harness.world.expireSpaceToken();
    harness.advance(10 * MINUTE);
    await watcher.tick();

    expect(harness.world.spaceCalls.filter((call) => call === "/showings/cinemas/1028/films")).toHaveLength(3);
    expect(harness.world.spaceCalls.filter((call) => call === "/auth/token")).toHaveLength(2);
    expect(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun).toMatchObject({ ok: true });
  });

  it("reports a The Space showing that disappears as cancelled", async () => {
    await seedBeinascoHunt();
    const watcher = await harness.watcher();
    await watcher.tick();

    const reduced = structuredClone(fixture("space/programming-1028.json")) as { result: Array<{ showingGroups: Array<{ sessions: Array<{ sessionId: string }> }> }> };
    for (const film of reduced.result) {
      for (const group of film.showingGroups) group.sessions = group.sessions.filter((session) => session.sessionId !== "58489");
    }
    harness.world.setSpaceProgramming("1028", reduced);
    for (let round = 0; round < 2; round += 1) {
      harness.advance(10 * MINUTE);
      await watcher.tick();
    }

    expect(harness.world.telegram.some((call) => call.text?.includes("Annullati") === true)).toBe(true);
  });

  it("names The Space as the source when its programming cannot be read", async () => {
    await harness.seed(
      (config) => {
        config.hunts = [duneHunt(config, { theatres: ["space-9999"], formats: [] })];
      },
      { spaceVenues: beinascoVenues(harness.now()) },
    );
    harness.world.setSpaceProgramming("9999", "not json");
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun).toMatchObject({ ok: false });
    expect(JSON.stringify(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun)).toContain("The Space");
  });

  it("shows a The Space hall with its purchase link once the showing is known", async () => {
    await seedBeinascoHunt();
    const watcher = await harness.watcher();
    await watcher.tick();

    const view = await watcher.services.hall(SHOWING, undefined, BEINASCO);

    expect(view.chain).toBe("space");
    expect(view.analysis.free).toBe(233);
    expect(view.performance.screenName).toBe("Sala 7");
    expect(view.performance.startTime).toBe("2026-12-16T14:10:00");
    expect(view.cartUrl("avengers-doomsday")).toBe("https://www.thespacecinema.it/prenotare-il-biglietto/summary/1028/HO00003467/58489");
  });
});

describe("The Space in cinemas, catalog and search", () => {
  it("adds the cinemas, the films and the cinemas that show a film", async () => {
    await harness.seed(undefined, { spaceVenues: beinascoVenues(harness.now()) });
    const watcher = await harness.watcher();

    const theatres = await watcher.services.theatres();
    const catalog = await watcher.services.movies();

    expect(theatres.find((theatre) => theatre.slug === BEINASCO)).toMatchObject({ name: "The Space Beinasco", chain: "space" });
    expect(catalog.find((movie) => movie.slug === "primetime")).toBeDefined();
    expect((await watcher.services.movieTheatres("avengers-doomsday")).map((theatre) => theatre.slug)).toContain(BEINASCO);
    expect((await watcher.services.programming(BEINASCO)).get("2026-12-16")).toHaveLength(4);
  });

  it("checks the list of The Space cinemas once a week and saves it", async () => {
    await harness.seed(undefined, { spaceVenues: null });
    const watcher = await harness.watcher();

    await watcher.tick();
    await spaceVenuesSaved(watcher);

    const saved = await loadSpaceVenues(createStore(harness.dataDir));
    expect(saved?.theatres).toHaveLength(35);
    expect(saved?.theatres.find((theatre) => theatre.slug === BEINASCO)).toMatchObject({ region: "Piemonte" });
    const calls = harness.world.spaceCalls.filter((call) => call === "/showings/cinemas").length;

    harness.advance(6 * 24 * 60 * MINUTE);
    await watcher.tick();

    expect(harness.world.spaceCalls.filter((call) => call === "/showings/cinemas")).toHaveLength(calls);
  });

  it("keeps the old list when the check fails", async () => {
    await harness.seed(undefined, { spaceVenues: beinascoVenues(harness.now() - 8 * 24 * 60 * MINUTE) });
    harness.world.failHost(SPACE, 503);
    const watcher = await harness.watcher();

    await watcher.tick();
    await watcher.close();

    expect((await loadSpaceVenues(createStore(harness.dataDir)))?.theatres).toHaveLength(1);
  });
});
