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

export function emptyHuntState(): HuntState {
  return {
    initialized: false,
    showings: {},
    seenMovieSlugs: [],
    pendingMovieSlugs: [],
    mutedUntil: null,
    nextRunAt: null,
    lastRun: null,
    failures: 0,
    manualRunAt: null,
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

function snapshotOf(observed: ObservedShowing): ShowingSnapshot {
  const { showing, performance, analysis } = observed;
  return {
    key: showing.key,
    localId: showing.localId,
    eventId: showing.eventId,
    performanceId: showing.performanceId,
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
    screenId: performance?.screenId ?? null,
    screenName: performance?.screenName ?? null,
    priceFrom: performance?.priceFrom ?? null,
    seats: analysis ? seatSummary(analysis) : null,
  };
}

function freshState(observed: ObservedShowing, now: number, hunt: Hunt): ShowingState {
  return {
    ...snapshotOf(observed),
    firstSeenAt: now,
    lastSeenAt: now,
    missingRounds: 0,
    zoneSignature: observed.zoneSignature,
    okNotifiedAt: null,
    belowThreshold: observed.analysis !== null && observed.analysis.freeInZone < hunt.lastSeatsThreshold,
  };
}

export const SEATS_FREED_COOLDOWN_MS = 30 * 60_000;
export const LAST_SEATS_REARM = 3;

function coolingDown(known: ShowingState, now: number): boolean {
  return known.okNotifiedAt !== null && now - known.okNotifiedAt < SEATS_FREED_COOLDOWN_MS;
}

function holdNotOk(state: ShowingState): ShowingState {
  return state.seats ? { ...state, seats: { ...state.seats, ok: false } } : state;
}

function refreshed(known: ShowingState, observed: ObservedShowing, now: number): ShowingState {
  const snapshot = snapshotOf(observed);
  return {
    ...known,
    ...snapshot,
    screenId: snapshot.screenId ?? known.screenId,
    screenName: snapshot.screenName ?? known.screenName,
    priceFrom: snapshot.priceFrom ?? known.priceFrom,
    seats: snapshot.seats ?? known.seats,
    zoneSignature: observed.zoneSignature ?? known.zoneSignature,
    lastSeenAt: now,
    missingRounds: 0,
  };
}

export function diffRound(previous: HuntState, observation: RoundObservation, hunt: Hunt): RoundResult {
  const now = observation.now.getTime();
  const showings: Record<string, ShowingState> = { ...previous.showings };
  const events: HuntEvent[] = [];
  const moves: HuntEvent[] = [];
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
      } else {
        events.push({ kind: "newShowing", showing: snapshotOf(observed) });
      }
      continue;
    }
    let next = refreshed(known, observed, now);
    const firstMap = known.seats === null;
    const sameZone = firstMap || observed.zoneSignature === known.zoneSignature;
    if (sameZone && known.seats?.ok !== true && observed.analysis?.ok === true) {
      if (coolingDown(known, now)) {
        next = holdNotOk(next);
      } else {
        events.push({ kind: "seatsFreed", showing: snapshotOf(observed), groups: observed.analysis.groups });
        next = { ...next, okNotifiedAt: now };
      }
    }
    if (observed.analysis && firstMap) {
      next = { ...next, belowThreshold: observed.analysis.freeInZone < hunt.lastSeatsThreshold };
    } else if (observed.analysis) {
      const freeInZone = observed.analysis.freeInZone;
      if (!known.belowThreshold && freeInZone < hunt.lastSeatsThreshold) {
        events.push({ kind: "lastSeats", showing: snapshotOf(observed), freeInZone });
        next = { ...next, belowThreshold: true };
      } else if (known.belowThreshold && freeInZone >= hunt.lastSeatsThreshold + LAST_SEATS_REARM) {
        next = { ...next, belowThreshold: false };
      }
    }
    showings[known.key] = next;
  }
  events.push(...moves, ...settleMissing(showings, observation));
  const movies = appearedMovies(previous, observation, hunt);
  events.push(...movies.events);
  return {
    state: { ...previous, initialized: true, showings, seenMovieSlugs: movies.seen, pendingMovieSlugs: movies.pending },
    events,
  };
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

export const MISSING_ROUNDS_TO_CANCEL = 2;

function nowLocalOf(observation: RoundObservation): string {
  const rome = romeNow(observation.now);
  return `${rome.day}T${rome.time}`;
}

function isMissing(known: ShowingState, seen: Set<string>, read: Set<string>): boolean {
  return !seen.has(known.key) && read.has(`${known.theatreSlug}|${known.day}`);
}

function readDays(observation: RoundObservation): Set<string> {
  return new Set(observation.daysRead.map(({ theatreSlug, day }) => `${theatreSlug}|${day}`));
}

function seenKeys(observation: RoundObservation): Set<string> {
  return new Set(observation.showings.map((observed) => observed.showing.key));
}

function vanishedShowings(showings: Record<string, ShowingState>, observation: RoundObservation): ShowingState[] {
  const seen = seenKeys(observation);
  const read = readDays(observation);
  const nowLocal = nowLocalOf(observation);
  return Object.values(showings)
    .filter((known) => isMissing(known, seen, read) && known.startsAt.slice(0, 16) > nowLocal)
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
  const seen = seenKeys(observation);
  const read = readDays(observation);
  const nowLocal = nowLocalOf(observation);
  const events: HuntEvent[] = [];
  for (const known of Object.values(showings)) {
    if (!isMissing(known, seen, read)) continue;
    if (known.startsAt.slice(0, 16) <= nowLocal) {
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

function snapshotFromState(state: ShowingState): ShowingSnapshot {
  const { firstSeenAt, lastSeenAt, missingRounds, zoneSignature, okNotifiedAt, belowThreshold, ...snapshot } = state;
  return snapshot;
}
