import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DayTimes } from "../src/model.js";
import { createHarness, duneHunt, type Harness } from "./support/harness.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function followedTimes(dayTimes: DayTimes): Promise<string[]> {
  await harness.seed((config) => {
    config.hunts = [
      duneHunt(config, {
        name: "Avengers mattina",
        movie: { kind: "slug", slugs: ["avengers-doomsday"] },
        formats: [],
        window: { kind: "fixed", from: "2026-12-16", to: "2026-12-16" },
        timeFrom: "23:50",
        dayTimes,
      }),
    ];
  });
  const watcher = await harness.watcher();
  await watcher.tick();
  const hunt = watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""];
  return Object.values(hunt?.showings ?? {}).map((showing) => showing.time).sort();
}

describe("times of their own for a day", () => {
  it("follows the showings of the day's own hours in place of the general ones", async () => {
    const times = await followedTimes({ "3": { from: "09:00", to: "10:00" } });

    expect(times.length).toBeGreaterThan(0);
    expect(times.every((time) => time >= "09:00" && time <= "10:00")).toBe(true);
  });

  it("keeps the general hours on the other days", async () => {
    expect(await followedTimes({ "6": { from: "09:00", to: "10:00" } })).toEqual(["23:50"]);
  });
});
