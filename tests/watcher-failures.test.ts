import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, duneHunt, MINUTE, type Harness } from "./support/harness.js";
import { interceptFetch } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function sentMessages(): number {
  return harness.world.telegram.filter((call) => call.method.startsWith("send")).length;
}

describe("a failing disk", () => {
  it("does not send the same alert again when the trend cannot be written after the alert went out", async () => {
    await harness.seed();
    await writeFile(join(harness.dataDir, "history"), "not a folder");
    const watcher = await harness.watcher();

    await watcher.tick();
    const afterFirstRound = sentMessages();
    harness.advance(10 * MINUTE);
    await watcher.tick();

    expect(afterFirstRound).toBeGreaterThan(0);
    expect(sentMessages()).toBe(afterFirstRound);
  });

  it("keeps the hunts in memory when the configuration file disappears between two rounds", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    await watcher.tick();
    const huntId = watcher.config().hunts[0]?.id ?? "";
    await rm(join(harness.dataDir, "config.json"));

    harness.advance(10 * MINUTE);
    await watcher.tick();

    expect(watcher.config().hunts.map((hunt) => hunt.name)).toEqual(["Dune IMAX Verona"]);
    expect(Object.keys(watcher.state().hunts[huntId]?.showings ?? {})).toEqual(["5116-575978"]);
  });

  it("still runs the hunts when the cleanup of an old trend fails", async () => {
    await harness.seed();
    await writeFile(join(harness.dataDir, "state.json"), JSON.stringify({ schemaVersion: 2, hunts: {}, historyDays: { "5116-1": "2026-01-01" } }));
    await mkdir(join(harness.dataDir, "history", "5116-1.jsonl"), { recursive: true });
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(sentMessages()).toBeGreaterThan(0);
  });
});

describe("shutdown", () => {
  it("does not start the next hunt once the watcher is closing", async () => {
    await harness.seed((config) => {
      config.hunts.push({ ...duneHunt(config, { name: "Second hunt" }), id: "second00" });
    });
    const closing: Array<Promise<void>> = [];
    let close = (): Promise<void> => Promise.resolve();
    interceptFetch(harness, (url, passthrough) => {
      if (url.pathname.includes("/programming") && closing.length === 0) closing.push(close());
      return passthrough();
    });
    const watcher = await harness.watcher();
    close = () => watcher.close();

    await watcher.tick();
    await Promise.all(closing);

    const [first, second] = watcher.config().hunts;
    expect(watcher.state().hunts[first?.id ?? ""]?.lastRun).not.toBeNull();
    expect(watcher.state().hunts[second?.id ?? ""]?.lastRun ?? null).toBeNull();
  });
});
