import { z } from "zod";
import type { TtlCache } from "../cache.js";
import { isIsoDay } from "../dates.js";
import { ApiShapeError, HttpError } from "../errors.js";
import type { GuardedFetch } from "../http.js";
import { regionOfPostalCode, regionOfProvince } from "../regions.js";
import type { createStore } from "../store.js";
import { normalizeTitle } from "../uci.js";
import { parseTitle } from "../webtic-direct.js";
import type { CatalogMovie, Hall, HttpClient, IsoDay, Occupancy, PerformanceInfo, Seat, Showing, TakenStatus, Theatre } from "../types.js";
import type { Circuit, DayResult } from "./types.js";

type Store = ReturnType<typeof createStore>;

export const SPACE_SITE = "https://www.thespacecinema.it";
export const SPACE_API = `${SPACE_SITE}/api/microservice`;
export const SPACE_VENUE_FILE = "space-venues.json";

const SPACE_SLUG = /^space-(\d+)$/;
const SPACE_KEY = /^space-(\d+)-(\d+)$/;
const TOKEN_COOKIE = "microservicesToken";
const TOKEN_TTL_MS = 11 * 60 * 60 * 1000;
const PAGE_TIMEOUT_MS = 15_000;
const VENUE_CHECK_MS = 7 * 24 * 60 * 60 * 1000;
const COORDINATES = /q=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/;
const ADDRESS = /<address[^>]*>([^<]*)<\/address>/;
const PROVINCE = /\b([A-Z]{2})\s*$/;
const POSTAL_CODE = /\b(\d{5})\b/;
const CLOCK = /T(\d{2}):(\d{2})/;
const SCREEN_FORMATS = ["IMAX", "4DX", "SCREENX", "3D"];
const EDITIONS = ["INFINITY VISION"];
const LANGUAGES: Record<string, string> = { ITALIANO: "ITA", "LINGUA ORIGINALE": "VO" };
const SOLD = new Set([1, 9, 11]);
const BLOCKED = new Set([4, 8, 10]);
const ACCESSIBLE = new Set([3, 7, 8, 9, 10, 11]);
const NOT_BOOKABLE = 12;
const SELLABLE_STATUSES = new Set([0, 1, 4]);

const resultSchema = z.object({ result: z.unknown() });

const cinemaSchema = z.object({
  cinemaId: z.string().regex(/^\d+$/),
  cinemaName: z.string().min(1),
  whatsOnUrl: z.string().nullable().catch(null),
});

const attributeSchema = z.object({ value: z.string().catch(""), attributeType: z.string().catch("") });

const sessionSchema = z.object({
  sessionId: z.string().regex(/^\d+$/),
  startTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  screenName: z.string().catch(""),
  bookingUrl: z.string().nullable().catch(null),
  duration: z.number().nullable().catch(null),
  attributes: z.array(z.unknown()).catch([]),
});

const filmSchema = z.object({
  filmId: z.string().min(1),
  filmTitle: z.string().min(1),
  posterImageSrc: z.string().nullable().catch(null),
  releaseDate: z.string().nullable().catch(null),
  showingInCinemas: z.array(z.string()).catch([]),
  showingGroups: z.array(z.object({ date: z.string(), sessions: z.array(z.unknown()).catch([]) })).catch([]),
});

const seatSchema = z.object({ name: z.string().min(1), seatStatus: z.number(), areaCategoryCode: z.string().catch("") });

const seatsSchema = z.object({
  seatingData: z.object({ screenLabel: z.string().catch("") }).catch({ screenLabel: "" }),
  seatRows: z.array(z.object({ rowLabel: z.string().catch(""), columns: z.array(z.unknown()).catch([]) })),
  areaCategories: z.array(z.object({ areaCategoryCode: z.string(), areaMainPriceInCents: z.number().nullable().catch(null) })).catch([]),
});

