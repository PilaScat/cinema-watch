import { z } from "zod";
import { ApiShapeError, WebticError } from "./errors.js";
import type { HttpClient, Hall, Occupancy, PerformanceInfo, Seat, TakenStatus } from "./types.js";

export const WEBTIC_API_BASE = "https://uci-website-webtic-proxy-production-1042268733238.europe-west8.run.app/Api2";
export const WEBTIC_HEADERS = { Origin: "https://ucicinemas.it", Referer: "https://ucicinemas.it/" };
export const HALL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface HallStore {
  get(localId: number, screenId: number): Promise<Hall | null>;
  set(hall: Hall): Promise<void>;
}

export interface WebticClientOptions {
  hallStore: HallStore;
  now?: () => number;
}

export interface HallResult {
  hall: Hall;
  refreshed: boolean;
  changed: boolean;
}

const envelopeSchema = z.object({
  Data: z.unknown().optional(),
  Status: z.object({
    Success: z.boolean(),
    Message: z.string().nullish(),
    ReasonCode: z.number().nullish(),
  }),
});

const priceSchema = z.object({ TotalPrice: z.number().nullish() });

const sectorPriceSchema = z.object({
  PriceStartFrom: z.number().nullish(),
  Prices: z.array(priceSchema).nullish(),
});

const paymentModeSchema = z.object({ SectorPrices: z.array(sectorPriceSchema).nullish() });

const shoppingModeSchema = z.object({ PaymentModes: z.array(paymentModeSchema).nullish() });

const performanceDataSchema = z.object({
  Performance: z.object({
    LocalId: z.number(),
    EventId: z.number(),
    PerformanceId: z.number(),
    ScreenId: z.number(),
    ScreenName: z.string(),
    StartTime: z.string(),
  }),
  Event: z.object({ Title: z.string() }),
  Tickets: z.object({ ShoppingModes: z.array(shoppingModeSchema).nullish() }).nullish(),
});

const seatSchema = z.object({
  SeatId: z.string(),
  SeatType: z.string(),
  SectorId: z.string(),
  Row: z.number(),
  Column: z.number(),
});

const screenDataSchema = z.object({
  Screen: z.object({
    LocalId: z.number(),
    ScreenId: z.number(),
    Seats: z.array(seatSchema),
  }),
});

const occupancyDataSchema = z.object({
  Occupancy: z.object({
    LocalId: z.number(),
    PerformanceId: z.number(),
    Seats: z.array(z.object({ SeatId: z.string(), SeatStatus: z.string() })),
  }),
});

const takenStatuses: Record<string, TakenStatus> = { ACQUISTO: "sold", BLOCCATO: "blocked" };

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function unwrapData<T>(json: unknown, schema: z.ZodType<T>, what: string): T {
  const envelope = envelopeSchema.safeParse(json);
  if (!envelope.success) {
    throw new ApiShapeError("webtic", `${what}: envelope ${describeIssues(envelope.error)}`);
  }
  const { Status, Data } = envelope.data;
  if (!Status.Success) {
    throw new WebticError(Status.ReasonCode ?? null, Status.Message ?? "");
  }
  const data = schema.safeParse(Data);
  if (!data.success) {
    throw new ApiShapeError("webtic", `${what}: ${describeIssues(data.error)}`);
  }
  return data.data;
}

