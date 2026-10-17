import type {
  DayWindow,
  HhMm,
  IsoDay,
  MovieRef,
  PerformanceInfo,
  SeatAnalysis,
  SeatGroup,
  Showing,
  Zone,
} from "./types.js";

export const CONFIG_SCHEMA_VERSION = 2;
export const STATE_SCHEMA_VERSION = 1;

export type AbsoluteZone = Extract<Zone, { kind: "absolute" }>;

export type MovieTarget =
  | { kind: "slug"; slugs: string[] }
  | { kind: "title"; words: string[]; confirmedSlugs: string[] };

export interface NotifyFlags {
  newShowings: boolean;
  seatsFreed: boolean;
  lastSeats: boolean;
  cancelled: boolean;
  moved: boolean;
  movieAppeared: boolean;
  digest: boolean;
}

export interface Hunt {
  id: string;
  name: string;
  enabled: boolean;
  archivedAt: string | null;
  theatres: string[];
  movie: MovieTarget;
  formats: string[];
  window: DayWindow;
  timeFrom: HhMm | null;
  timeTo: HhMm | null;
  weekdays: number[] | null;
  languages: string[] | null;
  zone: Zone;
  hallZones: Record<string, AbsoluteZone>;
  together: number;
  intervalMinutes: number | null;
  lastSeatsThreshold: number;
  notify: NotifyFlags;
  extraChatIds: string[];
}

export interface Settings {
  telegram: { token: string | null; chatId: string | null };
  publicUrl: string | null;
  defaultIntervalMinutes: number;
  quietHours: { from: HhMm; to: HhMm } | null;
  digest: { enabled: boolean; time: HhMm };
  albumSize: number;
  defaultLastSeatsThreshold: number;
  sellableTypes: string[];
  defaultZone: Zone;
  home: { lat: number; lon: number } | null;
  radiusKm: number | null;
}

export interface Config {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  settings: Settings;
  hunts: Hunt[];
}

export interface SeatSummary {
  free: number;
  sellable: number;
  freeInZone: number;
  sellableInZone: number;
  ok: boolean;
  best: SeatGroup[];
}

export interface ShowingSnapshot {
  key: string;
  localId: number;
  eventId: number;
  performanceId: number;
  theatreSlug: string;
  movieSlug: string;
  movieTitle: string;
  format: string;
  formatGroup: string;
  language: string | null;
  day: IsoDay;
  startsAt: string;
  time: HhMm;
  room: string;
  cartUrl: string;
  screenId: number | null;
  screenName: string | null;
  priceFrom: number | null;
  seats: SeatSummary | null;
}

export interface ShowingState extends ShowingSnapshot {
  firstSeenAt: number;
  lastSeenAt: number;
  missingRounds: number;
  zoneSignature: string | null;
  okNotifiedAt: number | null;
  okBaseline: boolean | null;
  belowThreshold: boolean;
}

export interface HuntState {
  initialized: boolean;
  showings: Record<string, ShowingState>;
  seenMovieSlugs: string[];
  pendingMovieSlugs: string[];
  mutedUntil: number | null;
  nextRunAt: number | null;
  lastRun: { at: number; ok: boolean; error: string | null; showings: number } | null;
  daysSeen: string[];
  manualRunAt: number | null;
  errorNotifiedDay: IsoDay | null;
  hallsToReconfirm: string[];
}

export interface State {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  hunts: Record<string, HuntState>;
  lastDigestDate: IsoDay | null;
  lastVersionCheckAt: number | null;
  latestVersion: string | null;
  historyDays: Record<string, IsoDay>;
  publicUrlCheck: { url: string; accepted: boolean } | null;
}

export interface ObservedShowing {
  showing: Showing;
  performance: PerformanceInfo | null;
  analysis: SeatAnalysis | null;
  zoneSignature: string | null;
}

export interface RoundObservation {
  now: Date;
  showings: ObservedShowing[];
  daysWithShowings: Array<{ theatreSlug: string; day: IsoDay }>;
  daysChecked: Array<{ theatreSlug: string; day: IsoDay }>;
  allKeys: string[];
  moviesSeen: Array<{ movie: MovieRef; theatreSlug: string }>;
}

export type HuntEvent =
  | { kind: "newShowing"; showing: ShowingSnapshot }
  | { kind: "seatsFreed"; showing: ShowingSnapshot; groups: SeatGroup[] }
  | { kind: "lastSeats"; showing: ShowingSnapshot; freeInZone: number }
  | { kind: "cancelled"; showing: ShowingSnapshot }
  | { kind: "moved"; from: ShowingSnapshot; to: ShowingSnapshot }
  | { kind: "movieAppeared"; movie: MovieRef; theatreSlug: string };

export interface RoundResult {
  state: HuntState;
  events: HuntEvent[];
}

export interface InlineButton {
  text: string;
  url?: string;
  callbackData?: string;
}

export type OutgoingMessage =
  | { kind: "photo"; chatId: string; showingKey: string; caption: string }
  | { kind: "album"; chatId: string; items: Array<{ showingKey: string; caption: string }> }
  | { kind: "text"; chatId: string; text: string; keyboard: InlineButton[][] | null };

export interface SentResult {
  ok: boolean;
  messageIds: number[];
  error: string | null;
}