const venueListSchema = z.object({
  checkedAt: z.number(),
  theatres: z.array(
    z.object({
      slug: z.string().regex(SPACE_SLUG),
      name: z.string(),
      city: z.string(),
      province: z.string().nullable(),
      region: z.string().nullable(),
      isLuxe: z.boolean(),
      screens: z.array(z.string()),
      lat: z.number().nullable(),
      lon: z.number().nullable(),
      chain: z.literal("space"),
    }),
  ),
});

export interface SpaceCinema {
  cinemaId: string;
  name: string;
  pageUrl: string | null;
}

export interface SpaceSeats {
  screenName: string;
  seats: Seat[];
  taken: Record<string, TakenStatus>;
  priceFrom: number | null;
}

export interface SpaceVenueList {
  checkedAt: number;
  theatres: Theatre[];
}

function parseEach<T>(schema: z.ZodType<T>, items: unknown[]): T[] {
  return items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function resultOf(json: unknown, what: string): unknown {
  const parsed = resultSchema.safeParse(json);
  if (!parsed.success || parsed.data.result === null || parsed.data.result === undefined) throw new ApiShapeError("space", `${what}: unexpected shape`);
  return parsed.data.result;
}

function listOf(json: unknown, what: string): unknown[] {
  const result = resultOf(json, what);
  if (!Array.isArray(result)) throw new ApiShapeError("space", `${what}: not a list`);
  return result;
}

export function spaceSlug(cinemaId: string): string {
  return `space-${cinemaId}`;
}

export function cinemaIdOfSlug(slug: string): string | null {
  return SPACE_SLUG.exec(slug)?.[1] ?? null;
}

export function isSpaceKey(key: string): boolean {
  return SPACE_KEY.test(key);
}

function spaceKey(cinemaId: string, sessionId: string): string {
  return `space-${cinemaId}-${sessionId}`;
}

function parseSpaceKey(key: string): [string, string] {
  const match = SPACE_KEY.exec(key);
  if (!match) throw new ApiShapeError("space", `invalid key: ${key}`);
  return [match[1] as string, match[2] as string];
}

export function spaceHallKey(cinemaId: string, screenName: string): string {
  return `space-${cinemaId}-${normalizeTitle(screenName).replaceAll(" ", "-") || "sala"}`;
}

export function parseCinemas(json: unknown): SpaceCinema[] {
  const groups = parseEach(z.object({ cinemas: z.array(z.unknown()).catch([]) }), listOf(json, "cinemas"));
  return parseEach(cinemaSchema, groups.flatMap((group) => group.cinemas)).map((cinema) => ({
    cinemaId: cinema.cinemaId,
    name: cinema.cinemaName.trim(),
    pageUrl: cinema.whatsOnUrl,
  }));
}

export function parseCinemaPage(html: string): { lat: number | null; lon: number | null; province: string | null; postalCode: string | null } {
  const coordinates = COORDINATES.exec(html);
  const lat = coordinates ? Number(coordinates[1]) : null;
  const lon = coordinates ? Number(coordinates[2]) : null;
  const located = lat !== null && lon !== null && lat !== 0 && lon !== 0 && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const address = ADDRESS.exec(html)?.[1]?.trim() ?? "";
  return { lat: located ? lat : null, lon: located ? lon : null, province: PROVINCE.exec(address)?.[1] ?? null, postalCode: POSTAL_CODE.exec(address)?.[1] ?? null };
}

function regionOf(page: ReturnType<typeof parseCinemaPage> | null): string | null {
  const byProvince = page?.province ? regionOfProvince(page.province) : null;
  return byProvince ?? (page?.postalCode ? regionOfPostalCode(page.postalCode) : null);
}

export function theatreOf(cinema: SpaceCinema, page: ReturnType<typeof parseCinemaPage> | null): Theatre {
  return {
    slug: spaceSlug(cinema.cinemaId),
    name: `The Space ${cinema.name}`,
    city: cinema.name,
    province: page?.province ?? null,
    region: regionOf(page),
    isLuxe: false,
    screens: [],
    lat: page?.lat ?? null,
    lon: page?.lon ?? null,
    chain: "space",
  };
}

function formatOf(attributes: Array<z.infer<typeof attributeSchema>>): { format: string; group: string } {
  const values = attributes.map((attribute) => attribute.value.trim().toUpperCase()).filter((value) => value !== "");
  const group = SCREEN_FORMATS.find((format) => values.includes(format)) ?? "2D";
  const edition = EDITIONS.find((name) => values.includes(name));
  return { format: edition ? `${group} - ${edition}` : group, group };
}

function languageOf(attributes: Array<z.infer<typeof attributeSchema>>): string | null {
  const value = attributes.find((attribute) => attribute.attributeType === "Language")?.value.trim().toUpperCase();
  return value ? (LANGUAGES[value] ?? value) : null;
}

function cartUrlOf(bookingUrl: string | null): string {
  if (bookingUrl === null || !bookingUrl.startsWith("/")) return SPACE_SITE;
  return SPACE_SITE + bookingUrl;
}

export function parseProgramming(json: unknown, cinemaId: string): Map<IsoDay, Showing[]> {
  const programming = new Map<IsoDay, Showing[]>();
  const theatreSlug = spaceSlug(cinemaId);
  for (const film of parseEach(filmSchema, listOf(json, "programming"))) {
    const parsed = parseTitle(film.filmTitle);
    const movie = { slug: parsed.slug === "" ? `film-${film.filmId.toLowerCase()}` : parsed.slug, title: parsed.title, poster: film.posterImageSrc };
    for (const group of film.showingGroups) {
      const day = group.date.slice(0, 10);
      if (!isIsoDay(day)) continue;
      for (const session of parseEach(sessionSchema, group.sessions)) {
        const attributes = parseEach(attributeSchema, session.attributes);
        const { format, group: formatGroup } = formatOf(attributes);
        const clock = CLOCK.exec(session.startTime) as RegExpExecArray;
        const showing: Showing = {
          key: spaceKey(cinemaId, session.sessionId),
          theatreSlug,
          movie,
          format,
          formatGroup,
          language: languageOf(attributes),
          day,
          startsAt: session.startTime.slice(0, 19),
          time: `${clock[1] as string}:${clock[2] as string}`,
          room: session.screenName.trim(),
          durationMinutes: session.duration,
          cartUrl: cartUrlOf(session.bookingUrl),
        };
        programming.set(day, [...(programming.get(day) ?? []), showing]);
      }
    }
  }
  return programming;
}

export type SpaceFilm = CatalogMovie & { cinemaIds: string[] };

export function parseFilms(json: unknown): SpaceFilm[] {
  return parseEach(filmSchema, listOf(json, "films")).map((film) => {
    const parsed = parseTitle(film.filmTitle);
    const release = film.releaseDate?.slice(0, 10) ?? "";
    return {
      slug: parsed.slug === "" ? `film-${film.filmId.toLowerCase()}` : parsed.slug,
      title: parsed.title,
      poster: film.posterImageSrc,
      firstDay: isIsoDay(release) ? release : null,
      lastDay: null,
      formats: [],
      cinemaIds: film.showingInCinemas,
    };
  });
}

function seatNumber(name: string): number | null {
  const digits = /(\d+)$/.exec(name)?.[1];
  return digits === undefined ? null : Number(digits);
}

function seatOf(raw: z.infer<typeof seatSchema>, rowLabel: string, row: number, column: number): Seat {
  const accessible = ACCESSIBLE.has(raw.seatStatus);
  const type = accessible ? "DISABILE" : SELLABLE_STATUSES.has(raw.seatStatus) ? "STANDARD" : "RISERVATO";
  return { id: raw.name, rowLabel, number: seatNumber(raw.name), row, column, sector: accessible ? "UN" : raw.areaCategoryCode, type };
}

function takenOf(status: number): TakenStatus | null {
  if (SOLD.has(status)) return "sold";
  if (BLOCKED.has(status)) return "blocked";
  return null;
}

export function parseSeats(json: unknown): SpaceSeats {
  const parsed = seatsSchema.safeParse(resultOf(json, "seats"));
  if (!parsed.success) throw new ApiShapeError("space", "seats: unexpected shape");
  const seats: Seat[] = [];
  const taken: Record<string, TakenStatus> = {};
  parsed.data.seatRows.forEach((row, rowIndex) => {
    row.columns.forEach((column, columnIndex) => {
      const raw = seatSchema.safeParse(column);
      if (!raw.success || raw.data.seatStatus === NOT_BOOKABLE) return;
      const seat = seatOf(raw.data, row.rowLabel, rowIndex + 1, columnIndex + 1);
      seats.push(seat);
      const status = takenOf(raw.data.seatStatus);
      if (status !== null) taken[seat.id] = status;
    });
  });
  if (seats.length === 0) throw new ApiShapeError("space", "seats: no seats");
  const sellableAreas = new Set(seats.filter((seat) => seat.type === "STANDARD").map((seat) => seat.sector));
  const prices = parsed.data.areaCategories.filter((area) => sellableAreas.has(area.areaCategoryCode)).flatMap((area) => (area.areaMainPriceInCents === null ? [] : [area.areaMainPriceInCents / 100]));
  return { screenName: parsed.data.seatingData.screenLabel.trim(), seats, taken, priceFrom: prices.length === 0 ? null : Math.min(...prices) };
}

function cookieOf(response: Response): string | null {
  const pairs = response.headers
    .getSetCookie()
    .map((header) => header.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("="));
  return pairs.some((pair) => pair.startsWith(`${TOKEN_COOKIE}=`)) ? pairs.join("; ") : null;
}

export interface SpaceClientDeps {
  http: HttpClient;
  fetch: GuardedFetch;
  userAgent: string;
  now: () => number;
}

export function createSpaceClient(deps: SpaceClientDeps) {
  let cookie: string | null = null;
  let renewAt = 0;
  let renewing: Promise<string> | null = null;

  async function renewToken(): Promise<string> {
    const response = await deps.fetch(`${SPACE_API}/auth/token`, {
      method: "POST",
      headers: { Accept: "application/json", "User-Agent": deps.userAgent },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    const next = response.ok ? cookieOf(response) : null;
    if (next === null) throw new ApiShapeError("space", `guest token refused (${response.status})`);
    cookie = next;
    renewAt = deps.now() + TOKEN_TTL_MS;
    return next;
  }

  function token(refused: string | null = null): Promise<string> {
    if (cookie !== null && cookie !== refused && deps.now() < renewAt) return Promise.resolve(cookie);
    renewing ??= renewToken().finally(() => {
      renewing = null;
    });
    return renewing;
  }

  async function get(path: string): Promise<unknown> {
    const current = await token();
    try {
      return await deps.http.getJson(`${SPACE_API}${path}`, { headers: { Cookie: current } });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
      return deps.http.getJson(`${SPACE_API}${path}`, { headers: { Cookie: await token(current) } });
    }
  }

  async function page(url: string): Promise<string> {
    const response = await deps.fetch(url, { headers: { "User-Agent": deps.userAgent }, signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    if (!response.ok) throw new HttpError("status", new URL(url).hostname, `Status ${response.status}`, response.status);
    return response.text();
  }

  return {
    cinemas: async () => parseCinemas(await get("/showings/cinemas")),
    programming: async (cinemaId: string) => parseProgramming(await get(`/showings/cinemas/${cinemaId}/films?minEmbargoLevel=1&includesSession=true`), cinemaId),
    films: async () => parseFilms(await get("/showings/films")),
    seats: async (cinemaId: string, sessionId: string) => parseSeats(await get(`/booking/Session/${cinemaId}/${sessionId}/seats`)),
    cinemaPage: async (url: string) => parseCinemaPage(await page(url)),
  };
}

export type SpaceClient = ReturnType<typeof createSpaceClient>;

export interface SpaceShowingInfo {
  startsAt: string;
  title: string;
  cartUrl: string;
}

export interface SpaceCircuitDeps {
  client: SpaceClient;
  schedule: TtlCache<Map<IsoDay, Showing[]>>;
  seats: TtlCache<SpaceSeats>;
  describe(key: string): SpaceShowingInfo | null;
  now: () => number;
}

function cinemaIdOf(theatreSlug: string): string {
  const cinemaId = cinemaIdOfSlug(theatreSlug);
  if (cinemaId === null) throw new ApiShapeError("space", `not a The Space cinema: ${theatreSlug}`);
  return cinemaId;
}

export function createSpaceCircuit(deps: SpaceCircuitDeps): Circuit {
  const seen = new Map<string, SpaceShowingInfo>();
  const hallSeats = new Map<string, string>();

  async function load(cinemaId: string): Promise<Map<IsoDay, Showing[]>> {
    const programming = await deps.client.programming(cinemaId);
    for (const showing of [...programming.values()].flat()) seen.set(showing.key, { startsAt: showing.startsAt, title: showing.movie.title, cartUrl: showing.cartUrl });
    return programming;
  }

  function infoOf(key: string): SpaceShowingInfo | null {
    return seen.get(key) ?? deps.describe(key);
  }

  async function requireInfo(key: string, cinemaId: string): Promise<SpaceShowingInfo> {
    const known = infoOf(key);
    if (known !== null) return known;
    await deps.schedule.getOrLoad(spaceSlug(cinemaId), () => load(cinemaId));
    const loaded = seen.get(key);
    if (loaded === undefined) throw new ApiShapeError("space", `unknown session: ${key}`);
    return loaded;
  }

  return {
    chain: "space",
    programmingSource: "The Space",
    seatsSource: "The Space",
    async programmingDays(theatreSlug, days, fresh) {
      try {
        const cinemaId = cinemaIdOf(theatreSlug);
        const programming = await deps.schedule.getOrLoad(theatreSlug, () => load(cinemaId), { bypass: fresh });
        return days.map((day): DayResult => ({ day, showings: programming.get(day) ?? [] }));
      } catch (error) {
        return days.map((day): DayResult => ({ day, error }));
      }
    },
    programming: (theatreSlug) => load(cinemaIdOf(theatreSlug)),
    async seats(key, fresh) {
      const [cinemaId, sessionId] = parseSpaceKey(key);
      const info = await requireInfo(key, cinemaId);
      const read = await deps.seats.getOrLoad(key, () => deps.client.seats(cinemaId, sessionId), { bypass: fresh });
      const hallKey = spaceHallKey(cinemaId, read.screenName);
      const signature = read.seats.map((seat) => seat.id).sort().join(",");
      const previous = hallSeats.get(hallKey);
      hallSeats.set(hallKey, signature);
      const performance: PerformanceInfo = { key, hallKey, eventRef: "", screenName: read.screenName, startTime: info.startsAt, title: info.title, priceFrom: read.priceFrom };
      const hall: Hall = { key: hallKey, seats: read.seats, fetchedAt: deps.now() };
      const occupancy: Occupancy = { key, taken: read.taken };
      return { performance, hall, occupancy, hallChanged: previous !== undefined && previous !== signature };
    },
    cartUrl: (key) => infoOf(key)?.cartUrl ?? null,
  };
}

export async function buildSpaceVenues(client: SpaceClient, now: () => number): Promise<SpaceVenueList> {
  const theatres: Theatre[] = [];
  for (const cinema of await client.cinemas()) {
    const page = cinema.pageUrl === null ? null : await client.cinemaPage(cinema.pageUrl).catch(() => null);
    theatres.push(theatreOf(cinema, page));
  }
  if (theatres.length === 0) throw new ApiShapeError("space", "no cinemas");
  return { checkedAt: now(), theatres };
}

export function spaceVenuesDue(list: SpaceVenueList | null, now: number): boolean {
  return list === null || now - list.checkedAt >= VENUE_CHECK_MS;
}

export async function loadSpaceVenues(store: Store): Promise<SpaceVenueList | null> {
  try {
    const parsed = venueListSchema.safeParse(await store.readJson(SPACE_VENUE_FILE));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveSpaceVenues(store: Store, list: SpaceVenueList): Promise<void> {
  await store.writeJson(SPACE_VENUE_FILE, list);
}
