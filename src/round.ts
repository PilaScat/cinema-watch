import type {
  Hunt,
  HuntEvent,
  HuntState,
  ObservedShowing,
  RoundObservation,
  RoundResult,
  SeatSummary,
  ShowingSnapshot,
  ShowingState,
} from "./model.js";
import { romeNow } from "./dates.js";
import type { SeatAnalysis } from "./types.js";

export const SEATS_FREED_COOLDOWN_MS = 30 * 60_000;
export const LAST_SEATS_REARM = 3;
export const MISSING_ROUNDS_TO_CANCEL = 2;

export function emptyHuntState(): HuntState {
  return {
    initialized: false,
    showings: {},
    seenMovieSlugs: [],
    pendingMovieSlugs: [],
    mutedUntil: null,
    nextRunAt: null,
    lastRun: null,
    daysSeen: [],
    manualRunAt: null,
    errorNotifiedDay: null,
    hallsToReconfirm: [],
  };
}

function seatSummary(analysis: SeatAnalysis): SeatSummary {
  return {
    free: analysis.free,
    sellable: analysis.sellable,
    freeInZone: analysis.freeInZone,
    sellableInZone: analysis.sellableInZone,
    ok: analysis.ok,
    best: analysis.best,
  };
}

export function snapshotOf(observed: ObservedShowing): ShowingSnapshot {
  const { showing, performance, analysis } = observed;
  return {
    key: showing.key,
    theatreSlug: showing.theatreSlug,
    movieSlug: showing.movie.slug,
    movieTitle: showing.movie.title,
    format: showing.format,
    formatGroup: showing.formatGroup,
    language: showing.language,
    day: showing.day,
    startsAt: showing.startsAt,
    time: showing.time,
    room: showing.room,
    cartUrl: showing.cartUrl,
    hallKey: performance?.hallKey ?? null,
    screenName: performance?.screenName ?? null,
    priceFrom: performance?.priceFrom ?? null,
    seats: analysis ? seatSummary(analysis) : null,
  };
}

function snapshotFromState(state: ShowingState): ShowingSnapshot {
  const { firstSeenAt, lastSeenAt, missingRounds, zoneSignature, okNotifiedAt, okBaseline, belowThreshold, ...snapshot } = state;
  return snapshot;
}

function freshState(observed: ObservedShowing, now: number, hunt: Hunt): ShowingState {
  const analysis = observed.analysis;
  return {
    ...snapshotOf(observed),
    firstSeenAt: now,
    lastSeenAt: now,
    missingRounds: 0,
    zoneSignature: observed.zoneSignature,
    okNotifiedAt: null,
    okBaseline: analysis ? analysis.ok : null,
    belowThreshold: analysis !== null && analysis.freeInZone < hunt.lastSeatsThreshold,
  };
}

function refreshed(known: ShowingState, observed: ObservedShowing, now: number): ShowingState {
  const snapshot = snapshotOf(observed);
  return {
    ...known,
    ...snapshot,
    hallKey: snapshot.hallKey ?? known.hallKey,
    screenName: snapshot.screenName ?? known.screenName,
    priceFrom: snapshot.priceFrom ?? known.priceFrom,
    seats: snapshot.seats ?? known.seats,
    zoneSignature: observed.zoneSignature ?? known.zoneSignature,
    lastSeenAt: now,
    missingRounds: 0,
  };
}

function coolingDown(known: ShowingState, now: number): boolean {
  return known.okNotifiedAt !== null && now - known.okNotifiedAt < SEATS_FREED_COOLDOWN_MS;
}

function dayKey(theatreSlug: string, day: string): string {
  return `${theatreSlug}|${day}`;
}

function nowLocalOf(observation: RoundObservation): string {
  const rome = romeNow(observation.now);
  return `${rome.day}T${rome.time}`;
}

function relocated(known: ShowingState, observed: ObservedShowing): boolean {
  const { showing } = observed;
  return known.startsAt !== showing.startsAt || known.room !== showing.room;
}

interface SeatOutcome {
  next: ShowingState;
  events: HuntEvent[];
}

function seatChanges(known: ShowingState, observed: ObservedShowing, next: ShowingState, hunt: Hunt, now: number): SeatOutcome {
  const analysis = observed.analysis;
  if (!analysis) return { next, events: [] };
  const threshold = hunt.lastSeatsThreshold;
  const zoneChanged = known.zoneSignature !== null && observed.zoneSignature !== known.zoneSignature;
  if (zoneChanged) {
    return { next: { ...next, okBaseline: analysis.ok, belowThreshold: analysis.freeInZone < threshold }, events: [] };
  }
  const events: HuntEvent[] = [];
  let updated: ShowingState = { ...next, okBaseline: analysis.ok };
  if (known.okBaseline !== true && analysis.ok) {
    if (coolingDown(known, now)) {
      updated = { ...updated, okBaseline: false };
    } else {
      events.push({ kind: "seatsFreed", showing: snapshotOf(observed), groups: analysis.groups });
      updated = { ...updated, okNotifiedAt: now };
    }
  }
  if (known.okBaseline === null) return { next: { ...updated, belowThreshold: analysis.freeInZone < threshold }, events };
  if (!known.belowThreshold && analysis.freeInZone < threshold) {
    events.push({ kind: "lastSeats", showing: snapshotOf(observed), freeInZone: analysis.freeInZone });
    updated = { ...updated, belowThreshold: true };
  } else if (known.belowThreshold && analysis.freeInZone >= threshold + LAST_SEATS_REARM) {
    updated = { ...updated, belowThreshold: false };
  }
  return { next: updated, events };
}

