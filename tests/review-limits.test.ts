import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig, parseConfig } from "../src/config.js";
import { resolveWindow } from "../src/dates.js";
import { HttpError } from "../src/errors.js";
import { createHttpClient } from "../src/http.js";
import { isQuiet } from "../src/watcher-rules.js";
import { parseHall } from "../src/webtic.js";
import { fixture } from "./support/fake-world.js";
import { createHarness, duneHunt, type Harness } from "./support/harness.js";

const NOON = Date.parse("2026-12-01T11:00:00Z");

describe("how far a hunt looks ahead", () => {
  it("reads at most 120 days from today, however late the last date is", () => {
    const days = resolveWindow({ kind: "fixed", from: "2026-12-15", to: "2099-12-31" }, new Date(NOON));

    expect(days).toHaveLength(120);
    expect(days[0]).toBe("2026-12-15");
    expect(days.at(-1)).toBe("2027-04-13");
  });

  it("keeps a shorter range as it is", () => {
    expect(resolveWindow({ kind: "fixed", from: "2026-12-15", to: "2026-12-16" }, new Date(NOON))).toEqual(["2026-12-15", "2026-12-16"]);
  });
});

describe("quiet hours", () => {
  it("are off, not endless, when they start and end at the same time", () => {
    const settings = { ...defaultConfig().settings, quietHours: { from: "22:00", to: "22:00" } };

    expect(isQuiet(settings, NOON)).toBe(false);
  });
});

describe("what a hunt can list", () => {
  it("accepts 100 cinemas and 20 extra chats, and refuses more", () => {
    const config = defaultConfig();
    const slugs = Array.from({ length: 101 }, (_, index) => `cinema-${index}`);
    const chats = Array.from({ length: 21 }, (_, index) => String(1000 + index));
    const withLists = (theatres: string[], extraChatIds: string[]) => parseConfig({ ...config, hunts: [{ ...duneHunt(config), theatres, extraChatIds }] });

    expect(withLists(slugs.slice(0, 100), chats.slice(0, 20)).ok).toBe(true);
    expect(withLists(slugs, []).ok).toBe(false);
    expect(withLists(["uci-cinemas-verona"], chats).ok).toBe(false);
  });
});

describe("a hall that cannot be drawn", () => {
  const screen = fixture("webtic/screen-5116-2.json") as { Data: { Screen: { Seats: Array<Record<string, unknown>> } } };
  const withSeats = (seats: Array<Record<string, unknown>>) => ({ ...screen, Data: { Screen: { ...screen.Data.Screen, Seats: seats } } });

  it("is refused when it has no seats", () => {
    expect(() => parseHall(withSeats([]), 0)).toThrow("no seats");
  });

  it("is refused when a seat sits outside any real hall", () => {
    const [first] = screen.Data.Screen.Seats;

    expect(() => parseHall(withSeats([{ ...first, Column: 5_000_000 }]), 0)).toThrow("Column");
    expect(() => parseHall(withSeats([{ ...first, Row: -1 }]), 0)).toThrow("Row");
  });
});

describe("requests waiting for one host", () => {
  it("are refused beyond the limit instead of piling up", async () => {
    const client = createHttpClient({
      allowedHosts: ["a.example.com"],
      userAgent: "test",
      fetch: () => new Promise<Response>(() => undefined),
      maxQueued: 2,
    });

    void client.getJson("https://a.example.com/1").catch(() => undefined);
    void client.getJson("https://a.example.com/2").catch(() => undefined);
    const third = client.getJson("https://a.example.com/3");

    await expect(third).rejects.toBeInstanceOf(HttpError);
    await expect(third).rejects.toMatchObject({ kind: "backoff" });
  });
});

describe("in the watcher", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await harness.dispose();
  });

  const sent = (): number => harness.world.telegram.filter((call) => call.method.startsWith("send")).length;

  it("a hunt with an empty language list follows every language", async () => {
    await harness.seed((config) => {
      const [hunt] = config.hunts;
      if (hunt) hunt.languages = [];
    });
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(Object.keys(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.showings ?? {})).toEqual(["5116-575978"]);
  });

  it("sends the snapshot of a hunt once, not again within 30 seconds", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    const huntId = watcher.config().hunts[0]?.id ?? "";

    const first = await watcher.sendSnapshot(huntId);
    const afterFirst = sent();
    const second = await watcher.sendSnapshot(huntId);
    harness.advance(31_000);
    const third = await watcher.sendSnapshot(huntId);

    expect([first, second, third]).toEqual([true, false, true]);
    expect(afterFirst).toBeGreaterThan(0);
    expect(sent()).toBe(afterFirst * 2);
  });

  it("sends the test message once, not again within 30 seconds", async () => {
    await harness.seed();
    const watcher = await harness.watcher();

    const first = await watcher.sendTest();
    const second = await watcher.sendTest();

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(sent()).toBe(1);
  });
});