function minimum(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function lowestPrice(data: z.infer<typeof performanceDataSchema>): number | null {
  const sectorPrices = (data.Tickets?.ShoppingModes ?? [])
    .flatMap((mode) => mode.PaymentModes ?? [])
    .flatMap((payment) => payment.SectorPrices ?? []);
  const startFrom = sectorPrices.flatMap((sector) => sector.PriceStartFrom ?? []);
  if (startFrom.length > 0) return minimum(startFrom);
  const totals = sectorPrices
    .flatMap((sector) => sector.Prices ?? [])
    .flatMap((price) => price.TotalPrice ?? []);
  return minimum(totals);
}

export function parsePerformance(json: unknown): PerformanceInfo {
  const data = unwrapData(json, performanceDataSchema, "performance");
  const performance = data.Performance;
  return {
    localId: performance.LocalId,
    eventId: performance.EventId,
    performanceId: performance.PerformanceId,
    screenId: performance.ScreenId,
    screenName: performance.ScreenName,
    startTime: performance.StartTime,
    title: data.Event.Title,
    priceFrom: lowestPrice(data),
  };
}

export function parseSeatId(id: string): { rowLabel: string; number: number | null } {
  const slash = id.lastIndexOf("/");
  if (slash < 0) return { rowLabel: id, number: null };
  const rawNumber = id.slice(slash + 1);
  return {
    rowLabel: id.slice(0, slash),
    number: /^\d+$/.test(rawNumber) ? Number(rawNumber) : null,
  };
}

function toSeat(raw: z.infer<typeof seatSchema>): Seat {
  const { rowLabel, number } = parseSeatId(raw.SeatId);
  return {
    id: raw.SeatId,
    rowLabel,
    number,
    row: raw.Row,
    column: raw.Column,
    sector: raw.SectorId,
    type: raw.SeatType,
  };
}

export function parseHall(json: unknown, fetchedAt: number): Hall {
  const screen = unwrapData(json, screenDataSchema, "screen").Screen;
  return {
    localId: screen.LocalId,
    screenId: screen.ScreenId,
    seats: screen.Seats.map(toSeat),
    fetchedAt,
  };
}

export function parseOccupancy(json: unknown): Occupancy {
  const occupancy = unwrapData(json, occupancyDataSchema, "occupancy").Occupancy;
  const taken: Record<string, TakenStatus> = {};
  for (const seat of occupancy.Seats) {
    taken[seat.SeatId] = takenStatuses[seat.SeatStatus] ?? "other";
  }
  return { localId: occupancy.LocalId, performanceId: occupancy.PerformanceId, taken };
}

export function createMemoryHallStore(): HallStore {
  const halls = new Map<string, Hall>();
  const keyOf = (localId: number, screenId: number): string => `${localId}:${screenId}`;
  return {
    get: (localId, screenId) => Promise.resolve(halls.get(keyOf(localId, screenId)) ?? null),
    set: (hall) => {
      halls.set(keyOf(hall.localId, hall.screenId), hall);
      return Promise.resolve();
    },
  };
}

function assertPositiveIntegers(ids: Record<string, number>): void {
  for (const [name, value] of Object.entries(ids)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new ApiShapeError("webtic", `invalid ${name}: ${String(value)}`);
    }
  }
}

function seatIdSet(hall: Hall): Set<string> {
  return new Set(hall.seats.map((seat) => seat.id));
}

function sameMembers(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

function hasUnknownSeats(hall: Hall, occupancy: Occupancy): boolean {
  const known = seatIdSet(hall);
  return Object.keys(occupancy.taken).some((id) => !known.has(id));
}

export interface SeatTransport {
  performance(localId: number, performanceId: number): Promise<PerformanceInfo>;
  occupancy(localId: number, performanceId: number): Promise<Occupancy>;
  screen(localId: number, screenId: number, fetchedAt: number): Promise<Hall>;
}

export function createProxyTransport(http: HttpClient): SeatTransport {
  function post(path: string, body: Record<string, number>): Promise<unknown> {
    assertPositiveIntegers(body);
    return http.postJson(`${WEBTIC_API_BASE}${path}`, body, { headers: WEBTIC_HEADERS });
  }
  return {
    async performance(localId, performanceId) {
      return parsePerformance(await post("/Performance", { LocalId: localId, PerformanceId: performanceId }));
    },
    async occupancy(localId, performanceId) {
      return parseOccupancy(await post("/Occupancy", { LocalId: localId, PerformanceId: performanceId }));
    },
    async screen(localId, screenId, fetchedAt) {
      return parseHall(await post("/Screen", { LocalId: localId, ScreenId: screenId }), fetchedAt);
    },
  };
}

export function createWebticClient(http: HttpClient, options: WebticClientOptions) {
  return createSeatClient(createProxyTransport(http), options);
}

export function createSeatClient(transport: SeatTransport, options: WebticClientOptions) {
  const now = options.now ?? (() => Date.now());

  const performance = (localId: number, performanceId: number): Promise<PerformanceInfo> => transport.performance(localId, performanceId);

  const occupancy = (localId: number, performanceId: number): Promise<Occupancy> => transport.occupancy(localId, performanceId);

  async function downloadHall(localId: number, screenId: number, cached: Hall | null): Promise<HallResult> {
    const hall = await transport.screen(localId, screenId, now());
    await options.hallStore.set(hall);
    const changed = cached !== null && !sameMembers(seatIdSet(cached), seatIdSet(hall));
    return { hall, refreshed: true, changed };
  }

  async function hall(localId: number, screenId: number, current?: Occupancy): Promise<HallResult> {
    assertPositiveIntegers({ LocalId: localId, ScreenId: screenId });
    const cached = await options.hallStore.get(localId, screenId);
    const usable =
      cached !== null &&
      now() - cached.fetchedAt < HALL_TTL_MS &&
      (current === undefined || !hasUnknownSeats(cached, current));
    if (usable) return { hall: cached, refreshed: false, changed: false };
    return downloadHall(localId, screenId, cached);
  }

  return { performance, occupancy, hall };
}
