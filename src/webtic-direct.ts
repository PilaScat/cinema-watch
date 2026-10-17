import { z } from "zod";
import { isIsoDay } from "./dates.js";
import { ApiShapeError, WebticError } from "./errors.js";
import { showingKey } from "./keys.js";
import { regionOfProvince } from "./regions.js";
import { normalizeTitle } from "./uci.js";
import { parseSeatId, type SeatTransport } from "./webtic.js";
import type { CatalogMovie, Hall, HttpClient, IsoDay, MovieRef, Occupancy, PerformanceInfo, Seat, Showing, TakenStatus, Theatre } from "./types.js";

export const WEBTIC_DIRECT_BASE = "https://secure.webtic.it/api/wtjsonservices.ashx";
export const WEBTIC_ASSET_BASE = "https://secure.webtic.it/api/";
export const WEBTIC_BOOKING_BASE = "https://secure.webtic.it/angwt/webtic.aspx";

export const WEBTIC_SLUG = /^webtic-([1-9]\d*)$/;
const FILM_EVENT = "CINEMA";
const LEADING_TAG = /^\s*\([^)]*\)\s*/;
const PREVIEW_SUFFIX = /[\s-]+anteprima\s*$/i;
const EDITIONS = ["INFINITY VISION"];
const ITALIAN = "ITA";
const LANGUAGE_NAMES: Record<string, string> = { EN: "ENG" };
const ORIGINAL_VERSION = "O.V.";
const STAGE_CATEGORIES = new Set([
  "TEATRO",
  "TEATRO PROSA",
  "TEATRO DI PROSA",
  "TEATRO RAGAZZI",
  "BALLETTO",
  "OPERA",
  "DANZA",
  "CABARET",
  "VARIETA' COMICO",
  "SPETTACOLO",
  "INSTALLAZIONE",
  "PERFORMANCE",
  "SOUND PERFORMANCE",
  "MUSICAL",
]);
const CINEMA_NAME = /CINE|MULTISALA|MULTIPLEX|NOTORIOUS|STARPLEX|MOVIE PLANET|ARCADIA|GIOMETTI|SCREEN|ODEON|POLITEAMA|ARENA|SUPERCINEMA|KING|PLEX/i;
const EXCLUDED_NAME = /\bUCI\b|\bTEST\b/i;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/;
const CLOCK = /^(\d{1,2}):(\d{2})/;

const envelopeSchema = z.object({
  userdata: z.object({ StatusOk: z.boolean(), ReasonCode: z.number().nullish(), Message: z.string().nullish() }),
  DS: z.unknown().optional(),
});

const venueSchema = z.object({
  LocalId: z.number().int().positive(),
  Description: z.string().catch(""),
  District: z.string().catch(""),
  DistrictAbbreviation: z.string().catch(""),
  Town: z.string().catch(""),
  Latitude: z.union([z.string(), z.number()]).nullable().catch(null),
  Longitude: z.union([z.string(), z.number()]).nullable().catch(null),
});

const titleSchema = z.object({
  Category: z.string().catch(""),
  Locals: z.array(z.object({ LocalId: z.number() })).catch([]),
});

const localsSchema = z.object({
  LocalsTitles: z.object({ Locals: z.record(z.string(), z.unknown()), Titles: z.array(z.unknown()).catch([]) }),
});

const propertySchema = z.object({ EventProperty: z.string(), EventPropertyCategory: z.string().catch("") });

const performanceSchema = z.object({
  PerformanceId: z.number().int().positive(),
  Time: z.string().regex(CLOCK),
  ScreenName: z.string().catch(""),
  StartTime: z.string().regex(DATE_TIME),
});

const daySchema = z.object({ Day: z.string(), Performances: z.array(z.unknown()).catch([]) });

const eventSchema = z.object({
  EventId: z.number().int().positive(),
  Title: z.string().min(1),
  Type: z.string().catch(""),
  Is3D: z.boolean().catch(false),
  Duration: z.string().nullable().catch(null),
  Picture: z.string().nullable().catch(null),
  EventProperties: z.array(z.unknown()).catch([]),
  Days: z.array(z.unknown()).catch([]),
});

const schedulingSchema = z.object({
  Scheduling: z.object({ LocalId: z.number(), Events: z.array(z.unknown()).catch([]) }),
});

