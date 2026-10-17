import { z } from "zod";
import { isIsoDay, resolveWindow, romeNow, timeInRange, weekdayOf } from "./dates.js";
import { ApiShapeError } from "./errors.js";
import { showingKey, SLUG } from "./keys.js";
import type {
  CatalogMovie,
  HttpClient,
  IsoDay,
  MovieRef,
  MovieTheatre,
  Showing,
  ShowingFilter,
  Theatre,
} from "./types.js";

export const UCI_API_BASE = "https://myuci---uci-backend-production-nfluwp7wga-oc.a.run.app/api";
export const UCI_SITE = "https://ucicinemas.it";
export const UCI_HEADERS = { Referer: "https://ucicinemas.it" };

const CART_LINK_PATTERN = /^\/movies\/([a-z0-9-]+)\/acquista\/(\d+)\/(\d+)\/(\d+)$/;
const STARTS_AT_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;
const CLOCK_PATTERN = /^(\d{1,2}):(\d{2})/;

const optionalString = z.string().nullable().catch(null);

const dataListSchema = z.object({ data: z.array(z.unknown()) });

const theatreSchema = z.object({
  slug: z.string().min(1),
  name: z.string().catch(""),
  city: z.string().catch(""),
  province: optionalString,
  region: optionalString,
  is_luxe: z.boolean().catch(false),
  screens: z.array(z.string()).catch([]),
});

const movieTheatreSchema = z.object({
  slug: z.string().min(1),
  name: z.string().catch(""),
  movie_variants: z.array(z.number()).catch([]),
});

const movieRefSchema = z.object({
  slug: z.string().min(1),
  title: z.string(),
  poster: optionalString,
});

const movieSchema = movieRefSchema.extend({
  screens: z.array(z.unknown()).catch([]),
});

const versionSchema = z.object({
  language: z.object({ name: z.string() }).nullable().catch(null),
  duration: optionalString,
  performances: z.array(z.unknown()).catch([]),
});

const performanceSchema = z.object({
  day: z.string().refine(isIsoDay),
  starts_at: z.string().regex(STARTS_AT_PATTERN),
  actual_start_at: z.string().regex(CLOCK_PATTERN),
  room: z.string().catch(""),
  cart_link: z.string(),
});

const catalogMovieSchema = z.object({
  slug: z.string().regex(SLUG),
  title: z.string().min(1),
  poster: z.string().nullable().catch(null),
  first_performance: z.string().nullable().catch(null),
  last_performance: z.string().nullable().catch(null),
  screens: z.array(z.object({ name: z.string() })).catch([]),
});

function dataList(json: unknown, what: string): unknown[] {
  const parsed = dataListSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiShapeError("uci", `Unexpected ${what} response shape`);
  }
  return parsed.data.data;
}

function parseEach<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
  const parsed: T[] = [];
  for (const item of items) {
    const result = schema.safeParse(item);
    if (result.success) {
      parsed.push(result.data);
    }
  }
  return parsed;
}

export function normalizeFormat(raw: string): string {
  return (raw.split(" - ")[0] ?? "").trim().toUpperCase();
}

export function formatEdition(raw: string): string | null {
  const edition = raw.split(" - ")[1]?.trim().toUpperCase() ?? "";
  return edition === "" ? null : edition;
}

function catalogFormats(names: string[]): string[] {
  const groups = names.map(normalizeFormat).filter((group) => group !== "");
  const editions = names.flatMap((name) => formatEdition(name) ?? []);
  return [...new Set([...groups, ...editions])];
}

function catalogDay(value: string | null): IsoDay | null {
  return value !== null && isIsoDay(value) ? value : null;
}

export function parseCatalog(json: unknown): CatalogMovie[] {
  return parseEach(catalogMovieSchema, dataList(json, "movies")).map((movie) => ({
    slug: movie.slug,
    title: movie.title,
    poster: movie.poster,
    firstDay: catalogDay(movie.first_performance),
    lastDay: catalogDay(movie.last_performance),
    formats: catalogFormats(movie.screens.map((screen) => screen.name)),
  }));
}

export function parseCartLink(
  link: string,
): { movieSlug: string; localId: number; eventId: number; performanceId: number } | null {
  const match = CART_LINK_PATTERN.exec(link);
  if (!match) {
    return null;
  }
  return {
    movieSlug: match[1] as string,
    localId: Number(match[2]),
    eventId: Number(match[3]),
    performanceId: Number(match[4]),
  };
}

export function parseTheatres(json: unknown): Theatre[] {
  return parseEach(theatreSchema, dataList(json, "theatres")).map((t) => ({
    slug: t.slug,
    name: t.name,
    city: t.city,
    province: t.province,
    region: t.region,
    isLuxe: t.is_luxe,
    screens: t.screens,
  }));
}

