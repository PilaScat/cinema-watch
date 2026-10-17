import { describe, expect, it } from "vitest";
import { createHunt, defaultConfig } from "../src/config.js";
import type { Config, Hunt, HuntEvent, HuntState, ShowingSnapshot, State } from "../src/model.js";
import { emptyHuntState } from "../src/round.js";
import type { HuntObservation } from "../src/runner.js";
import { emptyState } from "../src/state.js";
import {
  deliveryOf,
  digestDue,
  digestEntries,
  errorWarningDue,
  eventAllowed,
  finishedHuntIds,
  hallsToReconfirm,
  isActive,
  isDue,
  isMuted,
  isQuiet,
  MANUAL_REFRESH_MS,
  nextRunAt,
  refreshedRecently,
  urlButtonsAccepted,
} from "../src/watcher-rules.js";

const MINUTE = 60_000;
const ROME_NOON_DEC_1 = Date.parse("2026-12-01T11:00:00Z");

function config(mutate: (draft: Config) => void = () => undefined): Config {
  const draft = defaultConfig();
  mutate(draft);
  return draft;
}

function hunt(overrides: Partial<Hunt> = {}): Hunt {
  return {
    ...createHunt({ name: "Dune", theatres: ["uci-cinemas-verona"], movie: { kind: "slug", slugs: ["dune-parte-tre"] } }, defaultConfig().settings, () => 0.5),
    ...overrides,
  };
}

function huntState(overrides: Partial<HuntState> = {}): HuntState {
  return { ...emptyHuntState(), ...overrides };
}

function stateWith(id: string, overrides: Partial<HuntState> = {}, extra: Partial<State> = {}): State {
  return { ...emptyState(), hunts: { [id]: huntState(overrides) }, ...extra };
}

function showing(key: string): ShowingSnapshot {
  return {
    key,
    localId: 1,
    eventId: 1,
    performanceId: 1,
    theatreSlug: "t",
    movieSlug: "m",
    movieTitle: "M",
    format: "IMAX",
    formatGroup: "IMAX",
    language: null,
    day: "2026-12-15",
    startsAt: "2026-12-15T20:30:00",
    time: "20:30",
    room: "Sala",
    cartUrl: "https://ucicinemas.it/x",
    screenId: 2,
    screenName: "Sala",
    priceFrom: null,
    seats: null,
  };
}

describe("isActive and isMuted", () => {
  it("needs a hunt enabled and not archived", () => {
    expect(isActive(hunt())).toBe(true);
    expect(isActive(hunt({ enabled: false }))).toBe(false);
    expect(isActive(hunt({ archivedAt: "2026-12-01T00:00:00.000Z" }))).toBe(false);
  });

  it("is muted only strictly before the end of the mute", () => {
    expect(isMuted(huntState({ mutedUntil: null }), 100)).toBe(false);
    expect(isMuted(huntState({ mutedUntil: 101 }), 100)).toBe(true);
    expect(isMuted(huntState({ mutedUntil: 100 }), 100)).toBe(false);
  });
});

describe("eventAllowed", () => {
  const all = hunt();
  const none = hunt({
    notify: { newShowings: false, seatsFreed: false, lastSeats: false, cancelled: false, moved: false, movieAppeared: false, digest: false },
  });
  const events: HuntEvent[] = [
    { kind: "newShowing", showing: showing("a") },
    { kind: "seatsFreed", showing: showing("a"), groups: [] },
    { kind: "lastSeats", showing: showing("a"), freeInZone: 1 },
    { kind: "cancelled", showing: showing("a") },
    { kind: "moved", from: showing("a"), to: showing("b") },
    { kind: "movieAppeared", movie: { slug: "m", title: "M", poster: null }, theatreSlug: "t" },
  ];

  it("follows the switch of each kind", () => {
    expect(events.map((event) => eventAllowed(event, all))).toEqual([true, true, true, true, true, true]);
    expect(events.map((event) => eventAllowed(event, none))).toEqual([false, false, false, false, false, false]);
  });

  it("reads each kind from its own switch", () => {
    const flags = ["newShowings", "seatsFreed", "lastSeats", "cancelled", "moved", "movieAppeared"] as const;
    flags.forEach((flag, index) => {
      const only = hunt({ notify: { ...none.notify, [flag]: true } });
      expect(events.map((event) => eventAllowed(event, only))).toEqual(events.map((_, position) => position === index));
    });
  });
});

