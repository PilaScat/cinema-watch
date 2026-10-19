import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileHallStore } from "../src/hall-store.js";
import { emptyState, loadState, migrateState } from "../src/state.js";
import { createStore } from "../src/store.js";
import { fixture } from "./support/fake-world.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "cinema-watch-state-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("state version 1 to 2", () => {
  it("keeps the keys of the real Unraid state and turns cinema and screen ids into a hall key", () => {
    const state = migrateState(fixture("state/v1-unraid.json"));
    const showings = state.hunts["6s0lrqco"]?.showings ?? {};

    expect(state.schemaVersion).toBe(2);
    expect(Object.keys(showings)).toEqual(["5116-576754", "5116-576766"]);
    expect(showings["5116-576754"]).toMatchObject({ key: "5116-576754", hallKey: "5116-14", theatreSlug: "uci-cinemas-verona", screenName: "SALA 07 XL" });
    expect(showings["5116-576754"]).not.toHaveProperty("localId");
    expect(showings["5116-576754"]).not.toHaveProperty("performanceId");
    expect(showings["5116-576754"]).not.toHaveProperty("screenId");
    expect(Object.keys(state.historyDays)).toEqual(["5116-576754", "5116-576766"]);
    expect(state.hunts["wor7667k"]?.showings).toEqual({});
  });

  it("gives no hall key to a showing whose screen was never read, and leaves odd hunts alone", () => {
    const state = migrateState({
      ...emptyState(),
      schemaVersion: 1,
      hunts: { aaaaaaaa: { showings: { "1-2": { key: "1-2", localId: 1, screenId: null }, "1-3": "broken" } }, bbbbbbbb: { showings: "nope" } },
    });

    expect(state.hunts["aaaaaaaa"]?.showings["1-2"]).toEqual({ key: "1-2", hallKey: null });
    expect(state.hunts["aaaaaaaa"]?.showings["1-3"]).toBe("broken");
    expect(state.hunts["bbbbbbbb"]?.showings).toBe("nope");
  });

  it("loads a version 1 file from disk as version 2", async () => {
    await writeFile(join(dataDir, "state.json"), JSON.stringify(fixture("state/v1-unraid.json")));

    const state = await loadState(createStore(dataDir), () => 0);

    expect(state.schemaVersion).toBe(2);
    expect(state.hunts["6s0lrqco"]?.showings["5116-576766"]?.hallKey).toBe("5116-14");
  });
});

describe("hall store", () => {
  it("reads a hall saved by the previous version under the same file name", async () => {
    const store = createStore(dataDir);
    await store.writeJson("screens/5116-2.json", { localId: 5116, screenId: 2, seats: [], fetchedAt: 7 });

    expect(await createFileHallStore(store).get("5116-2")).toEqual({ key: "5116-2", seats: [], fetchedAt: 7 });
    expect(await createFileHallStore(store).get("5116-3")).toBeNull();
  });
});