function durationToMinutes(duration: string | null): number | null {
  const match = duration === null ? null : /^(\d{1,2}):(\d{2})$/.exec(duration);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function normalizeClock(value: string): string {
  const match = CLOCK_PATTERN.exec(value) as RegExpExecArray;
  return `${(match[1] as string).padStart(2, "0")}:${match[2] as string}`;
}

function showingsOfMovie(movieJson: unknown, theatreSlug: string): Showing[] {
  const movieResult = movieSchema.safeParse(movieJson);
  if (!movieResult.success) {
    return [];
  }
  const movie = movieResult.data;
  const ref: MovieRef = { slug: movie.slug, title: movie.title.trim(), poster: movie.poster };
  const showings: Showing[] = [];
  for (const screen of movie.screens) {
    if (typeof screen !== "object" || screen === null) {
      continue;
    }
    for (const [format, versions] of Object.entries(screen)) {
      if (!Array.isArray(versions)) {
        continue;
      }
      for (const version of parseEach(versionSchema, versions)) {
        for (const perf of parseEach(performanceSchema, version.performances)) {
          const cart = parseCartLink(perf.cart_link);
          const startsAt = STARTS_AT_PATTERN.exec(perf.starts_at) as RegExpExecArray;
          if (!cart) {
            continue;
          }
          showings.push({
            key: showingKey(cart.localId, cart.performanceId),
            localId: cart.localId,
            eventId: cart.eventId,
            performanceId: cart.performanceId,
            theatreSlug,
            movie: ref,
            format,
            formatGroup: normalizeFormat(format),
            language: version.language?.name ?? null,
            day: perf.day,
            startsAt: `${startsAt[1] as string}T${startsAt[2] as string}`,
            time: normalizeClock(perf.actual_start_at),
            room: perf.room,
            durationMinutes: durationToMinutes(version.duration),
            cartUrl: UCI_SITE + perf.cart_link,
          });
        }
      }
    }
  }
  return showings;
}

function showingsOfMovies(movies: unknown[], theatreSlug: string): Showing[] {
  return movies.flatMap((movie) => showingsOfMovie(movie, theatreSlug));
}

export function parseProgrammingDay(json: unknown, theatreSlug: string): Showing[] {
  return showingsOfMovies(dataList(json, "programming"), theatreSlug);
}

export function parseProgrammingAll(json: unknown, theatreSlug: string): Map<IsoDay, Showing[]> {
  const result = new Map<IsoDay, Showing[]>();
  for (const entry of dataList(json, "programming")) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    for (const [day, movies] of Object.entries(entry)) {
      if (!isIsoDay(day) || !Array.isArray(movies)) {
        continue;
      }
      const existing = result.get(day) ?? [];
      result.set(day, existing.concat(showingsOfMovies(movies, theatreSlug)));
    }
  }
  return result;
}

export function parseMovieTheatres(json: unknown): MovieTheatre[] {
  return parseEach(movieTheatreSchema, dataList(json, "movie theatres")).map((t) => ({
    slug: t.slug,
    name: t.name,
    variants: t.movie_variants,
  }));
}

export function parseMovie(json: unknown): MovieRef {
  const parsed = z.object({ data: movieRefSchema }).safeParse(json);
  if (!parsed.success) {
    throw new ApiShapeError("uci", "Unexpected movie response shape");
  }
  const { slug, title, poster } = parsed.data.data;
  return { slug, title: title.trim(), poster };
}

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function matchesTitle(title: string, words: string[]): boolean {
  const tokens = new Set(normalizeTitle(title).split(" "));
  return words.every((word) => normalizeTitle(word).split(" ").every((token) => tokens.has(token)));
}

function includesIgnoreCase(values: string[], value: string): boolean {
  const lower = value.toLowerCase();
  return values.some((candidate) => candidate.toLowerCase() === lower);
}

export function filterShowings(showings: Showing[], filter: ShowingFilter, now: Date): Showing[] {
  const rome = romeNow(now);
  const nowLocal = `${rome.day}T${rome.time}`;
  const days = filter.window ? new Set(resolveWindow(filter.window, now)) : null;
  return showings.filter(
    (s) =>
      s.startsAt.slice(0, 16) >= nowLocal &&
      (!filter.movieSlugs || filter.movieSlugs.includes(s.movie.slug)) &&
      (!filter.titleWords || matchesTitle(s.movie.title, filter.titleWords)) &&
      (!filter.formats || [s.formatGroup, s.format, formatEdition(s.format)].some((value) => value !== null && includesIgnoreCase(filter.formats ?? [], value))) &&
      (!days || days.has(s.day)) &&
      timeInRange(s.time, filter.timeFrom, filter.timeTo) &&
      (!filter.weekdays || filter.weekdays.includes(weekdayOf(s.day))) &&
      (!filter.languages || (s.language !== null && includesIgnoreCase(filter.languages, s.language))),
  );
}

function assertSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw new ApiShapeError("uci", `Invalid slug: ${slug}`);
  }
}

function assertDay(day: string): void {
  if (!isIsoDay(day)) {
    throw new ApiShapeError("uci", `Invalid day: ${day}`);
  }
}

export function createUciClient(http: HttpClient): {
  theatres(): Promise<Theatre[]>;
  programmingDay(theatreSlug: string, day: IsoDay): Promise<Showing[]>;
  programmingAll(theatreSlug: string): Promise<Map<IsoDay, Showing[]>>;
  movie(slug: string): Promise<MovieRef>;
  movieTheatres(slug: string): Promise<MovieTheatre[]>;
  catalog(): Promise<CatalogMovie[]>;
} {
  const get = (path: string): Promise<unknown> => http.getJson(UCI_API_BASE + path, { headers: UCI_HEADERS });
  return {
    async theatres() {
      return parseTheatres(await get("/theatres"));
    },
    async programmingDay(theatreSlug, day) {
      assertSlug(theatreSlug);
      assertDay(day);
      return parseProgrammingDay(await get(`/theatres/${theatreSlug}/programming/${day}`), theatreSlug);
    },
    async programmingAll(theatreSlug) {
      assertSlug(theatreSlug);
      return parseProgrammingAll(await get(`/theatres/${theatreSlug}/programming`), theatreSlug);
    },
    async movie(slug) {
      assertSlug(slug);
      return parseMovie(await get(`/movies/${slug}`));
    },
    async movieTheatres(slug) {
      assertSlug(slug);
      return parseMovieTheatres(await get(`/movies/${slug}/theatres`));
    },
    async catalog() {
      return parseCatalog(await get("/movies"));
    },
  };
}