describe("nextRunAt", () => {
  it("adds the interval of the hunt or the default one, plus up to 10% of jitter", () => {
    const settings = config().settings;
    const own = hunt({ intervalMinutes: 10 });
    const fallback = hunt({ intervalMinutes: null });

    expect(nextRunAt(own, settings, 1000, 0)).toBe(1000 + 10 * MINUTE);
    expect(nextRunAt(own, settings, 1000, 1)).toBe(1000 + 11 * MINUTE);
    expect(nextRunAt(own, settings, 1000, 0.5)).toBe(1000 + Math.round(10.5 * MINUTE));
    expect(nextRunAt(fallback, settings, 0, 0)).toBe(settings.defaultIntervalMinutes * MINUTE);
  });
});

describe("isQuiet", () => {
  it("is false without quiet hours", () => {
    expect(isQuiet(config().settings, ROME_NOON_DEC_1)).toBe(false);
  });

  it("uses the Rome time, also across midnight", () => {
    const night = config((draft) => {
      draft.settings.quietHours = { from: "23:00", to: "07:59" };
    }).settings;
    expect(isQuiet(night, Date.parse("2026-12-01T22:30:00Z"))).toBe(true);
    expect(isQuiet(night, Date.parse("2026-12-01T21:59:00Z"))).toBe(false);
    expect(isQuiet(night, Date.parse("2026-12-02T06:59:00Z"))).toBe(true);
    expect(isQuiet(night, Date.parse("2026-12-02T07:00:00Z"))).toBe(false);
  });
});

describe("isDue", () => {
  const id = hunt().id;

  it("is due when never run or when the next run time has come", () => {
    expect(isDue(hunt(), emptyState(), 0)).toBe(true);
    expect(isDue(hunt(), stateWith(id, { nextRunAt: 100 }), 100)).toBe(true);
    expect(isDue(hunt(), stateWith(id, { nextRunAt: 101 }), 100)).toBe(false);
  });

  it("is never due for an inactive hunt", () => {
    expect(isDue(hunt({ enabled: false }), emptyState(), 0)).toBe(false);
  });
});

describe("refreshedRecently", () => {
  it("blocks a manual refresh for 30 seconds", () => {
    expect(refreshedRecently(huntState({ manualRunAt: null }), 0)).toBe(false);
    expect(refreshedRecently(huntState({ manualRunAt: 1000 }), 1000 + MANUAL_REFRESH_MS - 1)).toBe(true);
    expect(refreshedRecently(huntState({ manualRunAt: 1000 }), 1000 + MANUAL_REFRESH_MS)).toBe(false);
  });
});

describe("finishedHuntIds", () => {
  it("lists only active hunts with fixed dates that ended before today in Rome", () => {
    const ended = hunt({ id: "aaaaaaaa", window: { kind: "fixed", from: "2026-11-01", to: "2026-11-30" } });
    const today = hunt({ id: "bbbbbbbb", window: { kind: "fixed", from: "2026-11-01", to: "2026-12-01" } });
    const rolling = hunt({ id: "cccccccc", window: { kind: "next", days: 3 } });
    const archived = hunt({ id: "dddddddd", window: { kind: "fixed", from: "2026-11-01", to: "2026-11-02" }, archivedAt: "2026-11-03T00:00:00.000Z" });
    const cfg = config((draft) => {
      draft.hunts = [ended, today, rolling, archived];
    });

    expect(finishedHuntIds(cfg, ROME_NOON_DEC_1)).toEqual(["aaaaaaaa"]);
  });
});

describe("hallsToReconfirm", () => {
  function observation(changed: Array<{ showingKey: string; hallKey: string }>): HuntObservation {
    return { round: { now: new Date(0), showings: [], daysWithShowings: [], daysChecked: [], allKeys: [], moviesSeen: [] }, details: new Map(), errors: [], hallChanged: changed, unknownSeatTypes: [] };
  }

  it("adds only the changed halls that have their own zone, keeping the earlier ones sorted and once", () => {
    const zoned = hunt({ hallZones: { "1-2": { kind: "absolute", rows: ["F"], seatFrom: null, seatTo: null }, "1-9": { kind: "absolute", rows: ["A"], seatFrom: null, seatTo: null } } });
    const previous = huntState({ hallsToReconfirm: ["1-9"] });

    const result = hallsToReconfirm(zoned, previous, observation([{ showingKey: "1-100", hallKey: "1-2" }, { showingKey: "1-101", hallKey: "1-3" }, { showingKey: "1-102", hallKey: "1-9" }]));

    expect(result).toEqual(["1-2", "1-9"]);
  });
});

