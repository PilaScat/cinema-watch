import type { Watcher } from "../watcher.js";

export interface HuntStatus {
  id: string;
  name: string;
  active: boolean;
  muted: boolean;
  showings: number;
  withSeats: number;
  freeInZone: number;
  lastRunAt: number | null;
  lastRunOk: boolean | null;
  nextRunAt: number | null;
}

export interface Status {
  status: "ok";
  version: string;
  latestVersion: string | null;
  telegramConfigured: boolean;
  activeHunts: number;
  showings: number;
  withSeats: number;
  hunts: HuntStatus[];
}

export function statusOf(watcher: Watcher, version: string, now: number): Status {
  const state = watcher.state();
  const hunts = watcher.config().hunts.map((hunt): HuntStatus => {
    const huntState = state.hunts[hunt.id];
    const showings = Object.values(huntState?.showings ?? {});
    return {
      id: hunt.id,
      name: hunt.name,
      active: hunt.enabled && hunt.archivedAt === null,
      muted: huntState?.mutedUntil !== undefined && huntState.mutedUntil !== null && huntState.mutedUntil > now,
      showings: showings.length,
      withSeats: showings.filter((showing) => showing.seats?.ok === true).length,
      freeInZone: showings.reduce((sum, showing) => sum + (showing.seats?.freeInZone ?? 0), 0),
      lastRunAt: huntState?.lastRun?.at ?? null,
      lastRunOk: huntState?.lastRun?.ok ?? null,
      nextRunAt: huntState?.nextRunAt ?? null,
    };
  });
  const active = hunts.filter((hunt) => hunt.active);
  return {
    status: "ok",
    version,
    latestVersion: state.latestVersion,
    telegramConfigured: watcher.botToken() !== null && watcher.primaryChat() !== null,
    activeHunts: active.length,
    showings: active.reduce((sum, hunt) => sum + hunt.showings, 0),
    withSeats: active.reduce((sum, hunt) => sum + hunt.withSeats, 0),
    hunts,
  };
}