function vanishedShowings(showings: Record<string, ShowingState>, observation: RoundObservation): ShowingState[] {
  const seen = new Set(observation.showings.map((observed) => observed.showing.key));
  const present = new Set(observation.allKeys);
  const read = new Set(observation.daysWithShowings.map(({ theatreSlug, day }) => dayKey(theatreSlug, day)));
  const nowLocal = nowLocalOf(observation);
  return Object.values(showings)
    .filter(
      (known) =>
        !seen.has(known.key) &&
        !present.has(known.key) &&
        read.has(dayKey(known.theatreSlug, known.day)) &&
        known.startsAt.slice(0, 16) > nowLocal,
    )
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

function takeMatch(candidates: ShowingState[], observed: ObservedShowing): ShowingState | null {
  const { showing } = observed;
  const index = candidates.findIndex(
    (known) =>
      known.theatreSlug === showing.theatreSlug &&
      known.day === showing.day &&
      known.movieSlug === showing.movie.slug &&
      known.room === showing.room,
  );
  if (index < 0) return null;
  const [match] = candidates.splice(index, 1);
  return match ?? null;
}

function settleMissing(showings: Record<string, ShowingState>, observation: RoundObservation): HuntEvent[] {
  const seen = new Set(observation.showings.map((observed) => observed.showing.key));
  const present = new Set(observation.allKeys);
  const read = new Set(observation.daysWithShowings.map(({ theatreSlug, day }) => dayKey(theatreSlug, day)));
  const nowLocal = nowLocalOf(observation);
  const events: HuntEvent[] = [];
  for (const known of Object.values(showings)) {
    if (seen.has(known.key) || !read.has(dayKey(known.theatreSlug, known.day))) continue;
    if (present.has(known.key) || known.startsAt.slice(0, 16) <= nowLocal) {
      delete showings[known.key];
      continue;
    }
    const missingRounds = known.missingRounds + 1;
    if (missingRounds >= MISSING_ROUNDS_TO_CANCEL) {
      events.push({ kind: "cancelled", showing: snapshotFromState(known) });
      delete showings[known.key];
    } else {
      showings[known.key] = { ...known, missingRounds };
    }
  }
  return events;
}

function appearedMovies(previous: HuntState, observation: RoundObservation, hunt: Hunt) {
  const seen = [...previous.seenMovieSlugs];
  const pending = [...previous.pendingMovieSlugs];
  const events: HuntEvent[] = [];
  if (hunt.movie.kind !== "title") return { seen, pending, events };
  const confirmed = new Set(hunt.movie.confirmedSlugs);
  for (const { movie, theatreSlug } of observation.moviesSeen) {
    if (seen.includes(movie.slug)) continue;
    seen.push(movie.slug);
    if (confirmed.has(movie.slug)) continue;
    pending.push(movie.slug);
    events.push({ kind: "movieAppeared", movie, theatreSlug });
  }
  return { seen, pending, events };
}

function seenDays(previous: HuntState, observation: RoundObservation): string[] {
  const today = romeNow(observation.now).day;
  const days = new Set(previous.daysSeen);
  for (const { theatreSlug, day } of observation.daysChecked) days.add(dayKey(theatreSlug, day));
  return [...days].filter((key) => (key.split("|")[1] ?? "") >= today).sort();
}

export function diffRound(previous: HuntState, observation: RoundObservation, hunt: Hunt): RoundResult {
  const now = observation.now.getTime();
  const showings: Record<string, ShowingState> = { ...previous.showings };
  const events: HuntEvent[] = [];
  const moves: HuntEvent[] = [];
  const knownDays = new Set(previous.daysSeen);
  const vanished = vanishedShowings(showings, observation);
  for (const observed of observation.showings) {
    const known = showings[observed.showing.key];
    if (known === undefined) {
      const state = freshState(observed, now, hunt);
      showings[state.key] = state;
      const origin = takeMatch(vanished, observed);
      if (origin) {
        delete showings[origin.key];
        moves.push({ kind: "moved", from: snapshotFromState(origin), to: snapshotOf(observed) });
      } else if (!previous.initialized || knownDays.has(dayKey(observed.showing.theatreSlug, observed.showing.day))) {
        events.push({ kind: "newShowing", showing: snapshotOf(observed) });
      }
      continue;
    }
    if (relocated(known, observed)) moves.push({ kind: "moved", from: snapshotFromState(known), to: snapshotOf(observed) });
    const outcome = seatChanges(known, observed, refreshed(known, observed, now), hunt, now);
    events.push(...outcome.events);
    showings[known.key] = outcome.next;
  }
  events.push(...moves, ...settleMissing(showings, observation));
  const movies = appearedMovies(previous, observation, hunt);
  events.push(...movies.events);
  return {
    state: {
      ...previous,
      initialized: true,
      showings,
      daysSeen: seenDays(previous, observation),
      seenMovieSlugs: movies.seen,
      pendingMovieSlugs: movies.pending,
    },
    events,
  };
}
