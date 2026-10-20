import { fileURLToPath } from "node:url";
import type { Config } from "../../src/model.js";
import type { T18VenueList } from "../../src/circuits/t18.js";
import type { SpaceVenueList } from "../../src/circuits/the-space.js";
import type { VenueList } from "../../src/venues.js";
import { createApp } from "../../src/web/app.js";
import type { Harness } from "./harness.js";

export const ORIGIN = "http://localhost";
export const UCI_HOST = "myuci---uci-backend-production-nfluwp7wga-oc.a.run.app";
export const WEBTIC_HOST = "uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app";
export const PERFORMANCE = "5116-575978";

const publicDir = fileURLToPath(new URL("../../src/web/public/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../../assets/", import.meta.url));

export async function createWebApp(harness: Harness, options: { env?: NodeJS.ProcessEnv; mutate?: (config: Config) => void; publicDir?: string; venues?: VenueList | null; spaceVenues?: SpaceVenueList; t18Venues?: T18VenueList } = {}) {
  const config = await harness.seed(options.mutate, { ...(options.venues === undefined ? {} : { venues: options.venues }), ...(options.spaceVenues === undefined ? {} : { spaceVenues: options.spaceVenues }), ...(options.t18Venues === undefined ? {} : { t18Venues: options.t18Venues }) });
  const watcher = await harness.watcher({ env: options.env ?? {} });
  const instance = await createApp({
    watcher,
    version: "v2026.10.1",
    dataDir: harness.dataDir,
    env: options.env ?? {},
    now: () => harness.now(),
    publicDir: options.publicDir ?? publicDir,
    assetsDir,
  });
  return { instance, watcher, config, huntId: config.hunts[0]?.id ?? "" };
}

export function post(entries: Array<[string, string]> | Record<string, string> = [], headers: Record<string, string> = { origin: ORIGIN }) {
  const list = Array.isArray(entries) ? entries : Object.entries(entries);
  return { method: "POST", body: new URLSearchParams(list), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } };
}

export function huntForm(overrides: Record<string, string | string[]> = {}): Array<[string, string]> {
  const base: Record<string, string | string[]> = {
    name: "Dune IMAX Verona",
    theatre: ["uci-cinemas-verona"],
    movieKind: "slug",
    movieSlugs: "dune-parte-tre",
    format: ["IMAX"],
    windowKind: "fixed",
    windowFrom: "2026-12-15",
    windowTo: "2026-12-16",
    windowDays: "30",
    together: "3",
    threshold: "10",
    notify: ["newShowings", "seatsFreed"],
    enabled: "1",
    ...overrides,
  };
  return Object.entries(base).flatMap(([key, value]): Array<[string, string]> => (Array.isArray(value) ? value.map((item): [string, string] => [key, item]) : [[key, value]]));
}

export function scriptTags(html: string): string[] {
  const tags: string[] = [];
  let start = html.indexOf("<script");
  while (start !== -1) {
    const end = html.indexOf(">", start);
    tags.push(html.slice(start, end + 1));
    start = html.indexOf("<script", end);
  }
  return tags;
}

export function occupancyWithout(occupancy: unknown, seatIds: string[]): unknown {
  const copyOf = structuredClone(occupancy) as { Data: { Occupancy: { Seats: Array<{ SeatId: string }> } } };
  copyOf.Data.Occupancy.Seats = copyOf.Data.Occupancy.Seats.filter((seat) => !seatIds.includes(seat.SeatId));
  return copyOf;
}

export function occupancyWithTaken(occupancy: unknown, seatId: string): unknown {
  const copyOf = structuredClone(occupancy) as { Data: { Occupancy: { Seats: Array<{ SeatId: string; SeatStatus: string }> } } };
  copyOf.Data.Occupancy.Seats.push({ SeatId: seatId, SeatStatus: "ACQUISTO" });
  return copyOf;
}

export function interceptFetch(harness: Harness, handler: (url: URL, passthrough: () => Promise<Response>) => Promise<Response>): void {
  const original = harness.world.fetch;
  harness.world.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return handler(url, () => original(input, init));
  };
}

export function failPath(harness: Harness, matches: (url: URL) => boolean, status = 404): void {
  interceptFetch(harness, (url, passthrough) => (matches(url) ? Promise.resolve(new Response(JSON.stringify({ message: "down" }), { status, headers: { "content-type": "application/json" } })) : passthrough()));
}

export function rewriteJson(harness: Harness, matches: (url: URL) => boolean, rewrite: (json: unknown) => unknown): void {
  interceptFetch(harness, async (url, passthrough) => {
    const response = await passthrough();
    if (!matches(url)) return response;
    return new Response(JSON.stringify(rewrite(await response.json())), { status: response.status, headers: { "content-type": "application/json" } });
  });
}

export function mapKeys(json: unknown, key: string, value: unknown): unknown {
  if (Array.isArray(json)) return json.map((item) => mapKeys(item, key, value));
  if (typeof json !== "object" || json === null) return json;
  return Object.fromEntries(Object.entries(json).map(([name, item]) => [name, name === key ? value : mapKeys(item, key, value)]));
}
