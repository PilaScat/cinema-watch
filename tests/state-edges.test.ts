import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventLog } from "../src/events.js";
import { createHistory } from "../src/history.js";
import { emptyHuntState } from "../src/round.js";
import { emptyState, loadState, migrateState } from "../src/state.js";
import { createStore } from "../src/store.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cinema-watch-state-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("migrateState", () => {
  it("starts empty from anything that is not a state of this version", () => {
    expect(migrateState(null)).toEqual(emptyState());
    expect(migrateState("state")).toEqual(emptyState());
    expect(migrateState([])).toEqual(emptyState());
    expect(migrateState({ schemaVersion: 0, hunts: { abcd1234: {} } })).toEqual(emptyState());
  });

  it("keeps no hunts when the hunts field is not an object", () => {
    const state = migrateState({ ...emptyState(), hunts: "nope" });

    expect(state.hunts).toEqual({});
  });

  it("fills a hunt that is missing fields and replaces a hunt that is not an object", () => {
    const state = migrateState({ ...emptyState(), hunts: { aaaaaaaa: { mutedUntil: 5 }, bbbbbbbb: "broken", cccccccc: null } });

    expect(state.hunts["aaaaaaaa"]).toEqual({ ...emptyHuntState(), mutedUntil: 5 });
    expect(state.hunts["bbbbbbbb"]).toEqual(emptyHuntState());
    expect(state.hunts["cccccccc"]).toEqual(emptyHuntState());
  });

  it("keeps the other top level fields it knows", () => {
    const state = migrateState({ ...emptyState(), lastDigestDate: "2026-12-01", latestVersion: "v2026.10.1" });

    expect(state.lastDigestDate).toBe("2026-12-01");
    expect(state.latestVersion).toBe("v2026.10.1");
  });
});

describe("loadState", () => {
  it("rethrows a read error that is not a corrupt file", async () => {
    await mkdir(join(dir, "state.json"));

    await expect(loadState(createStore(dir), () => 1)).rejects.toThrow();
  });

  it("starts empty and keeps a copy when the file is not valid json", async () => {
    const store = createStore(dir);
    await store.appendLine("state.json", "{ not json");

    const state = await loadState(store, () => 42);

    expect(state).toEqual(emptyState());
    expect(await store.readLines("state.json.bak-42")).toEqual(["{ not json"]);
  });

  it("starts empty when there is no file", async () => {
    expect(await loadState(createStore(dir), () => 1)).toEqual(emptyState());
  });
});

describe("history file", () => {
  it("skips lines that are not complete points", async () => {
    const store = createStore(dir);
    await store.appendLine("history/5116-1.jsonl", JSON.stringify({ t: 1, free: 4 }));
    await store.appendLine("history/5116-1.jsonl", JSON.stringify({ t: "2", free: 4, freeGood: 1 }));
    await store.appendLine("history/5116-1.jsonl", JSON.stringify({ t: 3, free: 4, freeGood: 1 }));

    expect(await createHistory(store).read("5116-1")).toEqual([{ t: 3, free: 4, freeGood: 1 }]);
  });

  it("does not repeat a point whose numbers did not change", async () => {
    const history = createHistory(createStore(dir));

    await history.append("5116-1", { t: 1, free: 4, freeGood: 1 });
    await history.append("5116-1", { t: 2, free: 4, freeGood: 1 });
    await history.append("5116-1", { t: 3, free: 5, freeGood: 1 });

    expect(await history.read("5116-1")).toEqual([
      { t: 1, free: 4, freeGood: 1 },
      { t: 3, free: 5, freeGood: 1 },
    ]);
  });
});

describe("event log", () => {
  it("writes nothing for an empty list", async () => {
    const store = createStore(dir);

    await createEventLog(store).add([]);

    expect(await store.readLines("events.jsonl")).toEqual([]);
  });

  it("lists the newest first and honours the limit", async () => {
    const log = createEventLog(createStore(dir));
    await log.add([
      { t: 1, huntId: null, kind: "round", key: null, detail: "a" },
      { t: 2, huntId: null, kind: "round", key: null, detail: "b" },
      { t: 3, huntId: null, kind: "round", key: null, detail: "c" },
    ]);

    expect((await log.list(2)).map((entry) => entry.detail)).toEqual(["c", "b"]);
  });
});
