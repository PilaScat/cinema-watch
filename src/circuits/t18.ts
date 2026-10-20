import { z } from "zod";
import type { TtlCache } from "../cache.js";
import { ApiShapeError, HttpError } from "../errors.js";
import { isT18Host } from "../keys.js";
import type { GuardedFetch } from "../http.js";
import { regionOfPostalCode, regionOfProvince } from "../regions.js";
import type { createStore } from "../store.js";
import type { HallStore } from "../webtic.js";
import { parseTitle } from "../webtic-direct.js";
import type { CatalogMovie, Hall, IsoDay, Occupancy, PerformanceInfo, Seat, Showing, TakenStatus, Theatre } from "../types.js";
import type { Circuit, DayResult } from "./types.js";

type Store = ReturnType<typeof createStore>;

export const T18_DOMAIN = "18tickets.it";
export const T18_VENUE_FILE = "t18-venues.json";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const T18_SLUG = /^t18-[a-z0-9-]+$/;
const T18_KEY = new RegExp(`^(t18-[a-z0-9-]+)-(${UUID})$`);
const VENUE_CHECK_MS = 7 * 24 * 60 * 60 * 1000;
const HALL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_TIMEOUT_MS = 20_000;
const DAY_HEADER = /(\d{2})\/(\d{2})\/(\d{4})/;
const DURATION = /\s*\((\d{1,2})H(\d{2})'\)\s*/i;
const ORIGINAL_MARK = /[\s-]*\bV\.\s?O\.(?:\s?S\.)?(?=\s|$|\()/i;
const ORIGINAL_LABELS = new Set(["INGLESE", "LINGUA ORIGINALE", "V.O.", "V.O.S.", "VERSIONE ORIGINALE"]);
const SCREEN_FORMATS = ["IMAX", "4DX", "3D"];
const EDITIONS = ["INFINITY VISION"];
const BLOCKED_LISTS = ["locked", "reserved", "quarantined", "preemption", "mine"] as const;
const ROME_CLOCK = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

export function t18Slug(host: string): string {
  return `t18-${host.slice(0, -(T18_DOMAIN.length + 1)).replaceAll(".", "-")}`;
}

export function isT18Slug(slug: string): boolean {
  return T18_SLUG.test(slug);
}

export function isT18Key(key: string): boolean {
  return T18_KEY.test(key);
}

export function tenantOf(host: string): string {
  const labels = host.split(".");
  return labels[labels.length - 3] ?? host;
}

function parseT18Key(key: string): [string, string] {
  const match = T18_KEY.exec(key);
  if (!match) throw new ApiShapeError("t18", `invalid key: ${key}`);
  return [match[1] as string, match[2] as string];
}

export function t18Key(theatreSlug: string, uuid: string): string {
  return `${theatreSlug}-${uuid}`;
}

function romeDateTime(epochMs: number): string {
  const parts = Object.fromEntries(ROME_CLOCK.formatToParts(new Date(epochMs)).map((part) => [part.type, part.value]));
  return `${String(parts["year"])}-${String(parts["month"])}-${String(parts["day"])}T${String(parts["hour"])}:${String(parts["minute"])}:00`;
}

function dayOfHeader(header: string): IsoDay | null {
  const match = DAY_HEADER.exec(header);
  return match ? `${match[3] as string}-${match[2] as string}-${match[1] as string}` : null;
}

function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export interface T18Projection {
  uuid: string;
  day: IsoDay;
  startsAt: string;
  time: string;
  room: string;
  cartUrl: string;
}

export interface T18Film {
  filmId: string;
  slug: string;
  title: string;
  poster: string | null;
  format: string;
  formatGroup: string;
  language: string;
  durationMinutes: number | null;
  projections: T18Projection[];
}

export interface T18Home {
  title: string;
  places: string[];
  address: string | null;
  films: T18Film[];
  cinemaHosts: string[];
}

function formatOf(label: string, title: string): { format: string; group: string } {
  const values = `${label} ${title}`.toUpperCase();
  const group = SCREEN_FORMATS.find((format) => new RegExp(`(^|[^A-Z0-9])${format}([^A-Z0-9]|$)`).test(values)) ?? "2D";
  const edition = EDITIONS.find((name) => values.includes(name));
  return { format: edition ? `${group} - ${edition}` : group, group };
}

function languageOf(label: string, title: string, field: string): string {
  if (ORIGINAL_LABELS.has(label.toUpperCase()) || ORIGINAL_MARK.test(title)) return "VO";
  return field === "" || field.toLowerCase().startsWith("italian") ? "ITA" : "VO";
}

function parseFilmBlock(block: string, host: string): T18Film | null {
  const titleMatch = /class='movie__title'[^>]*\/film\/(\d+)'>\s*([^<]+)</.exec(block);
  if (!titleMatch) return null;
  const filmId = titleMatch[1] as string;
  const rawTitle = decodeEntities(titleMatch[2] as string).trim();
  const label = textOf(/class='film-label[^']*'>([^<]*)</.exec(block)?.[1] ?? "");
  const field = textOf(/Lingua:\s*<\/strong>([^<]*)</.exec(block)?.[1] ?? "");
  const duration = DURATION.exec(rawTitle);
  const bare = rawTitle.replace(DURATION, " ").replace(ORIGINAL_MARK, " ").replace(/\s+/g, " ").trim();
  const parsed = parseTitle(bare);
  const { format, group } = formatOf(label, rawTitle);
  const projections: T18Projection[] = [];
  let day: IsoDay | null = null;
  const pattern = new RegExp(
    `fa-calendar'></i>\\s*([^\\n<]+)|<a data-time='(\\d+)' href='(https://([a-z0-9.-]+)/film/\\d+/(${UUID})#theater-init)'>\\s*<li[^>]*>\\s*<i[^>]*></i>\\s*(\\d{2}:\\d{2})\\s*<br>\\s*([^<]*?)\\s*</li>`,
    "g",
  );
  for (const match of block.matchAll(pattern)) {
    if (match[1] !== undefined) {
      day = dayOfHeader(match[1]);
      continue;
    }
    if (day === null) continue;
    const linkHost = match[4] as string;
    projections.push({
      uuid: match[5] as string,
      day,
      startsAt: romeDateTime(Number(match[2])),
      time: match[6] as string,
      room: decodeEntities(match[7] as string).trim(),
      cartUrl: isT18Host(linkHost) ? (match[3] as string) : `https://${host}/film/${filmId}/${match[5] as string}#theater-init`,
    });
  }
  return {
    filmId,
    slug: parsed.slug === "" ? `film-${filmId}` : parsed.slug,
    title: parsed.title,
    poster: /<img alt='[^']*' class='img-fluid[^']*' src='(https:\/\/[^']+)'/.exec(block)?.[1] ?? null,
    format,
    formatGroup: group,
    language: languageOf(label, rawTitle, field),
    durationMinutes: duration ? Number(duration[1]) * 60 + Number(duration[2]) : null,
    projections,
  };
}