const performanceInfoSchema = z.object({
  Performance: z.object({
    LocalId: z.number(),
    EventId: z.number(),
    PerformanceId: z.number(),
    ScreenId: z.number(),
    Screen: z.string().catch(""),
    StartTime: z.string(),
    Title: z.string().catch(""),
  }),
});

const mapSeatSchema = z.object({
  idposto: z.string().min(1),
  fila: z.number(),
  colonna: z.number(),
  settore: z.string().catch(""),
  tipologia: z.string().catch(""),
});

const mapSchema = z.object({ MapSeats: z.object({ posti: z.array(z.unknown()) }) });

const occupancySchema = z.object({
  Occupancy: z.object({ posti: z.array(z.object({ idposto: z.string(), status: z.string() })) }),
});

const takenStatuses: Record<string, TakenStatus> = { ACQUISTO: "sold", BLOCCATO: "blocked" };

export interface WebticVenue {
  theatre: Theatre;
  movies: CatalogMovie[];
}

export interface ParsedTitle {
  title: string;
  slug: string;
  edition: string | null;
}

function parseEach<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
  return items.flatMap((item) => {
    const result = schema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

function unwrap<T>(json: unknown, schema: z.ZodType<T>, what: string): T {
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) throw new ApiShapeError("webtic", `${what}: unexpected envelope`);
  const { userdata, DS } = envelope.data;
  if (!userdata.StatusOk) throw new WebticError(userdata.ReasonCode ?? null, userdata.Message ?? "");
  const data = schema.safeParse(DS);
  if (!data.success) throw new ApiShapeError("webtic", `${what}: unexpected shape`);
  return data.data;
}

export function webticSlug(localId: number): string {
  return `webtic-${localId}`;
}

export function localIdOfSlug(slug: string): number | null {
  const match = WEBTIC_SLUG.exec(slug);
  return match ? Number(match[1]) : null;
}

export function webticCartUrl(localId: number, eventId: number, performanceId: number): string {
  return `${WEBTIC_BOOKING_BASE}?lid=${localId}&lng=it#/shoppingmode/it/0/${localId}/${eventId}/${performanceId}`;
}

function coordinate(value: string | number | null, limit: number): number | null {
  const number = value === null ? Number.NaN : Number(value);
  return Number.isFinite(number) && number !== 0 && Math.abs(number) <= limit ? number : null;
}

function cleanName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function townName(value: string): string {
  const town = cleanName(value);
  if (town !== town.toLowerCase() && town !== town.toUpperCase()) return town;
  return town.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

function theatreOf(venue: z.infer<typeof venueSchema>): Theatre {
  const lat = coordinate(venue.Latitude, 90);
  const lon = coordinate(venue.Longitude, 180);
  const located = lat !== null && lon !== null;
  return {
    slug: webticSlug(venue.LocalId),
    name: cleanName(venue.Description),
    city: townName(venue.Town),
    province: cleanName(venue.District) || null,
    region: regionOfProvince(venue.DistrictAbbreviation),
    isLuxe: false,
    screens: [],
    lat: located ? lat : null,
    lon: located ? lon : null,
    chain: "webtic",
  };
}

export function parseVenueCandidates(json: unknown): Theatre[] {
  const { Locals, Titles } = unwrap(json, localsSchema, "locals").LocalsTitles;
  const withFilms = new Set(
    parseEach(titleSchema, Titles)
      .filter((title) => !STAGE_CATEGORIES.has(title.Category.trim().toUpperCase()))
      .flatMap((title) => title.Locals.map((local) => local.LocalId)),
  );
  return parseEach(venueSchema, Object.values(Locals))
    .filter((venue) => !EXCLUDED_NAME.test(venue.Description))
    .filter((venue) => withFilms.has(venue.LocalId) || CINEMA_NAME.test(venue.Description))
    .map(theatreOf)
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

export function parseTitle(raw: string): ParsedTitle {
  let title = raw.trim();
  while (LEADING_TAG.test(title)) title = title.replace(LEADING_TAG, "");
  title = title.replace(PREVIEW_SUFFIX, "");
  let edition: string | null = null;
  for (const candidate of EDITIONS) {
    const suffix = new RegExp(`[\\s-]+${candidate.replaceAll(" ", "\\s+")}\\s*$`, "i");
    if (suffix.test(title)) {
      edition = candidate;
      title = title.replace(suffix, "");
    }
  }
  title = title.replace(/[\s-]+$/, "").trim() || raw.trim();
  return { title, slug: normalizeTitle(title).replaceAll(" ", "-"), edition };
}

function movieSlugOf(parsed: ParsedTitle, eventId: number): string {
  return parsed.slug === "" ? `film-${eventId}` : parsed.slug;
}

function propertiesOf(event: z.infer<typeof eventSchema>): Array<z.infer<typeof propertySchema>> {
  return parseEach(propertySchema, event.EventProperties);
}

function languageOf(properties: Array<z.infer<typeof propertySchema>>): string | null {
  const language = properties.find((property) => property.EventPropertyCategory === "LANGUAGE")?.EventProperty.trim().toUpperCase();
  if (language) return LANGUAGE_NAMES[language] ?? language;
  return properties.some((property) => property.EventProperty === ORIGINAL_VERSION) ? null : ITALIAN;
}

function screenFormatOf(event: z.infer<typeof eventSchema>, properties: Array<z.infer<typeof propertySchema>>): string {
  const screen = properties.find((property) => property.EventPropertyCategory === "SCREEN")?.EventProperty.trim().toUpperCase();
  return screen || (event.Is3D ? "3D" : "2D");
}

function durationOf(value: string | null): number | null {
  const match = value === null ? null : /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function posterOf(picture: string | null): string | null {
  if (picture === null || picture.trim() === "" || /^[a-z]+:/i.test(picture) || picture.startsWith("/")) return null;
  return WEBTIC_ASSET_BASE + picture.trim();
}

function clockOf(value: string): string {
  const match = CLOCK.exec(value) as RegExpExecArray;
  return `${(match[1] as string).padStart(2, "0")}:${match[2] as string}`;
}

function showingsOfEvent(localId: number, theatreSlug: string, event: z.infer<typeof eventSchema>): Showing[] {
  const parsed = parseTitle(event.Title);
  const properties = propertiesOf(event);
  const group = screenFormatOf(event, properties);
  const format = parsed.edition === null ? group : `${group} - ${parsed.edition}`;
  const movie: MovieRef = { slug: movieSlugOf(parsed, event.EventId), title: parsed.title, poster: posterOf(event.Picture) };
  const language = languageOf(properties);
  const durationMinutes = durationOf(event.Duration);
  return parseEach(daySchema, event.Days).flatMap((day) => {
    const isoDay = day.Day.slice(0, 10);
    if (!isIsoDay(isoDay)) return [];
    return parseEach(performanceSchema, day.Performances).map((performance) => {
      const startsAt = DATE_TIME.exec(performance.StartTime) as RegExpExecArray;
      return {
        key: showingKey(localId, performance.PerformanceId),
        localId,
        eventId: event.EventId,
        performanceId: performance.PerformanceId,
        theatreSlug,
        movie,
        format,
        formatGroup: group,
        language,
        day: isoDay,
        startsAt: `${startsAt[1] as string}T${startsAt[2] as string}`,
        time: clockOf(performance.Time),
        room: cleanName(performance.ScreenName),
        durationMinutes,
        cartUrl: webticCartUrl(localId, event.EventId, performance.PerformanceId),
      };
    });
  });
}

export function parseScheduling(json: unknown, theatreSlug: string): Map<IsoDay, Showing[]> {
  const { LocalId, Events } = unwrap(json, schedulingSchema, "scheduling").Scheduling;
  const result = new Map<IsoDay, Showing[]>();
  for (const event of parseEach(eventSchema, Events)) {
    if (event.Type.trim().toUpperCase() !== FILM_EVENT) continue;
    for (const showing of showingsOfEvent(LocalId, theatreSlug, event)) {
      result.set(showing.day, [...(result.get(showing.day) ?? []), showing]);
    }
  }
  return result;
}

export function moviesOf(programming: Map<IsoDay, Showing[]>): CatalogMovie[] {
  const movies = new Map<string, CatalogMovie>();
  for (const showing of [...programming.values()].flat()) {
    const known = movies.get(showing.movie.slug);
    const formats = [showing.formatGroup, ...(showing.format === showing.formatGroup ? [] : [showing.format.split(" - ")[1] ?? ""])].filter((format) => format !== "");
    if (!known) {
      movies.set(showing.movie.slug, { ...showing.movie, firstDay: showing.day, lastDay: showing.day, formats });
      continue;
    }
    known.firstDay = known.firstDay !== null && known.firstDay < showing.day ? known.firstDay : showing.day;
    known.lastDay = known.lastDay !== null && known.lastDay > showing.day ? known.lastDay : showing.day;
    known.poster ??= showing.movie.poster;
    for (const format of formats) if (!known.formats.includes(format)) known.formats.push(format);
  }
  return [...movies.values()].sort((a, b) => a.title.localeCompare(b.title, "it"));
}

export function parsePerformanceInfo(json: unknown): PerformanceInfo {
  const performance = unwrap(json, performanceInfoSchema, "performance").Performance;
  return {
    localId: performance.LocalId,
    eventId: performance.EventId,
    performanceId: performance.PerformanceId,
    screenId: performance.ScreenId,
    screenName: cleanName(performance.Screen),
    startTime: performance.StartTime,
    title: parseTitle(performance.Title).title,
    priceFrom: null,
  };
}

function seatOf(raw: z.infer<typeof mapSeatSchema>): Seat {
  const { rowLabel, number } = parseSeatId(raw.idposto);
  return { id: raw.idposto, rowLabel, number, row: raw.fila, column: raw.colonna, sector: raw.settore, type: raw.tipologia };
}

export function parseMap(json: unknown, localId: number, screenId: number, fetchedAt: number): Hall {
  const seats = parseEach(mapSeatSchema, unwrap(json, mapSchema, "map").MapSeats.posti).map(seatOf);
  if (seats.length === 0) throw new ApiShapeError("webtic", "map: no seats");
  return { localId, screenId, seats, fetchedAt };
}

export function parseDirectOccupancy(json: unknown, localId: number, performanceId: number): Occupancy {
  const taken: Record<string, TakenStatus> = {};
  for (const seat of unwrap(json, occupancySchema, "occupancy").Occupancy.posti) taken[seat.idposto] = takenStatuses[seat.status] ?? "other";
  return { localId, performanceId, taken };
}

function assertId(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new ApiShapeError("webtic", `invalid ${name}: ${String(value)}`);
}

export function createWebticDirectClient(http: HttpClient) {
  const get = (query: Record<string, string | number>): Promise<unknown> => {
    const params = new URLSearchParams(Object.entries(query).map(([key, value]): [string, string] => [key, String(value)]));
    return http.getJson(`${WEBTIC_DIRECT_BASE}?${params.toString()}`);
  };
  const post = (wtid: string, data: Record<string, number>): Promise<unknown> => http.postJson(`${WEBTIC_DIRECT_BASE}?wtid=${wtid}`, { data });

  const seats: SeatTransport = {
    async performance(localId, performanceId) {
      assertId("LocalId", localId);
      assertId("PerformanceId", performanceId);
      return parsePerformanceInfo(await get({ wtid: "getPerformanceInfo", localid: localId, performanceid: performanceId }));
    },
    async occupancy(localId, performanceId) {
      assertId("LocalId", localId);
      assertId("PerformanceId", performanceId);
      return parseDirectOccupancy(await post("getOccupancy", { LocalId: localId, PerformanceId: performanceId }), localId, performanceId);
    },
    async screen(localId, screenId, fetchedAt) {
      assertId("LocalId", localId);
      assertId("ScreenId", screenId);
      return parseMap(await post("getMapSeats", { LocalId: localId, ScreenId: screenId }), localId, screenId, fetchedAt);
    },
  };

  return {
    async venueCandidates(): Promise<Theatre[]> {
      return parseVenueCandidates(await get({ wtid: "getLocalsTitles" }));
    },
    async scheduling(localId: number): Promise<Map<IsoDay, Showing[]>> {
      assertId("LocalId", localId);
      return parseScheduling(await get({ wtid: "getFullScheduling", localid: localId }), webticSlug(localId));
    },
    seats,
  };
}

export type WebticDirectClient = ReturnType<typeof createWebticDirectClient>;