describe("urlButtonsAccepted", () => {
  it("trusts the last check for the same URL, otherwise only https", () => {
    expect(urlButtonsAccepted(null, null)).toBe(false);
    expect(urlButtonsAccepted("https://a.example", null)).toBe(true);
    expect(urlButtonsAccepted("http://192.168.1.20:8790", null)).toBe(false);
    expect(urlButtonsAccepted("https://a.example", { url: "https://a.example", accepted: false })).toBe(false);
    expect(urlButtonsAccepted("http://b.example", { url: "http://b.example", accepted: true })).toBe(true);
    expect(urlButtonsAccepted("https://a.example", { url: "https://other.example", accepted: false })).toBe(true);
  });
});

describe("deliveryOf", () => {
  const ok = { ok: true, messageIds: [1], error: null };
  const failed = (error: string | null) => ({ ok: false, messageIds: [], error });

  it("is delivered when only extra chats failed, and keeps every error", () => {
    expect(deliveryOf(["p", "x"], [ok, failed("chat not found")], "p", "?")).toEqual({ delivered: true, errors: ["chat not found"] });
  });

  it("is not delivered when the primary chat failed, and names unknown errors", () => {
    expect(deliveryOf(["p", "x"], [failed(null), ok], "p", "sconosciuto")).toEqual({ delivered: false, errors: ["sconosciuto"] });
  });

  it("is delivered with no failures", () => {
    expect(deliveryOf(["p"], [ok], "p", "?")).toEqual({ delivered: true, errors: [] });
  });
});

describe("errorWarningDue", () => {
  const at = ROME_NOON_DEC_1;

  it("warns once a Rome day, only with errors, a chat and no mute", () => {
    expect(errorWarningDue(huntState(), ["x"], at, "p")).toBe(true);
    expect(errorWarningDue(huntState(), [], at, "p")).toBe(false);
    expect(errorWarningDue(huntState(), ["x"], at, null)).toBe(false);
    expect(errorWarningDue(huntState({ mutedUntil: at + 1 }), ["x"], at, "p")).toBe(false);
    expect(errorWarningDue(huntState({ errorNotifiedDay: "2026-12-01" }), ["x"], at, "p")).toBe(false);
    expect(errorWarningDue(huntState({ errorNotifiedDay: "2026-11-30" }), ["x"], at, "p")).toBe(true);
  });
});

describe("digestEntries", () => {
  it("lists the active hunts, only those with the digest when asked, with their showings and mute", () => {
    const withDigest = hunt({ id: "aaaaaaaa" });
    const withoutDigest = hunt({ id: "bbbbbbbb", notify: { ...hunt().notify, digest: false } });
    const off = hunt({ id: "cccccccc", enabled: false });
    const cfg = config((draft) => {
      draft.hunts = [withDigest, withoutDigest, off];
    });
    const state = { ...emptyState(), hunts: { aaaaaaaa: huntState({ mutedUntil: 5, showings: { k: { ...showing("k"), firstSeenAt: 0, lastSeenAt: 0, missingRounds: 0, zoneSignature: null, okNotifiedAt: null, okBaseline: null, belowThreshold: false } } }) } };

    const digest = digestEntries(cfg, state, true);
    const all = digestEntries(cfg, state, false);

    expect(digest.map((entry) => [entry.hunt.id, entry.showings.length, entry.mutedUntil])).toEqual([["aaaaaaaa", 1, 5]]);
    expect(all.map((entry) => entry.hunt.id)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
    expect(all[1]?.mutedUntil).toBeNull();
  });
});

describe("digestDue", () => {
  const cfg = config((draft) => {
    draft.settings.digest = { enabled: true, time: "20:00" };
  });
  const evening = Date.parse("2026-12-01T19:00:00Z");
  const telegram = { chatId: "p", canSend: true };

  it("is due from the digest time, once a Rome day", () => {
    expect(digestDue(cfg, emptyState(), evening, telegram)).toBe(true);
    expect(digestDue(cfg, emptyState(), evening - 1, telegram)).toBe(false);
    expect(digestDue(cfg, { ...emptyState(), lastDigestDate: "2026-12-01" }, evening, telegram)).toBe(false);
    expect(digestDue(cfg, { ...emptyState(), lastDigestDate: "2026-11-30" }, evening, telegram)).toBe(true);
  });

  it("is never due when disabled, without a chat or when Telegram cannot send", () => {
    const disabled = config((draft) => {
      draft.settings.digest = { enabled: false, time: "20:00" };
    });
    expect(digestDue(disabled, emptyState(), evening, telegram)).toBe(false);
    expect(digestDue(cfg, emptyState(), evening, { chatId: null, canSend: true })).toBe(false);
    expect(digestDue(cfg, emptyState(), evening, { chatId: "p", canSend: false })).toBe(false);
  });
});
