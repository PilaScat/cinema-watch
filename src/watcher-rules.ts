import { huntInterval } from "./config.js";
import { romeNow, romeToday, timeInRange } from "./dates.js";
import type { Config, Hunt, HuntEvent, HuntState, SentResult, State } from "./model.js";
import type { DigestEntry } from "./notify.js";
import type { HuntObservation } from "./runner.js";
import { huntStateOf } from "./state.js";

const MINUTE = 60_000;
const JITTER = 0.1;
export const MANUAL_REFRESH_MS = 30_000;

export interface Delivery {
  delivered: boolean;
  errors: string[];
}

export function isActive(hunt: Hunt): boolean {
  return hunt.enabled && hunt.archivedAt === null;
}

export function isMuted(huntState: HuntState, at: number): boolean {
  return huntState.mutedUntil !== null && huntState.mutedUntil > at;
}

export function eventAllowed(event: HuntEvent, hunt: Hunt): boolean {
  const flags = hunt.notify;
  switch (event.kind) {
    case "newShowing":
      return flags.newShowings;
    case "seatsFreed":
      return flags.seatsFreed;
    case "lastSeats":
      return flags.lastSeats;
    case "cancelled":
      return flags.cancelled;
    case "moved":
      return flags.moved;
    case "movieAppeared":
      return flags.movieAppeared;
  }
}

export function nextRunAt(hunt: Hunt, settings: Config["settings"], at: number, random: number): number {
  const interval = huntInterval(hunt, settings) * MINUTE;
  return at + Math.round(interval * (1 + random * JITTER));
}

export function isQuiet(settings: Config["settings"], at: number): boolean {
  const hours = settings.quietHours;
  if (hours === null) return false;
  return timeInRange(romeNow(new Date(at)).time, hours.from, hours.to);
}

export function isDue(hunt: Hunt, state: State, at: number): boolean {
  if (!isActive(hunt)) return false;
  const next = huntStateOf(state, hunt.id).nextRunAt;
  return next === null || next <= at;
}

export function refreshedRecently(huntState: HuntState, at: number): boolean {
  return huntState.manualRunAt !== null && at - huntState.manualRunAt < MANUAL_REFRESH_MS;
}

export function windowEnded(hunt: Hunt, at: number): boolean {
  return hunt.window.kind === "fixed" && hunt.window.to < romeToday(new Date(at));
}

export function finishedHuntIds(config: Config, at: number): string[] {
  return config.hunts.filter((hunt) => isActive(hunt) && windowEnded(hunt, at)).map((hunt) => hunt.id);
}

export function hallsToReconfirm(hunt: Hunt, previous: HuntState, observation: HuntObservation): string[] {
  const changed = observation.hallChanged.map(({ hallKey }) => hallKey).filter((hallKey) => hunt.hallZones[hallKey] !== undefined);
  return [...new Set([...previous.hallsToReconfirm, ...changed])].sort();
}

export function urlButtonsAccepted(publicUrl: string | null, check: State["publicUrlCheck"]): boolean {
  if (publicUrl === null) return false;
  if (check !== null && check.url === publicUrl) return check.accepted;
  return publicUrl.startsWith("https://");
}

export function deliveryOf(chats: string[], results: SentResult[], primary: string | null, unknownError: string): Delivery {
  const failures = results.flatMap((result, index) => (result.ok ? [] : [{ chatId: chats[index], error: result.error ?? unknownError }]));
  return { delivered: failures.every((failure) => failure.chatId !== primary), errors: failures.map((failure) => failure.error) };
}

export function errorWarningDue(previous: HuntState, errors: string[], at: number, chatId: string | null): boolean {
  if (errors.length === 0 || chatId === null || isMuted(previous, at)) return false;
  return previous.errorNotifiedDay !== romeToday(new Date(at));
}

export function digestEntries(config: Config, state: State, onlyDigest: boolean): DigestEntry[] {
  return config.hunts
    .filter((hunt) => isActive(hunt) && (!onlyDigest || hunt.notify.digest))
    .map((hunt) => {
      const huntState = huntStateOf(state, hunt.id);
      return { hunt, showings: Object.values(huntState.showings), mutedUntil: huntState.mutedUntil };
    });
}

export function digestDue(config: Config, state: State, at: number, telegram: { chatId: string | null; canSend: boolean }): boolean {
  const digest = config.settings.digest;
  if (!digest.enabled || telegram.chatId === null || !telegram.canSend) return false;
  const rome = romeNow(new Date(at));
  return rome.time >= digest.time && state.lastDigestDate !== rome.day;
}
