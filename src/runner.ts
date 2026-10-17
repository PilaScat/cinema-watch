import type { TtlCache } from "./cache.js";
import { copy } from "./copy.js";
import { formatDay } from "./format.js";
import { resolveWindow } from "./dates.js";
import { ApiShapeError, HttpError, WebticError } from "./errors.js";
import type { Hunt, ObservedShowing, RoundObservation, Settings } from "./model.js";
import { analyzeSeats } from "./seats.js";
import type { Hall, IsoDay, MovieRef, Occupancy, PerformanceInfo, SeatAnalysis, SeatRule, Showing, ShowingFilter, Zone } from "./types.js";
import { filterShowings, matchesTitle, type createUciClient } from "./uci.js";
import type { createWebticClient } from "./webtic.js";
import { hallKey } from "./keys.js";

type UciClient = ReturnType<typeof createUciClient>;
type WebticClient = ReturnType<typeof createWebticClient>;

export interface RunnerCaches {
  programming: TtlCache<Showing[]>;
  occupancy: TtlCache<Occupancy>;
  performance: TtlCache<PerformanceInfo>;
}

export interface RunnerDeps {
  uci: UciClient;
  webtic: WebticClient;
  caches: RunnerCaches;
}

export interface SeatDetail {
  hall: Hall;
  occupancy: Occupancy;
  analysis: SeatAnalysis;
  rule: SeatRule;
}

export interface HuntObservation {
  round: RoundObservation;
  details: Map<string, SeatDetail>;
  errors: string[];
  hallChanged: Array<{ showingKey: string; hallKey: string }>;
  unknownSeatTypes: string[];
}

const UCI_SOURCE = "UCI";
const WEBTIC_SOURCE = "Webtic";

export function zoneSignature(zone: Zone, together: number): string {
  return JSON.stringify({ zone, together });
}

export function zoneFor(hunt: Hunt, localId: number, screenId: number): Zone {
  return hunt.hallZones[hallKey(localId, screenId)] ?? hunt.zone;
}

function targetSlugs(hunt: Hunt): string[] {
  return hunt.movie.kind === "slug" ? hunt.movie.slugs : hunt.movie.confirmedSlugs;
}

function showingFilter(hunt: Hunt): ShowingFilter {
  return {
    movieSlugs: targetSlugs(hunt),
    ...(hunt.formats.length > 0 ? { formats: hunt.formats } : {}),
    window: hunt.window,
    ...(hunt.timeFrom ? { timeFrom: hunt.timeFrom } : {}),
    ...(hunt.timeTo ? { timeTo: hunt.timeTo } : {}),
    ...(hunt.weekdays ? { weekdays: hunt.weekdays } : {}),
    ...(hunt.languages ? { languages: hunt.languages } : {}),
  };
}

function reasonOf(error: unknown): string {
  const reasons = copy.errors.reasons;
  if (error instanceof HttpError) {
    if (error.kind === "status") return reasons.status(error.status ?? 0);
    return reasons[error.kind];
  }
  if (error instanceof ApiShapeError) return reasons.shape;
  if (error instanceof WebticError) return reasons.refused(error.message || String(error.reasonCode ?? ""));
  return reasons.unknown;
}

function describe(source: string, error: unknown): string {
  return copy.errors.source(source, reasonOf(error));
}

function moviesMatching(hunt: Hunt, showings: Showing[], theatreSlug: string): Array<{ movie: MovieRef; theatreSlug: string }> {
  if (hunt.movie.kind !== "title") return [];
  const words = hunt.movie.words;
  const found = new Map<string, MovieRef>();
  for (const showing of showings) {
    if (matchesTitle(showing.movie.title, words)) found.set(showing.movie.slug, showing.movie);
  }
  return [...found.values()].map((movie) => ({ movie, theatreSlug }));
}

async function readDay(deps: RunnerDeps, theatreSlug: string, day: IsoDay, fresh: boolean): Promise<Showing[]> {
  return deps.caches.programming.getOrLoad(`${theatreSlug}|${day}`, () => deps.uci.programmingDay(theatreSlug, day), {
    bypass: fresh,
  });
}

async function observeSeats(
  deps: RunnerDeps,
  hunt: Hunt,
  settings: Settings,
  showing: Showing,
  fresh: boolean,
): Promise<{ observed: ObservedShowing; detail: SeatDetail; hallChanged: boolean; hallKey: string }> {
  const performance = await deps.caches.performance.getOrLoad(showing.key, () =>
    deps.webtic.performance(showing.localId, showing.performanceId),
  );
  const occupancy = await deps.caches.occupancy.getOrLoad(
    showing.key,
    () => deps.webtic.occupancy(showing.localId, showing.performanceId),
    { bypass: fresh },
  );
  const { hall, changed } = await deps.webtic.hall(showing.localId, performance.screenId, occupancy);
  const zone = zoneFor(hunt, showing.localId, performance.screenId);
  const rule: SeatRule = { zone, together: hunt.together, sellableTypes: settings.sellableTypes };
  const analysis = analyzeSeats(hall, occupancy, rule);
  return {
    observed: { showing, performance, analysis, zoneSignature: zoneSignature(zone, hunt.together) },
    detail: { hall, occupancy, analysis, rule },
    hallChanged: changed,
    hallKey: hallKey(showing.localId, performance.screenId),
  };
}

export async function observeHunt(
  deps: RunnerDeps,
  hunt: Hunt,
  settings: Settings,
  now: Date,
  options: { fresh: boolean },
): Promise<HuntObservation> {
  const days = resolveWindow(hunt.window, now);
  const filter = showingFilter(hunt);
  const round: RoundObservation = { now, showings: [], daysWithShowings: [], daysChecked: [], allKeys: [], moviesSeen: [] };
  const details = new Map<string, SeatDetail>();
  const errors: string[] = [];
  const hallChanged: HuntObservation["hallChanged"] = [];
  const unknownSeatTypes = new Set<string>();
  for (const theatreSlug of hunt.theatres) {
    for (const day of days) {
      let all: Showing[];
      try {
        all = await readDay(deps, theatreSlug, day, options.fresh);
      } catch (error) {
        errors.push(`${theatreSlug} ${formatDay(day)} · ${describe(UCI_SOURCE, error)}`);
        continue;
      }
      round.daysChecked.push({ theatreSlug, day });
      if (all.length > 0) round.daysWithShowings.push({ theatreSlug, day });
      round.allKeys.push(...all.map((showing) => showing.key));
      round.moviesSeen.push(...moviesMatching(hunt, all, theatreSlug));
      for (const showing of filterShowings(all, filter, now)) {
        try {
          const seats = await observeSeats(deps, hunt, settings, showing, options.fresh);
          round.showings.push(seats.observed);
          details.set(showing.key, seats.detail);
          if (seats.hallChanged) hallChanged.push({ showingKey: showing.key, hallKey: seats.hallKey });
          for (const type of seats.detail.analysis.unknownTypes) unknownSeatTypes.add(type);
        } catch (error) {
          errors.push(`${formatDay(showing.day)} ${showing.time} ${showing.room} · ${describe(WEBTIC_SOURCE, error)}`);
          round.showings.push({ showing, performance: null, analysis: null, zoneSignature: null });
        }
      }
    }
  }
  return { round, details, errors, hallChanged, unknownSeatTypes: [...unknownSeatTypes] };
}
