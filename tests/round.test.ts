import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Hunt, HuntState, ObservedShowing, RoundObservation } from "../src/model.js";
import { diffRound, emptyHuntState } from "../src/round.js";
import type { SeatAnalysis, SeatGroup, Showing } from "../src/types.js";

const MINUTE = 60_000;
const t0 = new Date("2026-12-01T10:00:00Z");

function at(minutes: number): Date {
  return new Date(t0.getTime() + minutes * MINUTE);
}

const hunt: Hunt = {
  id: "dune0001",
  name: "Dune IMAX Verona",
  enabled: true,
  archivedAt: null,
  theatres: ["uci-cinemas-verona"],
  movie: { kind: "slug", slugs: ["dune-parte-tre"] },
  formats: ["IMAX"],
  window: { kind: "fixed", from: "2026-12-15", to: "2026-12-31" },
  timeFrom: null,
  timeTo: null,
  weekdays: null,
  dayTimes: {},
  languages: null,
  zone: { kind: "absolute", rows: ["F", "G", "H", "J", "K", "L"], seatFrom: 5, seatTo: 16 },
  hallZones: {},
  together: 3,
  intervalMinutes: null,
  lastSeatsThreshold: 10,
  notify: { newShowings: true, seatsFreed: true, lastSeats: true, cancelled: true, moved: true, movieAppeared: true, digest: true },
  extraChatIds: [],
};

function showing(performanceId: number, overrides: Partial<Showing> = {}): Showing {
  return {
    key: `5116-${performanceId}`,
    theatreSlug: "uci-cinemas-verona",
    movie: { slug: "dune-parte-tre", title: "Dune: Parte Tre", poster: null },
    format: "IMAX",
    formatGroup: "IMAX",
    language: "ITA",
    day: "2026-12-16",
    startsAt: "2026-12-16T20:30:00",
    time: "20:30",
    room: "SALA 1 IMAX",
    durationMinutes: 140,
    cartUrl: `https://ucicinemas.it/movies/dune-parte-tre/acquista/5116/9803/${performanceId}`,
    ...overrides,
  };
}

function group(rowLabel: string, numbers: number[], score: number): SeatGroup {
  return { rowLabel, seatIds: numbers.map((n) => `${rowLabel}/${n}`), score };
}

function analysis(freeInZone: number, best: SeatGroup[] = []): SeatAnalysis {
  const groups = freeInZone >= 3 ? best : [];
  return {
    sellable: 228,
    free: freeInZone + 20,
    taken: 208 - freeInZone,
    freeInZone,
    sellableInZone: 72,
    rows: [],
    zoneSeatIds: [],
    groups,
    best,
    ok: groups.length > 0,
    unknownTypes: [],
    unknownTakenIds: [],
  };
}

function observed(show: Showing, seats: SeatAnalysis | null, zoneSignature = "zone-a"): ObservedShowing {
  return {
    showing: show,
    performance: seats
      ? { key: show.key, hallKey: "5116-2", eventRef: "9803", screenName: show.room, startTime: show.startsAt, title: show.movie.title, priceFrom: 14.9 }
      : null,
    analysis: seats,
    zoneSignature: seats ? zoneSignature : null,
  };
}

function round(now: Date, showings: ObservedShowing[], days = ["2026-12-16"], otherKeys: string[] = []): RoundObservation {
  return {
    now,
    showings,
    daysWithShowings: days.map((day) => ({ theatreSlug: "uci-cinemas-verona", day })),
    daysChecked: days.map((day) => ({ theatreSlug: "uci-cinemas-verona", day })),
    allKeys: [...showings.map((item) => item.showing.key), ...otherKeys],
    moviesSeen: [],
  };
}

function run(previous: HuntState, observation: RoundObservation) {
  return diffRound(previous, observation, hunt);
}

