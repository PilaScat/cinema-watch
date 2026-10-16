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

async function watcher(extra: Partial<Parameters<typeof createWatcher>[0]> = {}) {
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
    ...extra,
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

  it("announces showings that appear on a day that was already checked and empty", async () => {
    await seed((config) => {
      config.hunts = [duneHunt(config, { window: { kind: "fixed", from: "2026-12-16", to: "2026-12-16" } })];
    });
    world.setProgramming("uci-cinemas-verona", "2026-12-16", { data: [] });
    const subject = await watcher();
    await subject.tick();
    const afterEmpty = sent();

    const release = JSON.parse(JSON.stringify(fixture("uci/programming-uci-cinemas-verona-2026-12-15.json")).split("2026-12-15").join("2026-12-16")) as unknown;
    world.setProgramming("uci-cinemas-verona", "2026-12-16", release);
    clock += 6 * MINUTE;
    await subject.tick();

    expect(afterEmpty).toEqual([]);
    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
    expect(world.telegram[1]?.text).toContain("20:30");
  });

  it("stays quiet about a day that enters a rolling window with showings already on sale", async () => {
    clock = Date.parse("2026-12-13T10:00:00Z");
    await seed((config) => {
      config.hunts = [duneHunt(config, { window: { kind: "next", days: 2 } })];
    });
    const subject = await watcher();
    await subject.tick();
    const afterFirst = sent();

    clock = Date.parse("2026-12-14T10:00:00Z");
    await subject.tick();

    expect(afterFirst).toEqual([]);
    expect(sent()).toEqual([]);
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

    expect(throttled).toEqual([expect.objectContaining({ skipped: true, events: 0 })]);
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
    expect(sameDay[0]).toContain("UCI: risposta 500");
    expect(sameDay[0]).not.toContain("Status");
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

  it("hands messages and halls to an outbox instead of Telegram in a dry run", async () => {
    await seed();
    const outbox: Array<{ kinds: string[]; photos: number }> = [];
    const subject = await watcher({
      outbox: (messages, photos) => {
        outbox.push({ kinds: messages.map((message) => message.kind), photos: photos.size });
        return Promise.resolve();
      },
    });

    await subject.tick();

    expect(world.telegram).toEqual([]);
    expect(outbox).toEqual([{ kinds: ["photo", "text"], photos: 1 }]);
  });

  it("keeps the alerts for later while Telegram is not configured", async () => {
    const config = await seed((draft) => {
      draft.settings.telegram = { token: null, chatId: null };
    });
    const huntId = config.hunts[0]?.id ?? "";
    const subject = await watcher();

    await subject.tick();
    const lastRun = subject.state().hunts[huntId]?.lastRun;
    config.settings.telegram = { token: FAKE_TOKEN, chatId: PRIMARY_CHAT };
    await saveConfig(createStore(dataDir), config);
    clock += 6 * MINUTE;
    await subject.tick();

    expect(lastRun?.at).toBe(Date.parse("2026-12-01T10:00:00Z"));
    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
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

  it("never runs the same hunt twice at once, so a refresh during a round sends nothing twice", async () => {
    await seed();
    const subject = await watcher();

    await Promise.all([subject.tick(), subject.runNow()]);

    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
  });

  it("keeps a mute pressed while a round is running", async () => {
    const config = await seed();
    const huntId = config.hunts[0]?.id ?? "";
    const subject = await watcher();

    await Promise.all([subject.tick(), subject.mute(huntId, 24 * 60 * MINUTE)]);

    expect(subject.state().hunts[huntId]?.mutedUntil).not.toBeNull();
  });

  it("delivers alerts on the next round when Telegram failed", async () => {
    await seed();
    world.failHost("api.telegram.org", 500);
    const subject = await watcher();
    await subject.tick();
    const whileDown = sent();
    world.restoreHost("api.telegram.org");
    clock += 6 * MINUTE;
    await subject.tick();

    expect(whileDown).toEqual([]);
    expect(sent()).toEqual([`sendPhoto:${PRIMARY_CHAT}:1`, `sendMessage:${PRIMARY_CHAT}:0`]);
    expect((await subject.events(20)).map((entry) => entry.kind)).toContain("telegramError");
  });

  it("keeps the other hunts going and waits the interval when a hunt fails", async () => {
    const config = await seed((draft) => {
      draft.hunts.push(
        createHunt(
          { name: "Niente", theatres: ["uci-cinemas-verona"], movie: { kind: "slug", slugs: ["nessun-film"] }, window: { kind: "fixed", from: "2026-12-15", to: "2026-12-16" } },
          draft.settings,
          () => 0.7,
        ),
      );
    });
    const [failing, other] = config.hunts.map((hunt) => hunt.id);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dataDir, "history"), "not a folder", "utf8");
    const subject = await watcher();

    await subject.tick();

    expect(subject.state().hunts[other ?? ""]?.lastRun?.ok).toBe(true);
    expect(subject.state().hunts[failing ?? ""]?.lastRun?.ok).toBe(false);
    expect(subject.state().hunts[failing ?? ""]?.nextRunAt).toBeGreaterThan(clock);
  });

  it("does not report showings as cancelled after the filters of a hunt change", async () => {
    const config = await seed();
    const subject = await watcher();
    await subject.tick();
    const hunt = config.hunts[0];
    if (hunt) hunt.timeFrom = "21:00";
    await saveConfig(createStore(dataDir), config);
    for (let round = 0; round < 3; round += 1) {
      clock += 6 * MINUTE;
      await subject.tick();
    }

    expect(world.telegram.some((call) => call.text?.includes("Annullati"))).toBe(false);
  });

  it("does not report cancellations when a day comes back empty", async () => {
    await seed();
    const subject = await watcher();
    await subject.tick();
    world.setProgramming("uci-cinemas-verona", "2026-12-15", { data: [] });
    for (let round = 0; round < 3; round += 1) {
      clock += 6 * MINUTE;
      await subject.tick();
    }

    expect(world.telegram.some((call) => call.text?.includes("Annullati"))).toBe(false);
  });

  it("tries the daily summary again when sending it failed", async () => {
    await seed();
    clock = Date.parse("2026-12-01T19:10:00Z");
    const subject = await watcher();
    await subject.mute((subject.config().hunts[0]?.id) ?? "", 60 * MINUTE);
    world.failHost("api.telegram.org", 500);
    await subject.tick();
    const failedDigest = subject.state().lastDigestDate;
    world.restoreHost("api.telegram.org");
    clock += MINUTE;
    await subject.tick();

    expect(failedDigest).toBeNull();
    expect(subject.state().lastDigestDate).toBe("2026-12-01");
  });

  it("keeps a dry run away from Telegram and from the saved state", async () => {
    await seed();
    world.failHost("myuci---uci-backend-production-nfluwp7wga-oc.a.run.app", 500);
    const outbox: string[] = [];
    const subject = await watcher({
      outbox: (messages) => {
        outbox.push(...messages.map((message) => message.kind));
        return Promise.resolve();
      },
    });

    await subject.runNow();
    const { readdir } = await import("node:fs/promises");

    expect(world.telegram).toEqual([]);
    expect(outbox).toEqual(["text"]);
    expect(await readdir(dataDir)).not.toContain("state.json");
  });

  it("treats the end of the quiet hours as part of them", async () => {
    await seed((config) => {
      config.settings.quietHours = { from: "04:00", to: "07:59" };
    });
    clock = Date.parse("2026-12-01T06:59:00Z");
    const subject = await watcher();

    await subject.tick();

    expect(cinemaRequests()).toEqual([]);
  });

  it("reads the programming again on a manual refresh instead of using the cache", async () => {
    await seed();
    const subject = await watcher();
    await subject.tick();
    const reads = () => world.requests.filter((request) => request.endsWith("/programming/2026-12-15")).length;
    const before = reads();
    clock += 10_000;
    await subject.runNow();

    expect(reads()).toBe(before + 1);
  });

  it("spreads the next round by up to a tenth of the interval", async () => {
    const config = await seed();
    const start = clock;
    const subject = await watcher({ random: () => 0.5 });

    await subject.tick();

    expect(subject.state().hunts[config.hunts[0]?.id ?? ""]?.nextRunAt).toBe(start + 5 * MINUTE * 1.05);
  });

  it("logs seat types it does not know", async () => {
    await seed();
    const store = createStore(dataDir);
    const screen = fixture("webtic/screen-5116-2.json") as { Data: { Screen: { Seats: Array<{ SeatId: string; Row: number; Column: number; SeatType: string; SectorId: string }> } } };
    const seats = screen.Data.Screen.Seats.map((seat) => ({
      id: seat.SeatId,
      rowLabel: seat.SeatId.split("/")[0],
      number: Number(seat.SeatId.split("/")[1]),
      row: seat.Row,
      column: seat.Column,
      sector: seat.SectorId,
      type: seat.SeatId === "A/1" ? "POLTRONA" : seat.SeatType,
    }));
    await store.writeJson("screens/5116-2.json", { localId: 5116, screenId: 2, seats, fetchedAt: clock });
    const subject = await watcher();

    await subject.tick();
    const entry = (await subject.events(10)).find((item) => item.kind === "unknownSeatType");

    expect(entry?.detail).toBe("POLTRONA");
  });

  it("drops showings already played and hunts that no longer exist from the state", async () => {
    const config = await seed((draft) => {
      const hunt = draft.hunts[0];
      if (hunt) hunt.window = { kind: "fixed", from: "2026-12-15", to: "2026-12-20" };
    });
    const huntId = config.hunts[0]?.id ?? "";
    const subject = await watcher();
    await subject.tick();
    clock = Date.parse("2026-12-16T10:00:00Z");
    await subject.tick();
    const afterShow = Object.keys(subject.state().hunts[huntId]?.showings ?? {});
    config.hunts = [];
    await saveConfig(createStore(dataDir), config);
    await subject.tick();

    expect(afterShow).toEqual([]);
    expect(subject.state().hunts).toEqual({});
  });

  it("keeps a copy of a state file written by a newer version", async () => {
    await seed();
    await createStore(dataDir).writeJson("state.json", { schemaVersion: 99 });
    const subject = await watcher();
    await subject.tick();
    const { readdir } = await import("node:fs/promises");

    expect((await readdir(dataDir)).some((name) => name.startsWith("state.json.bak-"))).toBe(true);
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
