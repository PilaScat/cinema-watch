import type { TtlCache } from "../cache.js";
import { ApiShapeError } from "../errors.js";
import type { IsoDay, Occupancy, PerformanceInfo, Showing } from "../types.js";
import { UCI_SITE, type createUciClient } from "../uci.js";
import type { createSeatClient } from "../webtic.js";
import { localIdOfSlug, webticCartUrl } from "../webtic-direct.js";
import type { Circuit, DayResult, SeatView } from "./types.js";

type UciClient = ReturnType<typeof createUciClient>;
type SeatClient = ReturnType<typeof createSeatClient>;

const LEGACY_KEY = /^(\d+)-(\d+)$/;

export interface LegacyCaches {
  programming: TtlCache<Showing[]>;
  schedule: TtlCache<Map<IsoDay, Showing[]>>;
  occupancy: TtlCache<Occupancy>;
  performance: TtlCache<PerformanceInfo>;
}

export function parseLegacyKey(key: string): [number, number] {
  const match = LEGACY_KEY.exec(key);
  if (!match) throw new ApiShapeError("webtic", `invalid key: ${key}`);
  return [Number(match[1]), Number(match[2])];
}

async function legacySeats(client: SeatClient, caches: LegacyCaches, key: string, fresh: boolean): Promise<SeatView> {
  const [localId, performanceId] = parseLegacyKey(key);
  const performance = await caches.performance.getOrLoad(key, () => client.performance(localId, performanceId));
  const occupancy = await caches.occupancy.getOrLoad(key, () => client.occupancy(localId, performanceId), { bypass: fresh });
  const [, screenId] = parseLegacyKey(performance.hallKey);
  const { hall, changed } = await client.hall(localId, screenId, occupancy);
  return { performance, hall, occupancy, hallChanged: changed };
}

export function createUciCircuit(deps: { uci: UciClient; seats: SeatClient; caches: LegacyCaches }): Circuit {
  return {
    chain: "uci",
    programmingSource: "UCI",
    seatsSource: "Webtic",
    async programmingDays(theatreSlug, days, fresh) {
      const results: DayResult[] = [];
      for (const day of days) {
        try {
          const showings = await deps.caches.programming.getOrLoad(`${theatreSlug}|${day}`, () => deps.uci.programmingDay(theatreSlug, day), { bypass: fresh });
          results.push({ day, showings });
        } catch (error) {
          results.push({ day, error });
        }
      }
      return results;
    },
    programming: (theatreSlug) => deps.uci.programmingAll(theatreSlug),
    seats: (key, fresh) => legacySeats(deps.seats, deps.caches, key, fresh),
    cartUrl(key, performance, movieSlug) {
      if (movieSlug === undefined) return null;
      const [localId, performanceId] = parseLegacyKey(key);
      return `${UCI_SITE}/movies/${movieSlug}/acquista/${localId}/${performance.eventRef}/${performanceId}`;
    },
  };
}

export interface WebticCircuitDeps {
  roundScheduling(localId: number): Promise<Map<IsoDay, Showing[]>>;
  scheduling(localId: number): Promise<Map<IsoDay, Showing[]>>;
  knows(localId: number): boolean;
  seats: SeatClient;
  caches: LegacyCaches;
}

function webticLocalId(theatreSlug: string): number {
  const localId = localIdOfSlug(theatreSlug);
  if (localId === null) throw new ApiShapeError("webtic", `not a Webtic cinema: ${theatreSlug}`);
  return localId;
}

export function createWebticCircuit(deps: WebticCircuitDeps): Circuit {
  return {
    chain: "webtic",
    programmingSource: "Webtic",
    seatsSource: "Webtic",
    async programmingDays(theatreSlug, days, fresh) {
      try {
        const localId = webticLocalId(theatreSlug);
        const schedule = await deps.caches.schedule.getOrLoad(theatreSlug, () => deps.roundScheduling(localId), { bypass: fresh });
        return days.map((day) => ({ day, showings: schedule.get(day) ?? [] }));
      } catch (error) {
        return days.map((day) => ({ day, error }));
      }
    },
    async programming(theatreSlug) {
      const localId = webticLocalId(theatreSlug);
      if (!deps.knows(localId)) throw new ApiShapeError("webtic", `unknown cinema: ${theatreSlug}`);
      return deps.scheduling(localId);
    },
    seats: (key, fresh) => legacySeats(deps.seats, deps.caches, key, fresh),
    cartUrl(key, performance) {
      const [localId, performanceId] = parseLegacyKey(key);
      return webticCartUrl(localId, Number(performance.eventRef), performanceId);
    },
  };
}
