import { mkdirSync, rmSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

describe("a round that breaks after the alert went out", () => {
  const statePath = () => join(harness.dataDir, "state.json");

  function breakStateWhileSending(): void {
    let broken = false;
    interceptFetch(harness, (url, passthrough) => {
      if (url.pathname.includes("/send") && !broken) {
        broken = true;
        rmSync(statePath(), { force: true });
        mkdirSync(statePath());
      }
      return passthrough();
    });
  }

  function repairStateOnRoundError(line: string): void {
    if (line.includes('"msg":"round"')) rmSync(statePath(), { recursive: true, force: true });
  }

  it("marks the hunt as failed, writes the error in the log and plans the next round", async () => {
    await harness.seed();
    breakStateWhileSending();
    const watcher = await harness.watcher({ logSink: repairStateOnRoundError });
    const huntId = watcher.config().hunts[0]?.id ?? "";
    const at = harness.now();

    await watcher.tick();

    const huntState = watcher.state().hunts[huntId];
    expect(huntState?.lastRun).toMatchObject({ at, ok: false, showings: 0 });
    expect(huntState?.lastRun?.error).toMatch(/state\.json/);
    expect(huntState?.errorSince).toBe(at);
    expect(huntState?.nextRunAt).toBeGreaterThan(at);
    const saved = JSON.parse(await readFile(statePath(), "utf8")) as { hunts: Record<string, { lastRun: { ok: boolean } }> };
    expect(saved.hunts[huntId]?.lastRun.ok).toBe(false);
    const logged = (await readFile(join(harness.dataDir, "events.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { huntId: string; kind: string; detail: string; t: number });
    expect(logged.filter((entry) => entry.kind === "error")).toEqual([{ t: at, huntId, kind: "error", key: null, detail: huntState?.lastRun?.error }]);
  });

  it("does not send the alert again at the next round and clears the failure", async () => {
    await harness.seed();
    breakStateWhileSending();
    const watcher = await harness.watcher({ logSink: repairStateOnRoundError });
    const huntId = watcher.config().hunts[0]?.id ?? "";

    await watcher.tick();
    const afterFailedRound = sentMessages();
    harness.advance(10 * MINUTE);
    await watcher.tick();

    expect(afterFailedRound).toBeGreaterThan(0);
    expect(sentMessages()).toBe(afterFailedRound);
    expect(watcher.state().hunts[huntId]?.lastRun).toMatchObject({ ok: true, error: null });
    expect(watcher.state().hunts[huntId]?.errorSince).toBeNull();
  });

  it("still closes the round when the log cannot be written either", async () => {
    await harness.seed();
    await mkdir(join(harness.dataDir, "events.jsonl"));
    breakStateWhileSending();
    const lines: string[] = [];
    const watcher = await harness.watcher({
      logSink: (line) => {
        lines.push(line);
        repairStateOnRoundError(line);
      },
    });

    await watcher.tick();

    expect(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.lastRun?.ok).toBe(false);
    expect(lines.filter((line) => line.includes('"msg":"event log"'))).toHaveLength(1);
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