export function parseHome(html: string, host: string): T18Home {
  const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "").trim();
  const places = [...new Set([...html.matchAll(/time-select__place'>[\s\S]*?<\/a>\s*([^<]+)<\/div>/g)].map((match) => decodeEntities(match[1] as string).trim()))];
  const address = /maps\.google\.com\/\?q=([^'"]+)['"]/.exec(html)?.[1];
  const films = html
    .split("<div class='movie movie--preview'>")
    .slice(1)
    .flatMap((block) => parseFilmBlock(block, host) ?? []);
  const escaped = host.replaceAll(".", "\\.");
  const cinemaHosts = [...new Set([...html.matchAll(new RegExp(`href=["']https://((?:${LABEL}\\.)+${escaped})/?["']`, "g"))].map((match) => match[1] as string))].filter(
    (sub) => isT18Host(sub) && !sub.startsWith("www."),
  );
  return { title, places, address: address === undefined ? null : decodeEntities(address).trim(), films, cinemaHosts };
}

export function placeOf(address: string | null): { city: string; province: string | null; region: string | null } {
  const parts = (address ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const province = /^[A-Z]{2}$/.test(last) ? last : null;
  const city = province !== null ? (parts[parts.length - 2] ?? "") : "";
  const postalCode = /\b(\d{5})\b/.exec(address ?? "")?.[1];
  const region = (province !== null ? regionOfProvince(province) : null) ?? (postalCode === undefined ? null : regionOfPostalCode(postalCode));
  return { city, province, region };
}

export function programmingOf(home: T18Home, theatreSlug: string): Map<IsoDay, Showing[]> {
  const programming = new Map<IsoDay, Showing[]>();
  for (const film of home.films) {
    for (const projection of film.projections) {
      const showing: Showing = {
        key: t18Key(theatreSlug, projection.uuid),
        theatreSlug,
        movie: { slug: film.slug, title: film.title, poster: film.poster },
        format: film.format,
        formatGroup: film.formatGroup,
        language: film.language,
        day: projection.day,
        startsAt: projection.startsAt,
        time: projection.time,
        room: projection.room,
        durationMinutes: film.durationMinutes,
        cartUrl: projection.cartUrl,
      };
      programming.set(projection.day, [...(programming.get(projection.day) ?? []), showing]);
    }
  }
  return programming;
}

export function moviesOfHome(home: T18Home): CatalogMovie[] {
  const movies = new Map<string, CatalogMovie>();
  for (const film of home.films) {
    const days = film.projections.map((projection) => projection.day).sort();
    const known = movies.get(film.slug);
    const formats = [...new Set([...(known?.formats ?? []), film.format])];
    const firstDay = [known?.firstDay, days[0]].filter((day): day is string => typeof day === "string").sort()[0] ?? null;
    const lastDay = [known?.lastDay, days[days.length - 1]].filter((day): day is string => typeof day === "string").sort().pop() ?? null;
    movies.set(film.slug, { slug: film.slug, title: film.title, poster: known?.poster ?? film.poster, firstDay, lastDay, formats });
  }
  return [...movies.values()];
}

export function parseFilmPage(html: string): Map<string, string> {
  const theaters = new Map<string, string>();
  for (const tag of html.matchAll(/<[a-z]+ class='film-projection[^>]*>/g)) {
    const id = new RegExp(`data-id='(${UUID})'`).exec(tag[0])?.[1];
    const theater = new RegExp(`data-theater='(${UUID})'`).exec(tag[0])?.[1];
    if (id !== undefined && theater !== undefined) theaters.set(id, theater);
  }
  return theaters;
}

export function parseTheater(svg: string): Seat[] {
  const seats: Seat[] = [];
  for (const match of svg.matchAll(/<g class='(posto[^']*)'([^>]*)>/g)) {
    const classes = (match[1] as string).split(/\s+/);
    if (classes.includes("userhide")) continue;
    const attributes = Object.fromEntries([...(match[2] as string).matchAll(/([a-z-]+)='([^']*)'/g)].map((pair) => [pair[1] as string, decodeEntities(pair[2] as string)]));
    const position = /^g_(\d+)_(\d+)$/.exec(attributes["id"] ?? "");
    if (!position) continue;
    const label = (attributes["data-seat"] ?? "").trim();
    seats.push({
      id: `${position[1] as string}_${position[2] as string}`,
      rowLabel: (attributes["data-row"] ?? "").trim(),
      number: /^\d+$/.test(label) ? Number(label) : null,
      row: Number(position[1]),
      column: Number(position[2]),
      sector: attributes["data-area"] ?? "",
      type: classes.includes("special") ? "RISERVATO" : "STANDARD",
    });
  }
  if (seats.length === 0) throw new ApiShapeError("t18", "theater: no seats");
  return seats;
}

const pointSchema = z.object({ x: z.number().int(), y: z.number().int() });
const pointsSchema = z.array(z.unknown()).catch([]);
const seatStateSchema = z.object({
  bought: pointsSchema,
  locked: pointsSchema,
  reserved: pointsSchema,
  quarantined: pointsSchema,
  preemption: pointsSchema,
  mine: pointsSchema,
  total: z.number().optional(),
});

export function parseSeatState(json: unknown): Record<string, TakenStatus> {
  const parsed = seatStateSchema.safeParse(json);
  if (!parsed.success || parsed.data.total === undefined) throw new ApiShapeError("t18", "seats: unexpected shape");
  const taken: Record<string, TakenStatus> = {};
  const mark = (items: unknown[], status: TakenStatus) => {
    for (const item of items) {
      const point = pointSchema.safeParse(item);
      if (point.success) taken[`${String(point.data.y)}_${String(point.data.x)}`] ??= status;
    }
  };
  mark(parsed.data.bought, "sold");
  for (const list of BLOCKED_LISTS) mark(parsed.data[list], "blocked");
  return taken;
}

export interface Pacer {
  turn(tenant: string): Promise<void>;
  cooldown(tenant: string): void;
}

export function createPacer(options: { intervalMs: number; cooldownMs: number; now: () => number; sleep: (ms: number) => Promise<void> }): Pacer {
  const nextAt = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();
  return {
    turn(tenant) {
      const mine = (chains.get(tenant) ?? Promise.resolve()).then(async () => {
        const wait = (nextAt.get(tenant) ?? 0) - options.now();
        if (wait > 0) await options.sleep(wait);
        nextAt.set(tenant, options.now() + options.intervalMs);
      });
      chains.set(tenant, mine);
      return mine;
    },
    cooldown(tenant) {
      nextAt.set(tenant, Math.max(nextAt.get(tenant) ?? 0, options.now() + options.cooldownMs));
    },
  };
}

export interface T18ClientDeps {
  fetch: GuardedFetch;
  pacer: Pacer;
  userAgent: string;
}

export type T18Page = { kind: "page"; html: string } | { kind: "redirect"; location: string };

export function createT18Client(deps: T18ClientDeps) {
  async function request(host: string, path: string, paced: boolean): Promise<Response> {
    if (!isT18Host(host)) throw new HttpError("host", host, `Host not allowed: ${host}`);
    if (paced) await deps.pacer.turn(tenantOf(host));
    let response: Response;
    try {
      response = await deps.fetch(`https://${host}${path}`, { headers: { "User-Agent": deps.userAgent }, redirect: "manual", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) });
    } catch (cause) {
      if (cause instanceof HttpError) throw cause;
      throw new HttpError("network", host, cause instanceof Error ? cause.message : "Network error");
    }
    if (response.status === 429) deps.pacer.cooldown(tenantOf(host));
    return response;
  }

  async function text(host: string, path: string): Promise<string> {
    const response = await request(host, path, true);
    if (!response.ok) throw new HttpError("status", host, `Status ${response.status}`, response.status);
    return response.text();
  }

  return {
    async page(host: string, path = "/"): Promise<T18Page> {
      const response = await request(host, path, true);
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location !== null) return { kind: "redirect", location };
      if (!response.ok) throw new HttpError("status", host, `Status ${response.status}`, response.status);
      return { kind: "page", html: await response.text() };
    },
    home: async (host: string) => parseHome(await text(host, "/"), host),
    theaters: async (host: string, filmId: string) => parseFilmPage(await text(host, `/film/${filmId}`)),
    theater: async (host: string, theaterUuid: string) => parseTheater(await text(host, `/theater/${theaterUuid}.svg`)),
    async seats(host: string, projectionUuid: string): Promise<Record<string, TakenStatus>> {
      const response = await request(host, `/seats/${projectionUuid}`, false);
      if (!response.ok) throw new HttpError("status", host, `Status ${response.status}`, response.status);
      let json: unknown;
      try {
        json = JSON.parse(await response.text());
      } catch {
        throw new HttpError("parse", host, "Response is not JSON");
      }
      return parseSeatState(json);
    },
  };
}

export type T18Client = ReturnType<typeof createT18Client>;

export interface T18Venue {
  host: string;
  theatre: Theatre;
  movies: CatalogMovie[];
}

export interface T18VenueList {
  checkedAt: number;
  checkedHosts: string[];
  venues: T18Venue[];
}

const venueListSchema = z.object({
  checkedAt: z.number(),
  checkedHosts: z.array(z.string()).catch([]),
  venues: z.array(
    z.object({
      host: z.string().refine(isT18Host),
      theatre: z.object({
        slug: z.string().regex(T18_SLUG),
        name: z.string(),
        city: z.string(),
        province: z.string().nullable(),
        region: z.string().nullable(),
        isLuxe: z.boolean(),
        screens: z.array(z.string()),
        lat: z.number().nullable(),
        lon: z.number().nullable(),
        chain: z.literal("t18"),
      }),
      movies: z.array(
        z.object({
          slug: z.string(),
          title: z.string(),
          poster: z.string().nullable(),
          firstDay: z.string().nullable(),
          lastDay: z.string().nullable(),
          formats: z.array(z.string()),
        }),
      ),
    }),
  ),
});

export function venueOf(host: string, home: T18Home): T18Venue {
  const place = placeOf(home.address);
  const name = home.places.length === 1 ? (home.places[0] as string) : home.title || host;
  return {
    host,
    theatre: { slug: t18Slug(host), name, city: place.city, province: place.province, region: place.region, isLuxe: false, screens: [], lat: null, lon: null, chain: "t18" },
    movies: moviesOfHome(home),
  };
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return error.kind === "timeout" || error.kind === "network" || (error.status !== null && (error.status === 429 || error.status >= 500));
}

function isGroup(home: T18Home): boolean {
  return home.cinemaHosts.length >= 2 || home.places.length > 1;
}

export interface T18CheckOptions {
  hosts: string[];
  previous: T18VenueList | null;
  now: () => number;
  stopped?: () => boolean;
  onVenue?: (venue: T18Venue) => void;
}

export async function buildT18Venues(client: T18Client, options: T18CheckOptions): Promise<T18VenueList> {
  const queue = [...new Set(options.hosts.filter(isT18Host))];
  const seen = new Set(queue);
  const previous = new Map((options.previous?.venues ?? []).map((venue) => [venue.host, venue]));
  const venues: T18Venue[] = [];
  const retried = new Set<string>();
  const enqueue = (hosts: string[]) => {
    for (const host of hosts) {
      if (!seen.has(host) && isT18Host(host)) {
        seen.add(host);
        queue.push(host);
      }
    }
  };
  for (let index = 0; index < queue.length && !options.stopped?.(); index += 1) {
    const host = queue[index] as string;
    try {
      const page = await client.page(host);
      if (page.kind === "redirect") {
        const target = new URL(page.location, `https://${host}`);
        if (target.hostname !== host || !target.pathname.startsWith("/select_cinema")) continue;
        const select = await client.page(host, `${target.pathname}${target.search}`);
        if (select.kind === "page") enqueue(parseHome(select.html, host).cinemaHosts);
        continue;
      }
      const home = parseHome(page.html, host);
      if (isGroup(home)) {
        enqueue(home.cinemaHosts);
        continue;
      }
      const venue = venueOf(host, home);
      venues.push(venue);
      options.onVenue?.(venue);
    } catch (error) {
      if (isTransient(error) && !retried.has(host)) {
        retried.add(host);
        queue.push(host);
        continue;
      }
      const kept = previous.get(host);
      if (kept) venues.push(kept);
    }
  }
  if (options.stopped?.()) throw new ApiShapeError("t18", "check stopped");
  if (venues.length === 0) throw new ApiShapeError("t18", "no cinemas");
  return { checkedAt: options.now(), checkedHosts: [...seen], venues };
}

export function t18VenuesDue(list: T18VenueList | null, now: number): boolean {
  return list === null || now - list.checkedAt >= VENUE_CHECK_MS;
}

export async function loadT18Venues(store: Store): Promise<T18VenueList | null> {
  try {
    const parsed = venueListSchema.safeParse(await store.readJson(T18_VENUE_FILE));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function saveT18Venues(store: Store, list: T18VenueList): Promise<void> {
  await store.writeJson(T18_VENUE_FILE, list);
}

export interface T18ShowingInfo {
  host: string;
  filmId: string;
  startsAt: string;
  title: string;
  room: string;
  cartUrl: string;
}

export interface T18CircuitDeps {
  client: T18Client;
  hostOf(theatreSlug: string): string | null;
  homes: TtlCache<T18Home>;
  theaters: TtlCache<Map<string, string>>;
  hallStore: HallStore;
  describe(key: string): { theatreSlug: string; startsAt: string; title: string; room: string; cartUrl: string } | null;
  onHome?: (theatreSlug: string, home: T18Home) => void;
  now: () => number;
}

function filmIdOf(cartUrl: string): string | null {
  return /\/film\/(\d+)\//.exec(cartUrl)?.[1] ?? null;
}

export function createT18Circuit(deps: T18CircuitDeps): Circuit {
  const seen = new Map<string, T18ShowingInfo>();

  function hostOf(theatreSlug: string): string {
    const host = deps.hostOf(theatreSlug);
    if (host === null) throw new ApiShapeError("t18", `unknown cinema: ${theatreSlug}`);
    return host;
  }

  async function load(theatreSlug: string, fresh: boolean): Promise<Map<IsoDay, Showing[]>> {
    const host = hostOf(theatreSlug);
    const home = await deps.homes.getOrLoad(theatreSlug, () => deps.client.home(host), { bypass: fresh });
    deps.onHome?.(theatreSlug, home);
    for (const film of home.films) {
      for (const projection of film.projections) {
        seen.set(t18Key(theatreSlug, projection.uuid), { host, filmId: film.filmId, startsAt: projection.startsAt, title: film.title, room: projection.room, cartUrl: projection.cartUrl });
      }
    }
    return programmingOf(home, theatreSlug);
  }

  async function infoOf(key: string): Promise<T18ShowingInfo> {
    const known = seen.get(key);
    if (known) return known;
    const [theatreSlug] = parseT18Key(key);
    const described = deps.describe(key);
    const filmId = described ? filmIdOf(described.cartUrl) : null;
    if (described && filmId !== null) {
      return { host: hostOf(theatreSlug), filmId, startsAt: described.startsAt, title: described.title, room: described.room, cartUrl: described.cartUrl };
    }
    await load(theatreSlug, false);
    const loaded = seen.get(key);
    if (!loaded) throw new ApiShapeError("t18", `unknown projection: ${key}`);
    return loaded;
  }

  async function hallOf(hallKey: string, info: T18ShowingInfo, theaterUuid: string, taken: Record<string, TakenStatus>, fresh: boolean): Promise<{ hall: Hall; changed: boolean }> {
    const stored = await deps.hallStore.get(hallKey);
    const covers = (hall: Hall) => {
      const ids = new Set(hall.seats.map((seat) => seat.id));
      return Object.keys(taken).every((id) => ids.has(id));
    };
    if (stored && !fresh && deps.now() - stored.fetchedAt < HALL_TTL_MS && covers(stored)) return { hall: stored, changed: false };
    const hall: Hall = { key: hallKey, seats: await deps.client.theater(info.host, theaterUuid), fetchedAt: deps.now() };
    await deps.hallStore.set(hall);
    const signature = (seats: Seat[]) => seats.map((seat) => seat.id).sort().join(",");
    return { hall, changed: stored !== null && signature(stored.seats) !== signature(hall.seats) };
  }

  return {
    chain: "t18",
    programmingSource: "18Tickets",
    seatsSource: "18Tickets",
    async programmingDays(theatreSlug, days, fresh) {
      try {
        const programming = await load(theatreSlug, fresh);
        return days.map((day): DayResult => ({ day, showings: programming.get(day) ?? [] }));
      } catch (error) {
        return days.map((day): DayResult => ({ day, error }));
      }
    },
    programming: (theatreSlug) => load(theatreSlug, false),
    async seats(key, fresh) {
      const [theatreSlug, uuid] = parseT18Key(key);
      const info = await infoOf(key);
      const theaters = await deps.theaters.getOrLoad(`${info.host}/${info.filmId}`, () => deps.client.theaters(info.host, info.filmId));
      const theaterUuid = theaters.get(uuid);
      if (theaterUuid === undefined) throw new ApiShapeError("t18", `no hall for ${key}`);
      const taken = await deps.client.seats(info.host, uuid);
      const hallKey = t18Key(theatreSlug, theaterUuid);
      const { hall, changed } = await hallOf(hallKey, info, theaterUuid, taken, fresh);
      const performance: PerformanceInfo = { key, hallKey, eventRef: info.filmId, screenName: info.room, startTime: info.startsAt, title: info.title, priceFrom: null };
      const occupancy: Occupancy = { key, taken };
      return { performance, hall, occupancy, hallChanged: changed };
    },
    cartUrl: (key) => seen.get(key)?.cartUrl ?? deps.describe(key)?.cartUrl ?? null,
  };
}
