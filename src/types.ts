export interface HttpRequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface HttpClient {
  getJson(url: string, options?: HttpRequestOptions): Promise<unknown>;
  postJson(url: string, body: unknown, options?: HttpRequestOptions): Promise<unknown>;
}

export type IsoDay = string;

export type HhMm = string;

export interface Theatre {
  slug: string;
  name: string;
  city: string;
  province: string | null;
  region: string | null;
  isLuxe: boolean;
  screens: string[];
  lat: number | null;
  lon: number | null;
  chain: Chain;
}

export type Chain = "uci" | "webtic" | "space" | "t18";

export interface MovieRef {
  slug: string;
  title: string;
  poster: string | null;
}

export interface Showing {
  key: string;
  theatreSlug: string;
  movie: MovieRef;
  format: string;
  formatGroup: string;
  language: string | null;
  day: IsoDay;
  startsAt: string;
  time: HhMm;
  room: string;
  durationMinutes: number | null;
  cartUrl: string;
}

export interface CatalogMovie {
  slug: string;
  title: string;
  poster: string | null;
  firstDay: IsoDay | null;
  lastDay: IsoDay | null;
  formats: string[];
}

export interface MovieTheatre {
  slug: string;
  name: string;
  variants: number[];
}

export type DayWindow =
  | { kind: "fixed"; from: IsoDay; to: IsoDay }
  | { kind: "next"; days: number };

export interface ShowingFilter {
  movieSlugs?: string[];
  titleWords?: string[];
  formats?: string[];
  window?: DayWindow;
  timeFrom?: HhMm;
  timeTo?: HhMm;
  weekdays?: number[];
  languages?: string[];
}

export interface PerformanceInfo {
  key: string;
  hallKey: string;
  eventRef: string;
  screenName: string;
  startTime: string;
  title: string;
  priceFrom: number | null;
}

export interface Seat {
  id: string;
  rowLabel: string;
  number: number | null;
  row: number;
  column: number;
  sector: string;
  type: string;
}

export interface Hall {
  key: string;
  seats: Seat[];
  fetchedAt: number;
}

export type TakenStatus = "sold" | "blocked" | "other";

export interface Occupancy {
  key: string;
  taken: Record<string, TakenStatus>;
}

export type Zone =
  | { kind: "relative"; rowsFromPercent: number; rowsToPercent: number; centerPercent: number }
  | { kind: "absolute"; rows: string[]; seatFrom: number | null; seatTo: number | null };

export interface SeatRule {
  zone: Zone;
  together: number;
  sellableTypes: string[];
}

export interface SeatGroup {
  rowLabel: string;
  seatIds: string[];
  score: number;
}

export interface RowSummary {
  rowLabel: string;
  row: number;
  sellable: number;
  free: number;
  inZone: boolean;
}

export interface SeatAnalysis {
  sellable: number;
  free: number;
  taken: number;
  freeInZone: number;
  sellableInZone: number;
  rows: RowSummary[];
  zoneSeatIds: string[];
  groups: SeatGroup[];
  best: SeatGroup[];
  ok: boolean;
  unknownTypes: string[];
  unknownTakenIds: string[];
}

export type SeatState = "free" | "sold" | "blocked" | "reserved" | "accessible" | "best";

export interface HallLabels {
  screen: string;
  free: string;
  sold: string;
  blocked: string;
  reserved: string;
  accessible: string;
  best: string;
  zone: string;
}

export type ThemeName = "dark" | "light";

export interface HallRenderOptions {
  title: string;
  subtitle: string;
  labels: HallLabels;
  theme: ThemeName;
}