describe("diffRound", () => {
  it("reports a showing seen for the first time as new", () => {
    const result = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0))]));

    expect(result.events.map((event) => [event.kind, "showing" in event ? event.showing.key : null])).toEqual([
      ["newShowing", "5116-600001"],
    ]);
  });

  it("stays quiet on a known showing and keeps its latest seats", () => {
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0))]));
    const second = run(first.state, round(at(5), [observed(showing(600001), analysis(2))]));

    expect(second.events).toEqual([]);
    expect(second.state.showings["5116-600001"]?.seats?.freeInZone).toBe(2);
    expect(second.state.showings["5116-600001"]?.lastSeenAt).toBe(at(5).getTime());
  });

  it("reports seats freed when the good zone gets enough seats together", () => {
    const freed = group("H", [9, 10, 11], 0.97);
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0))]));
    const second = run(first.state, round(at(5), [observed(showing(600001), analysis(3, [freed]))]));

    expect(second.events).toEqual([
      expect.objectContaining({ kind: "seatsFreed", groups: [freed], showing: expect.objectContaining({ key: "5116-600001" }) }),
    ]);
  });

  it("waits 30 minutes after an alert before reporting the same showing freed again", () => {
    const freed = group("H", [9, 10, 11], 0.97);
    const kinds: string[][] = [];
    let state = emptyHuntState();
    const steps: Array<[number, number]> = [[0, 0], [5, 3], [10, 0], [20, 3], [34, 3], [36, 3]];
    for (const [minute, free] of steps) {
      const result = run(state, round(at(minute), [observed(showing(600001), analysis(free, [freed]))]));
      kinds.push(result.events.map((event) => event.kind));
      state = result.state;
    }

    expect(kinds).toEqual([["newShowing"], ["seatsFreed"], [], [], [], ["seatsFreed"]]);
  });

  it("does not report seats freed when only the good zone changed", () => {
    const freed = group("C", [1, 2, 3], 0.4);
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0), "zone-a")]));
    const second = run(first.state, round(at(5), [observed(showing(600001), analysis(3, [freed]), "zone-b")]));
    const third = run(second.state, round(at(10), [observed(showing(600001), analysis(3, [freed]), "zone-b")]));

    expect([second.events, third.events]).toEqual([[], []]);
    expect(third.state.showings["5116-600001"]?.zoneSignature).toBe("zone-b");
  });

  it("reports last seats once when the good zone drops under the threshold, and again only after it recovers", () => {
    const series = [15, 8, 7, 12, 13, 9, 0];
    const events: Array<Array<[string, number | null]>> = [];
    let state = emptyHuntState();
    series.forEach((free, index) => {
      const result = run(state, round(at(index * 5), [observed(showing(600001), analysis(free))]));
      events.push(result.events.map((event) => [event.kind, event.kind === "lastSeats" ? event.freeInZone : null]));
      state = result.state;
    });

    expect(events).toEqual([[["newShowing", null]], [["lastSeats", 8]], [], [], [], [["lastSeats", 9]], []]);
  });

  it("keeps the last known seats when the seat map cannot be read", () => {
    const freed = group("H", [9, 10, 11], 0.97);
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0))]));
    const blind = run(first.state, round(at(5), [observed(showing(600001), null)]));
    const back = run(blind.state, round(at(10), [observed(showing(600001), analysis(3, [freed]))]));

    expect(blind.events).toEqual([]);
    expect(blind.state.showings["5116-600001"]?.seats?.freeInZone).toBe(0);
    expect(back.events.map((event) => event.kind)).toEqual(["seatsFreed"]);
  });

  it("reports a future showing as cancelled after two rounds missing from a day read correctly", () => {
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0)), observed(showing(600002), analysis(0))]));
    const once = run(first.state, round(at(5), [observed(showing(600001), analysis(0))]));
    const twice = run(once.state, round(at(10), [observed(showing(600001), analysis(0))]));

    expect(once.events).toEqual([]);
    expect(twice.events.map((event) => [event.kind, "showing" in event ? event.showing.key : null])).toEqual([["cancelled", "5116-600002"]]);
    expect(Object.keys(twice.state.showings)).toEqual(["5116-600001"]);
  });

  it("never cancels a showing whose day could not be read", () => {
    let state = run(emptyHuntState(), round(at(0), [observed(showing(600002), analysis(0))])).state;
    const kinds: string[] = [];
    for (const minute of [5, 10, 15]) {
      const result = run(state, round(at(minute), [], []));
      kinds.push(...result.events.map((event) => event.kind));
      state = result.state;
    }

    expect(kinds).toEqual([]);
    expect(state.showings["5116-600002"]?.missingRounds).toBe(0);
  });

  it("drops a showing that has already started without reporting it", () => {
    const evening = new Date("2026-12-16T19:00:00Z");
    const first = run(emptyHuntState(), round(evening, [observed(showing(600002), analysis(0))]));
    const afterStart = run(first.state, round(new Date("2026-12-16T19:45:00Z"), []));

    expect(afterStart.events).toEqual([]);
    expect(afterStart.state.showings).toEqual({});
  });

  it("pairs a vanished showing with a new one in the same day, movie and room as moved", () => {
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600002), analysis(0))]));
    const later = showing(600003, { startsAt: "2026-12-16T21:00:00", time: "21:00" });
    const otherRoom = showing(600004, { startsAt: "2026-12-16T22:00:00", time: "22:00", room: "SALA 07 XL" });
    const second = run(first.state, round(at(5), [observed(later, analysis(0)), observed(otherRoom, analysis(0))]));

    expect(second.events.map((event) => (event.kind === "moved" ? ["moved", event.from.time, event.to.time] : [event.kind, "showing" in event ? event.showing.key : ""]))).toEqual([
      ["newShowing", "5116-600004"],
      ["moved", "20:30", "21:00"],
    ]);
    expect(Object.keys(second.state.showings).sort()).toEqual(["5116-600003", "5116-600004"]);
  });

  it("reports a movie matching a title hunt once and keeps it waiting for confirmation", () => {
    const titleHunt: Hunt = { ...hunt, movie: { kind: "title", words: ["dune"], confirmedSlugs: ["dune-parte-due"] } };
    const seen = (slugs: string[]): RoundObservation => ({
      ...round(at(0), []),
      moviesSeen: slugs.map((slug) => ({ movie: { slug, title: slug, poster: null }, theatreSlug: "uci-cinemas-verona" })),
    });
    const first = diffRound(emptyHuntState(), seen(["dune-parte-due", "dune-parte-tre"]), titleHunt);
    const second = diffRound(first.state, seen(["dune-parte-tre"]), titleHunt);

    expect(first.events).toEqual([
      { kind: "movieAppeared", movie: { slug: "dune-parte-tre", title: "dune-parte-tre", poster: null }, theatreSlug: "uci-cinemas-verona" },
    ]);
    expect(second.events).toEqual([]);
    expect(second.state.pendingMovieSlugs).toEqual(["dune-parte-tre"]);
  });

  it("reports seats freed when the seat map becomes readable with good seats", () => {
    const freed = group("H", [9, 10, 11], 0.97);
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), null)]));
    const second = run(first.state, round(at(5), [observed(showing(600001), analysis(3, [freed]))]));

    expect(second.events.map((event) => event.kind)).toEqual(["seatsFreed"]);
  });

  it("keeps showings with the same performance id in two cinemas apart", () => {
    const verona = showing(600001);
    const orio = showing(600001, { key: "5100-600001", theatreSlug: "uci-cinemas-orio-bergamo" });
    const result = run(emptyHuntState(), round(at(0), [observed(verona, analysis(0)), observed(orio, analysis(0))]));

    expect(Object.keys(result.state.showings).sort()).toEqual(["5100-600001", "5116-600001"]);
  });

  it("never repeats seats freed within 30 minutes nor last seats without a recovery in between", () => {
    const freed = group("H", [9, 10, 11], 0.97);
    const step = fc.record({ minutes: fc.integer({ min: 1, max: 20 }), free: fc.integer({ min: 0, max: 20 }), readable: fc.boolean() });
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 60 }), (steps) => {
        let state = emptyHuntState();
        let minute = 0;
        const freedAt: number[] = [];
        let lastSeatsArmed = true;
        for (const { minutes, free, readable } of steps) {
          minute += minutes;
          const result = run(state, round(at(minute), [observed(showing(600001), readable ? analysis(free, [freed]) : null)]));
          state = result.state;
          for (const event of result.events) {
            if (event.kind === "seatsFreed") freedAt.push(minute);
            if (event.kind === "lastSeats") {
              if (!lastSeatsArmed) return false;
              lastSeatsArmed = false;
            }
          }
          if (readable && free >= hunt.lastSeatsThreshold + 3) lastSeatsArmed = true;
        }
        return freedAt.every((value, index) => index === 0 || value - (freedAt[index - 1] ?? 0) >= 30);
      }),
      { numRuns: 300 },
    );
  });

  it("forgets a showing that no longer passes the filters instead of cancelling it", () => {
    let state = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0)), observed(showing(600002), analysis(0))])).state;
    const kinds: string[] = [];
    for (const minute of [5, 10, 15]) {
      const result = run(state, round(at(minute), [observed(showing(600001), analysis(0))], ["2026-12-16"], ["5116-600002"]));
      kinds.push(...result.events.map((event) => event.kind));
      state = result.state;
    }

    expect(kinds).toEqual([]);
    expect(Object.keys(state.showings)).toEqual(["5116-600001"]);
  });

  it("reports a showing whose time changed under the same key as moved", () => {
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0))]));
    const later = showing(600001, { startsAt: "2026-12-16T21:15:00", time: "21:15" });
    const second = run(first.state, round(at(5), [observed(later, analysis(0))]));

    expect(second.events.map((event) => (event.kind === "moved" ? `${event.from.time}>${event.to.time}` : event.kind))).toEqual(["20:30>21:15"]);
  });

  it("records quietly the showings of a day the hunt reads for the first time", () => {
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(0))], ["2026-12-16"]));
    const nextDay = showing(600009, { day: "2026-12-17", startsAt: "2026-12-17T20:30:00" });
    const second = run(first.state, round(at(5), [observed(showing(600001), analysis(0)), observed(nextDay, analysis(0))], ["2026-12-16", "2026-12-17"]));
    const another = showing(600010, { day: "2026-12-17", startsAt: "2026-12-17T22:30:00", time: "22:30" });
    const third = run(second.state, round(at(10), [observed(showing(600001), analysis(0)), observed(nextDay, analysis(0)), observed(another, analysis(0))], ["2026-12-16", "2026-12-17"]));

    expect(second.events).toEqual([]);
    expect(Object.keys(second.state.showings).sort()).toEqual(["5116-600001", "5116-600009"]);
    expect(third.events.map((event) => event.kind)).toEqual(["newShowing"]);
  });

  it("does not report last seats when only the good zone changed", () => {
    const first = run(emptyHuntState(), round(at(0), [observed(showing(600001), analysis(30), "zone-a")]));
    const second = run(first.state, round(at(5), [observed(showing(600001), analysis(4), "zone-b")]));

    expect(second.events).toEqual([]);
  });

  it("keeps the real seat summary while it waits to report seats freed again", () => {
    const freed = group("H", [9, 10, 11], 0.97);
    let state = emptyHuntState();
    for (const [minute, free] of [[0, 0], [5, 3], [10, 0], [20, 3]] as const) {
      state = run(state, round(at(minute), [observed(showing(600001), analysis(free, [freed]))])).state;
    }

    expect(state.showings["5116-600001"]?.seats?.ok).toBe(true);
  });

  it("ignores movies seen by a hunt that targets slugs", () => {
    const observation: RoundObservation = {
      ...round(at(0), []),
      moviesSeen: [{ movie: { slug: "dune-parte-tre", title: "Dune", poster: null }, theatreSlug: "uci-cinemas-verona" }],
    };

    expect(run(emptyHuntState(), observation).events).toEqual([]);
  });
});
