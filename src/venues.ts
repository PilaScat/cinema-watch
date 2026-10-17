import { z } from "zod";
import { HttpError } from "./errors.js";
import type { createStore } from "./store.js";
import type { CatalogMovie, MovieTheatre, Theatre } from "./types.js";
import { localIdOfSlug, moviesOf, WEBTIC_SLUG, type WebticDirectClient, type WebticVenue } from "./webtic-direct.js";

type Store = ReturnType<typeof createStore>;

export const VENUE_FILE = "webtic-venues.json";
export const VENUE_CHECK_MS = 7 * 24 * 60 * 60 * 1000;

export interface VenueList {
  checkedAt: number;
  venues: WebticVenue[];
}

const nullableNumber = z.number().nullable();

const theatreSchema = z.object({
  slug: z.string().regex(WEBTIC_SLUG),
  name: z.string(),
  city: z.string(),
  province: z.string().nullable(),
  region: z.string().nullable(),
  isLuxe: z.boolean(),
  screens: z.array(z.string()),
  lat: nullableNumber,
  lon: nullableNumber,
  chain: z.literal("webtic"),
});

const movieSchema = z.object({
  slug: z.string(),
  title: z.string(),
  poster: z.string().nullable(),
  firstDay: z.string().nullable(),
  lastDay: z.string().nullable(),
  formats: z.array(z.string()),
});

const listSchema = z.object({
  checkedAt: z.number(),
  venues: z.array(z.object({ theatre: theatreSchema, movies: z.array(movieSchema) })),
});

export function venuesDue(list: VenueList | null, now: number): boolean {
  return list === null || now - list.checkedAt >= VENUE_CHECK_MS;
}

export interface ProbeOptions {
  onFound?: (venue: WebticVenue) => void;
  stopped?: () => boolean;
}

function skippable(error: unknown): boolean {
  return !(error instanceof HttpError) || error.kind === "timeout";
}

export async function probeVenues(client: WebticDirectClient, now: () => number, options: ProbeOptions = {}): Promise<VenueList> {
  const venues: WebticVenue[] = [];
  for (const theatre of await client.venueCandidates()) {
    if (options.stopped?.()) throw new Error("venue check stopped");
    const localId = localIdOfSlug(theatre.slug);
    if (localId === null) continue;
    try {
      const programming = await client.scheduling(localId);
      if (programming.size === 0) continue;
      const venue = { theatre, movies: moviesOf(programming) };
      venues.push(venue);
      options.onFound?.(venue);
    } catch (error) {
      if (!skippable(error)) throw error;
    }
  }
  return { checkedAt: now(), venues };
}

export async function loadVenueList(store: Store): Promise<VenueList | null> {
  try {
    const parsed = listSchema.safeParse(await store.readJson(VENUE_FILE));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveVenueList(store: Store, list: VenueList): Promise<void> {
  await store.writeJson(VENUE_FILE, list);
}

export function mergeCatalogs(uci: CatalogMovie[], venues: WebticVenue[]): CatalogMovie[] {
  const merged = new Map(uci.map((movie) => [movie.slug, { ...movie, formats: [...movie.formats] }]));
  for (const movie of venues.flatMap((venue) => venue.movies)) {
    const known = merged.get(movie.slug);
    if (!known) {
      merged.set(movie.slug, { ...movie, formats: [...movie.formats] });
      continue;
    }
    known.poster ??= movie.poster;
    known.firstDay = earliest(known.firstDay, movie.firstDay);
    known.lastDay = latest(known.lastDay, movie.lastDay);
    for (const format of movie.formats) if (!known.formats.includes(format)) known.formats.push(format);
  }
  return [...merged.values()];
}

function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  return b !== null && b < a ? b : a;
}

function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  return b !== null && b > a ? b : a;
}

export function venuesWithMovie(venues: WebticVenue[], movieSlug: string): MovieTheatre[] {
  return venues
    .filter((venue) => venue.movies.some((movie) => movie.slug === movieSlug))
    .map((venue) => ({ slug: venue.theatre.slug, name: venue.theatre.name, variants: [] }));
}

export function venueTheatres(list: VenueList | null): Theatre[] {
  return (list?.venues ?? []).map((venue) => venue.theatre);
}
