import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHunt, defaultConfig, saveConfig } from "../src/config.js";
import type { Config, Hunt } from "../src/model.js";
import { createStore } from "../src/store.js";
import { createWatcher } from "../src/watcher.js";
import { createFakeWorld, FAKE_TOKEN, fixture, type FakeWorld } from "./support/fake-world.js";

const MINUTE = 60_000;
const PRIMARY_CHAT = "4242";

let dataDir: string;
let world: FakeWorld;
let clock: number;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "cinema-watch-"));
  world = createFakeWorld();
  clock = Date.parse("2026-12-01T10:00:00Z");
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function duneHunt(config: Config, overrides: Partial<Hunt> = {}): Hunt {
  return createHunt(
    {
      name: "Dune IMAX Verona",
      theatres: ["uci-cinemas-verona"],
      movie: { kind: "slug", slugs: ["dune-parte-tre"] },
      formats: ["IMAX"],
      window: { kind: "fixed", from: "2026-12-15", to: "2026-12-16" },
      zone: { kind: "absolute", rows: ["F", "G", "H", "J", "K", "L"], seatFrom: 5, seatTo: 16 },
      together: 3,
      ...overrides,
    },
    config.settings,
    () => 0.5,
  );
}

async function seed(mutate: (config: Config) => void = () => undefined): Promise<Config> {
  const config = defaultConfig();
  config.settings.telegram = { token: FAKE_TOKEN, chatId: PRIMARY_CHAT };
  config.hunts.push(duneHunt(config));
  mutate(config);
  await saveConfig(createStore(dataDir), config);
  return config;
}

async function watcher() {
  return createWatcher({
    dataDir,
    fetch: world.fetch,
    now: () => clock,
    random: () => 0,
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    version: "v0.0.0-test",
    logSink: () => undefined,
  });
}

function cinemaRequests() {
  return world.requests.filter((request) => !request.includes("api.github.com"));
}

function sent() {
  return world.telegram.map((call) => `${call.method}:${call.chatId ?? ""}:${call.photos}`);
}

