import type { TtlCache } from "./cache.js";
import { resolveWindow } from "./dates.js";
import type { Hunt, ObservedShowing, RoundObservation, Settings } from "./model.js";
import { analyzeSeats } from "./seats.js";
import type { Hall, IsoDay, MovieRef, Occupancy, PerformanceInfo, SeatAnalysis, SeatRule, Showing, ShowingFilter, Zone } from "./types.js";
import { filterShowings, matchesTitle, type createUciClient } from "./uci.js";
import type { createWebticClient } from "./webtic.js";

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
  hallChanged: string[];
}

export function zoneSignature(zone: Zone, together: number): string {
  return JSON.stringify({ zone, together });
}

export function zoneFor(hunt: Hunt, localId: number, screenId: number): Zone {
  return hunt.hallZones[`${localId}-${screenId}`] ?? hunt.zone;
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

async function readDay(deps: RunnerDeps, theatreSlug: string, day: IsoDay): Promise<Showing[]> {
  return deps.caches.programming.getOrLoad(`${theatreSlug}|${day}`, () => deps.uci.programmingDay(theatreSlug, day));
}

async function observeSeats(
  deps: RunnerDeps,
  hunt: Hunt,
  settings: Settings,
  showing: Showing,
  fresh: boolean,
): Promise<{ observed: ObservedShowing; detail: SeatDetail; hallChanged: boolean }> {
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
  const round: RoundObservation = { now, showings: [], daysRead: [], moviesSeen: [] };
  const details = new Map<string, SeatDetail>();
  const errors: string[] = [];
  const hallChanged: string[] = [];
  for (const theatreSlug of hunt.theatres) {
    for (const day of days) {
      let all: Showing[];
      try {
        all = await readDay(deps, theatreSlug, day);
      } catch (error) {
        errors.push(`${theatreSlug} ${day}: ${describe(error)}`);
        continue;
      }
      round.daysRead.push({ theatreSlug, day });
      round.moviesSeen.push(...moviesMatching(hunt, all, theatreSlug));
      for (const showing of filterShowings(all, filter, now)) {
        try {
          const seats = await observeSeats(deps, hunt, settings, showing, options.fresh);
          round.showings.push(seats.observed);
          details.set(showing.key, seats.detail);
          if (seats.hallChanged) hallChanged.push(showing.key);
        } catch (error) {
          errors.push(`${showing.key}: ${describe(error)}`);
          round.showings.push({ showing, performance: null, analysis: null, zoneSignature: null });
        }
      }
    }
  }
  return { round, details, errors, hallChanged };
}
