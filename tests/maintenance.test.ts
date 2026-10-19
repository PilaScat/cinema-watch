import { describe, expect, it } from "vitest";
import { createHunt, defaultConfig } from "../src/config.js";
import { expiredHistoryKeys, prunedState, releaseTag, versionCheckDue, VERSION_CHECK_MS } from "../src/maintenance.js";
import type { HuntEvent, ShowingSnapshot, ShowingState, State } from "../src/model.js";
import { emptyHuntState } from "../src/round.js";
import { eventDetail, eventKey, roundEntries } from "../src/round-log.js";
import type { HuntObservation } from "../src/runner.js";
import { emptyState } from "../src/state.js";

const ROME_NOON_DEC_31 = Date.parse("2026-12-31T11:00:00Z");

function snapshot(key: string, startsAt: string): ShowingSnapshot {
  return {
    key,
    theatreSlug: "t",
    movieSlug: "m",
    movieTitle: "M",
    format: "IMAX",
    formatGroup: "IMAX",
    language: null,
    day: startsAt.slice(0, 10),
    startsAt,
    time: startsAt.slice(11, 16),
    room: "Sala",
    cartUrl: "https://ucicinemas.it/x",
    hallKey: "1-2",
    screenName: "Sala",
    priceFrom: null,
    seats: null,
  };
}

function known(key: string, startsAt: string): ShowingState {
  return { ...snapshot(key, startsAt), firstSeenAt: 0, lastSeenAt: 0, missingRounds: 0, zoneSignature: null, okNotifiedAt: null, okBaseline: null, belowThreshold: false };
}

describe("history retention", () => {
  const state: State = { ...emptyState(), historyDays: { old: "2026-11-30", edge: "2026-12-01", fresh: "2026-12-30" } };

  it("expires the trend 30 days after the showing day, keeping the 30th day", () => {
    expect(expiredHistoryKeys(state, ROME_NOON_DEC_31)).toEqual(["old"]);
    expect(prunedState(state, defaultConfig(), ROME_NOON_DEC_31).historyDays).toEqual({ edge: "2026-12-01", fresh: "2026-12-30" });
  });
});

describe("prunedState", () => {
  it("drops the state of deleted hunts and of showings that have started", () => {
    const config = defaultConfig();
    const hunt = createHunt({ name: "Dune", theatres: ["t"], movie: { kind: "slug", slugs: ["m"] } }, config.settings, () => 0.5);
    config.hunts = [hunt];
    const state: State = {
      ...emptyState(),
      hunts: {
        [hunt.id]: {
          ...emptyHuntState(),
          showings: { past: known("past", "2026-12-31T11:59:00"), now: known("now", "2026-12-31T12:00:00"), later: known("later", "2026-12-31T12:01:00") },
        },
        gone0000: emptyHuntState(),
      },
    };

    const next = prunedState(state, config, ROME_NOON_DEC_31);

    expect(Object.keys(next.hunts)).toEqual([hunt.id]);
    expect(Object.keys(next.hunts[hunt.id]?.showings ?? {})).toEqual(["later"]);
  });
});

describe("version check", () => {
  it("checks the first time and then once every 24 hours", () => {
    expect(versionCheckDue(emptyState(), 0)).toBe(true);
    expect(versionCheckDue({ ...emptyState(), lastVersionCheckAt: 1000 }, 1000 + VERSION_CHECK_MS - 1)).toBe(false);
    expect(versionCheckDue({ ...emptyState(), lastVersionCheckAt: 1000 }, 1000 + VERSION_CHECK_MS)).toBe(true);
  });

  it("reads the tag of the latest release and ignores anything else", () => {
    expect(releaseTag({ tag_name: "v2026.10.2" })).toBe("v2026.10.2");
    expect(releaseTag({ tag_name: 3 })).toBeNull();
    expect(releaseTag({})).toBeNull();
    expect(releaseTag(null)).toBeNull();
    expect(releaseTag("v2026.10.2")).toBeNull();
  });
});

describe("round log", () => {
  const a = snapshot("1-10", "2026-12-15T20:30:00");
  const b = snapshot("1-11", "2026-12-16T21:00:00");

  it("keys and describes each event with the formatted day", () => {
    const moved: HuntEvent = { kind: "moved", from: a, to: b };
    const appeared: HuntEvent = { kind: "movieAppeared", movie: { slug: "m", title: "Dune", poster: null }, theatreSlug: "t" };
    const created: HuntEvent = { kind: "newShowing", showing: a };

    expect([eventKey(moved), eventKey(appeared), eventKey(created)]).toEqual(["1-11", null, "1-10"]);
    expect([eventDetail(moved), eventDetail(appeared), eventDetail(created)]).toEqual(["mar 15/12 20:30 → mer 16/12 21:00", "Dune", "mar 15/12 20:30"]);
  });

  it("writes the round, its events, changed halls, new seat types and redacted Telegram errors", () => {
    const hunt = createHunt({ name: "Dune", theatres: ["t"], movie: { kind: "slug", slugs: ["m"] } }, defaultConfig().settings, () => 0.5);
    const observation: HuntObservation = {
      round: { now: new Date(0), showings: [], daysWithShowings: [], daysChecked: [], allKeys: [], moviesSeen: [] },
      details: new Map(),
      errors: [],
      hallChanged: [{ showingKey: "1-10", hallKey: "1-2" }],
      unknownSeatTypes: [],
    };

    const entries = roundEntries({
      hunt,
      observation,
      events: [{ kind: "newShowing", showing: a }],
      at: 7,
      deliveryErrors: ["network error with SECRET inside"],
      newSeatTypes: ["COMFORT"],
      secrets: ["SECRET"],
    });

    expect(entries.map((entry) => [entry.t, entry.huntId, entry.kind, entry.key])).toEqual([
      [7, hunt.id, "round", null],
      [7, hunt.id, "newShowing", "1-10"],
      [7, hunt.id, "hallChanged", "1-10"],
      [7, hunt.id, "unknownSeatType", null],
      [7, hunt.id, "telegramError", null],
    ]);
    expect(entries[0]?.detail).toBe("0");
    expect(entries[3]?.detail).toBe("COMFORT");
    expect(entries[4]?.detail).not.toContain("SECRET");
  });

  it("logs the first error instead of the count when the round had errors", () => {
    const hunt = createHunt({ name: "Dune", theatres: ["t"], movie: { kind: "slug", slugs: ["m"] } }, defaultConfig().settings, () => 0.5);
    const observation: HuntObservation = {
      round: { now: new Date(0), showings: [], daysWithShowings: [], daysChecked: [], allKeys: [], moviesSeen: [] },
      details: new Map(),
      errors: ["UCI: risposta 500", "altro"],
      hallChanged: [],
      unknownSeatTypes: [],
    };

    const [first] = roundEntries({ hunt, observation, events: [], at: 1, deliveryErrors: [], newSeatTypes: [], secrets: [] });

    expect(first).toEqual({ t: 1, huntId: hunt.id, kind: "error", key: null, detail: "UCI: risposta 500" });
  });
});