describe("watcher", () => {
  it("announces the IMAX preview once with its hall and stays quiet on the next round", async () => {
    await seed();
    const subject = await watcher();

    await subject.tick();
    const afterFirst = sent();
    clock += 5 * MINUTE;
    await subject.tick();

    expect(afterFirst).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
    expect(world.telegram[1]?.text).toContain("20:30");
    expect(sent()).toEqual(afterFirst);
  });

  it("sends the hall and a seats freed summary when three seats together free up in the good zone", async () => {
    await seed();
    const subject = await watcher();
    await subject.tick();
    world.telegram.length = 0;

    world.setOccupancy(5116, 575978, withoutSeats(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));
    clock += 6 * MINUTE;
    await subject.tick();

    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
    expect(world.telegram[1]?.text).toContain("Posti liberati");
    expect(world.telegram[1]?.text).toContain("H 9-11");
  });

  it("skips scheduled rounds in the quiet hours but still runs a manual refresh", async () => {
    await seed((config) => {
      config.settings.quietHours = { from: "04:00", to: "08:00" };
    });
    clock = Date.parse("2026-12-01T04:00:00Z");
    const subject = await watcher();

    await subject.tick();
    const scheduledRequests = cinemaRequests().length;
    await subject.runNow();

    expect(scheduledRequests).toBe(0);
    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
  });

  it("refreshes a hunt by hand at most once every 30 seconds", async () => {
    await seed();
    const subject = await watcher();

    await subject.runNow();
    const afterFirst = world.requests.length;
    clock += 20_000;
    const throttled = await subject.runNow();
    const afterThrottled = world.requests.length;
    clock += 15_000;
    await subject.runNow();

    expect(throttled).toEqual([]);
    expect(afterThrottled).toBe(afterFirst);
    expect(world.requests.length).toBeGreaterThan(afterThrottled);
  });

  it("runs each hunt on its own interval and shares the programming read in the same minute", async () => {
    const config = await seed((draft) => {
      const dune = draft.hunts[0];
      if (dune) dune.intervalMinutes = 2;
      draft.hunts.push(
        createHunt(
          {
            name: "Avengers XL",
            theatres: ["uci-cinemas-verona"],
            movie: { kind: "slug", slugs: ["avengers-doomsday"] },
            formats: ["XL"],
            window: { kind: "fixed", from: "2026-12-16", to: "2026-12-16" },
            intervalMinutes: 15,
          },
          draft.settings,
          () => 0.9,
        ),
      );
    });
    const [dune, avengers] = config.hunts.map((hunt) => hunt.id);
    const subject = await watcher();
    const runs: Record<string, number[]> = {};
    let firstMinuteReads = 0;
    for (let minute = 0; minute <= 15; minute += 1) {
      await subject.tick();
      if (minute === 0) firstMinuteReads = world.requests.filter((request) => request.endsWith("/programming/2026-12-16")).length;
      for (const id of [dune, avengers]) {
        const at = id ? subject.state().hunts[id]?.lastRun?.at : undefined;
        if (id && at !== undefined && runs[id]?.at(-1) !== at) (runs[id] ??= []).push(at);
      }
      clock += MINUTE;
    }
    const minutes = (id: string | undefined) =>
      (runs[id ?? ""] ?? []).map((at) => Math.floor((at - Date.parse("2026-12-01T10:00:00Z")) / MINUTE));

    expect(minutes(dune)).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);
    expect(minutes(avengers)).toEqual([0, 15]);
    expect(firstMinuteReads).toBe(1);
  });

  it("keeps rounds going but sends nothing while a hunt is muted, until it is resumed", async () => {
    const config = await seed();
    const huntId = config.hunts[0]?.id ?? "";
    const subject = await watcher();

    await subject.mute(huntId, 24 * 60 * MINUTE);
    await subject.tick();
    const whileMuted = sent();
    const knownWhileMuted = Object.keys(subject.state().hunts[huntId]?.showings ?? {});
    await subject.resume(huntId);
    world.setOccupancy(5116, 575978, withoutSeats(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));
    clock += 6 * MINUTE;
    await subject.tick();

    expect(whileMuted).toEqual([]);
    expect(knownWhileMuted).toEqual(["5116-575978"]);
    expect(world.telegram.at(-1)?.text).toContain("Posti liberati");
  });

  it("archives a hunt marked as bought and stops running it", async () => {
    const config = await seed();
    const huntId = config.hunts[0]?.id ?? "";
    const subject = await watcher();

    await subject.markBought(huntId);
    await subject.tick();

    expect(subject.config().hunts[0]?.archivedAt).toBe("2026-12-01T10:00:00.000Z");
    expect(cinemaRequests()).toEqual([]);
  });

  it("archives a hunt whose fixed dates are over without reading anything", async () => {
    await seed();
    clock = Date.parse("2026-12-17T09:00:00Z");
    const subject = await watcher();

    await subject.tick();

    expect(subject.config().hunts[0]?.archivedAt).toBe("2026-12-17T09:00:00.000Z");
    expect(cinemaRequests()).toEqual([]);
  });

  it("warns once a day per hunt when the programming cannot be read", async () => {
    const config = await seed();
    const huntId = config.hunts[0]?.id ?? "";
    world.failHost("myuci---uci-backend-production-nfluwp7wga-oc.a.run.app", 500);
    const subject = await watcher();

    for (let round = 0; round < 4; round += 1) {
      await subject.tick();
      clock += 10 * MINUTE;
    }
    const sameDay = world.telegram.map((call) => call.text ?? "");
    clock = Date.parse("2026-12-02T10:00:00Z");
    await subject.tick();

    expect(sameDay).toHaveLength(1);
    expect(sameDay[0]).toContain("Dune IMAX Verona");
    expect(sameDay[0]).toContain("lettura non riuscita");
    expect(world.telegram).toHaveLength(2);
    expect(subject.state().hunts[huntId]?.lastRun?.ok).toBe(false);
  });

  it("sends the daily summary once after 20:00 Rome time", async () => {
    await seed();
    clock = Date.parse("2026-12-01T18:50:00Z");
    const subject = await watcher();
    await subject.tick();
    const digests = () => world.telegram.filter((call) => call.text?.includes("Riepilogo delle cacce")).length;
    const before = digests();

    clock = Date.parse("2026-12-01T19:20:00Z");
    await subject.tick();
    clock += 30 * MINUTE;
    await subject.tick();

    expect(before).toBe(0);
    expect(digests()).toBe(1);
    expect(world.telegram.find((call) => call.text?.includes("Riepilogo delle cacce"))?.text).toContain("Dune IMAX Verona");
  });

  it("logs rounds and alerts, and records the hall trend only when it changes", async () => {
    await seed();
    const subject = await watcher();
    await subject.tick();
    clock += 6 * MINUTE;
    await subject.tick();
    const steady = await subject.history("5116-575978");
    world.setOccupancy(5116, 575978, withoutSeats(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));
    clock += 6 * MINUTE;
    await subject.tick();

    const trend = await subject.history("5116-575978");
    const log = await subject.events(10);

    expect(steady.map((point) => [point.free, point.freeGood])).toEqual([[44, 0]]);
    expect(trend.map((point) => [point.free, point.freeGood])).toEqual([[44, 0], [47, 3]]);
    expect(log.map((entry) => entry.kind)).toEqual(["seatsFreed", "round", "round", "newShowing", "round"]);
    expect(log[0]?.key).toBe("5116-575978");
  });

  it("forgets the trend of a showing 30 days after its date", async () => {
    await seed();
    const subject = await watcher();
    await subject.tick();

    clock = Date.parse("2027-01-14T10:00:00Z");
    await subject.tick();
    const kept = await subject.history("5116-575978");
    clock = Date.parse("2027-01-15T10:00:00Z");
    await subject.tick();

    expect(kept).toHaveLength(1);
    expect(await subject.history("5116-575978")).toEqual([]);
    expect(subject.state().historyDays).toEqual({});
  });

  it("checks GitHub for a new release once a day and survives when GitHub is down", async () => {
    await seed();
    const subject = await watcher();
    const githubCalls = () => world.requests.filter((request) => request.includes("api.github.com")).length;

    await subject.tick();
    const found = subject.state().latestVersion;
    clock += 6 * 60 * MINUTE;
    await subject.tick();
    const sameDayCalls = githubCalls();
    world.failHost("api.github.com", 503);
    world.latestRelease = "v2026.11.1";
    clock += 20 * 60 * MINUTE;
    await subject.tick();

    expect(found).toBe("v2026.10.1");
    expect(sameDayCalls).toBe(1);
    expect(githubCalls()).toBe(2);
    expect(subject.state().latestVersion).toBe("v2026.10.1");
  });

  it("keeps hunting without Telegram configured", async () => {
    await seed((config) => {
      config.settings.telegram = { token: null, chatId: null };
    });
    const subject = await watcher();

    await subject.tick();

    expect(world.telegram).toEqual([]);
    expect(Object.keys(Object.values(subject.state().hunts)[0]?.showings ?? {})).toEqual(["5116-575978"]);
  });

  it("starts over from a corrupt state file and keeps a copy of it", async () => {
    await seed();
    const { writeFile, readdir } = await import("node:fs/promises");
    await writeFile(join(dataDir, "state.json"), "{ not json", "utf8");
    const subject = await watcher();

    await subject.tick();

    expect((await readdir(dataDir)).some((name) => name.startsWith("state.json.bak-"))).toBe(true);
    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
  });

  it("still announces a new showing as text when the seat map cannot be read", async () => {
    await seed();
    world.failHost("uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app", 500);
    const subject = await watcher();

    await subject.tick();
    const announcement = world.telegram.find((call) => call.text?.includes("Nuovi spettacoli"));

    expect(world.telegram.filter((call) => call.photos > 0)).toEqual([]);
    expect(announcement?.text).toContain("pianta non disponibile");
  });

  it("writes to the extra chats of a hunt with a reduced keyboard", async () => {
    await seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.extraChatIds = ["-1001234"];
    });
    const subject = await watcher();

    await subject.tick();
    const extraSummary = world.telegram.find((call) => call.chatId === "-1001234" && call.method === "sendMessage");
    const buttons = JSON.stringify(extraSummary?.replyMarkup);

    expect(sent()).toEqual([
      `sendPhoto:${PRIMARY_CHAT}:1`,
      `sendMessage:${PRIMARY_CHAT}:0`,
      "sendPhoto:-1001234:1",
      "sendMessage:-1001234:0",
    ]);
    expect(buttons).toContain("Aggiorna ora");
    expect(buttons).not.toContain("Silenzia");
    expect(buttons).not.toContain("Acquistato");
  });

  it("asks to confirm a movie found by title and follows it once confirmed", async () => {
    const config = await seed((draft) => {
      const hunt = draft.hunts[0];
      if (hunt) hunt.movie = { kind: "title", words: ["dune"], confirmedSlugs: [] };
    });
    const huntId = config.hunts[0]?.id ?? "";
    const subject = await watcher();

    await subject.tick();
    const beforeConfirm = sent();
    const appeared = world.telegram[0]?.text;
    await subject.confirmMovie(huntId, "dune-parte-tre");
    clock += 6 * MINUTE;
    await subject.tick();

    expect(beforeConfirm).toEqual([`sendMessage:${PRIMARY_CHAT}:0`]);
    expect(appeared).toContain("Film comparsi");
    expect(subject.state().hunts[huntId]?.pendingMovieSlugs).toEqual([]);
    expect(sent().slice(1)).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
  });

  it("logs a changed seat map so the good zone can be checked again", async () => {
    await seed();
    const store = createStore(dataDir);
    const screen = fixture("webtic/screen-5116-2.json") as { Data: { Screen: { Seats: Array<{ SeatId: string; Row: number; Column: number; SeatType: string; SectorId: string }> } } };
    const seats = screen.Data.Screen.Seats.filter((seat) => seat.SeatId !== "A/1").map((seat) => ({
      id: seat.SeatId,
      rowLabel: seat.SeatId.split("/")[0],
      number: Number(seat.SeatId.split("/")[1]),
      row: seat.Row,
      column: seat.Column,
      sector: seat.SectorId,
      type: seat.SeatType,
    }));
    await store.writeJson("screens/5116-2.json", { localId: 5116, screenId: 2, seats, fetchedAt: clock });
    world.setOccupancy(5116, 575978, withExtraTaken(fixture("webtic/occupancy-5116-575978.json"), "A/1"));
    const subject = await watcher();

    await subject.tick();

    expect((await subject.events(10)).map((entry) => entry.kind)).toContain("hallChanged");
  });

  it("applies the time, weekday and language filters of a hunt", async () => {
    const cases: Array<[Partial<Hunt>, number]> = [
      [{ timeFrom: "21:00", timeTo: "23:59" }, 0],
      [{ timeFrom: "20:00", timeTo: "21:00" }, 1],
      [{ weekdays: [2] }, 1],
      [{ weekdays: [3] }, 0],
      [{ languages: ["ENG"] }, 0],
      [{ languages: ["ita"] }, 1],
    ];
    const found: number[] = [];
    for (const [filters] of cases) {
      world = createFakeWorld();
      await rm(dataDir, { recursive: true, force: true });
      dataDir = await mkdtemp(join(tmpdir(), "cinema-watch-"));
      const config = await seed((draft) => {
        const hunt = draft.hunts[0];
        if (hunt) Object.assign(hunt, filters);
      });
      const subject = await watcher();
      await subject.tick();
      found.push(Object.keys(subject.state().hunts[config.hunts[0]?.id ?? ""]?.showings ?? {}).length);
    }

    expect(found).toEqual(cases.map(([, expected]) => expected));
  });

  it("sends nothing for alerts the hunt has switched off", async () => {
    await seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.notify = { ...hunt.notify, newShowings: false, lastSeats: false };
    });
    const subject = await watcher();

    await subject.tick();

    expect(world.telegram).toEqual([]);
  });

  it("reads back old state and logs while skipping broken lines", async () => {
    const config = await seed();
    const huntId = config.hunts[0]?.id ?? "";
    const store = createStore(dataDir);
    await store.writeJson("state.json", { schemaVersion: 1, hunts: { [huntId]: { mutedUntil: Date.parse("2026-12-02T10:00:00Z") } } });
    await store.appendLine("events.jsonl", "not json");
    await store.appendLine("events.jsonl", JSON.stringify({ t: 1, kind: 7 }));
    await store.appendLine("history/5116-575978.jsonl", "{ broken");
    const subject = await watcher();

    await subject.tick();
    const log = await subject.events();

    expect(world.telegram).toEqual([]);
    expect(subject.state().hunts[huntId]?.showings["5116-575978"]).toBeDefined();
    expect(log.map((entry) => entry.kind)).toEqual(["newShowing", "round"]);
    expect(await subject.history("5116-575978")).toHaveLength(1);
  });

  it("ignores a state file written by another schema version", async () => {
    await seed();
    await createStore(dataDir).writeJson("state.json", { schemaVersion: 99, hunts: "nope" });
    const subject = await watcher();

    await subject.tick();

    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
  });
});

function withExtraTaken(occupancy: unknown, seatId: string): unknown {
  const copyOf = structuredClone(occupancy) as { Data: { Occupancy: { Seats: Array<{ SeatId: string; SeatStatus: string }> } } };
  copyOf.Data.Occupancy.Seats.push({ SeatId: seatId, SeatStatus: "ACQUISTO" });
  return copyOf;
}

function withoutSeats(occupancy: unknown, seatIds: string[]): unknown {
  const copyOf = structuredClone(occupancy) as { Data: { Occupancy: { Seats: Array<{ SeatId: string }> } } };
  copyOf.Data.Occupancy.Seats = copyOf.Data.Occupancy.Seats.filter((seat) => !seatIds.includes(seat.SeatId));
  return copyOf;
}
