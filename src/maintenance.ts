import { addDays, romeNow } from "./dates.js";
import type { Config, State } from "./model.js";

export const RETENTION_DAYS = 30;
export const VERSION_CHECK_MS = 24 * 60 * 60_000;

function cutoffDay(at: number): string {
  return addDays(romeNow(new Date(at)).day, -RETENTION_DAYS);
}

export function expiredHistoryKeys(state: State, at: number): string[] {
  const cutoff = cutoffDay(at);
  return Object.entries(state.historyDays)
    .filter(([, day]) => day < cutoff)
    .map(([key]) => key);
}

export function prunedState(state: State, config: Config, at: number): State {
  const rome = romeNow(new Date(at));
  const nowLocal = `${rome.day}T${rome.time}`;
  const cutoff = cutoffDay(at);
  const configured = new Set(config.hunts.map((hunt) => hunt.id));
  const hunts = Object.fromEntries(
    Object.entries(state.hunts)
      .filter(([id]) => configured.has(id))
      .map(([id, hunt]) => [
        id,
        { ...hunt, showings: Object.fromEntries(Object.entries(hunt.showings).filter(([, showing]) => showing.startsAt.slice(0, 16) > nowLocal)) },
      ]),
  );
  const historyDays = Object.fromEntries(Object.entries(state.historyDays).filter(([, day]) => day >= cutoff));
  return { ...state, hunts, historyDays };
}

export function versionCheckDue(state: State, at: number): boolean {
  return state.lastVersionCheckAt === null || at - state.lastVersionCheckAt >= VERSION_CHECK_MS;
}

export function releaseTag(release: unknown): string | null {
  if (typeof release !== "object" || release === null) return null;
  const tag = (release as { tag_name?: unknown }).tag_name;
  return typeof tag === "string" ? tag : null;
}
