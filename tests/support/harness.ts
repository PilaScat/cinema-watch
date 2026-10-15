import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHunt, defaultConfig, saveConfig } from "../../src/config.js";
import type { Config, Hunt } from "../../src/model.js";
import { createStore } from "../../src/store.js";
import { createWatcher } from "../../src/watcher.js";
import { createFakeWorld, FAKE_TOKEN, type FakeWorld } from "./fake-world.js";

export const MINUTE = 60_000;
export const PRIMARY_CHAT = "4242";

export interface Harness {
  dataDir: string;
  world: FakeWorld;
  now(): number;
  advance(ms: number): void;
  set(at: number): void;
  seed(mutate?: (config: Config) => void): Promise<Config>;
  watcher(): ReturnType<typeof createWatcher>;
  sleep: (ms: number) => Promise<void>;
  dispose(): Promise<void>;
}

export function duneHunt(config: Config, overrides: Partial<Hunt> = {}): Hunt {
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

export async function createHarness(start = Date.parse("2026-12-01T10:00:00Z")): Promise<Harness> {
  const dataDir = await mkdtemp(join(tmpdir(), "cinema-watch-"));
  const world = createFakeWorld();
  let clock = start;
  const sleep = (ms: number) => {
    clock += ms;
    return Promise.resolve();
  };
  return {
    dataDir,
    world,
    now: () => clock,
    advance: (ms) => {
      clock += ms;
    },
    set: (at) => {
      clock = at;
    },
    async seed(mutate = () => undefined) {
      const config = defaultConfig();
      config.settings.telegram = { token: FAKE_TOKEN, chatId: PRIMARY_CHAT };
      config.hunts.push(duneHunt(config));
      mutate(config);
      await saveConfig(createStore(dataDir), config);
      return config;
    },
    watcher: () =>
      createWatcher({
        dataDir,
        fetch: world.fetch,
        now: () => clock,
        random: () => 0,
        sleep,
        version: "v0.0.0-test",
        logSink: () => undefined,
      }),
    sleep,
    dispose: () => rm(dataDir, { recursive: true, force: true }),
  };
}
