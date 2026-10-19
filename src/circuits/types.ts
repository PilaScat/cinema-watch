import type { Chain, Hall, IsoDay, Occupancy, PerformanceInfo, Showing } from "../types.js";

export interface SeatView {
  performance: PerformanceInfo;
  hall: Hall;
  occupancy: Occupancy;
  hallChanged: boolean;
}

export type DayResult = { day: IsoDay; showings: Showing[] } | { day: IsoDay; error: unknown };

export interface Circuit {
  chain: Chain;
  programmingSource: string;
  seatsSource: string;
  programmingDays(theatreSlug: string, days: IsoDay[], fresh: boolean): Promise<DayResult[]>;
  programming(theatreSlug: string): Promise<Map<IsoDay, Showing[]>>;
  seats(showingKey: string, fresh: boolean): Promise<SeatView>;
  cartUrl(showingKey: string, performance: PerformanceInfo, movieSlug: string | undefined): string | null;
}
