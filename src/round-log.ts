import type { EventEntry } from "./events.js";
import { formatDay } from "./format.js";
import { redact } from "./log.js";
import type { Hunt, HuntEvent } from "./model.js";
import type { HuntObservation } from "./runner.js";

export function eventKey(event: HuntEvent): string | null {
  if (event.kind === "moved") return event.to.key;
  if (event.kind === "movieAppeared") return null;
  return event.showing.key;
}

export function eventDetail(event: HuntEvent): string | null {
  if (event.kind === "movieAppeared") return event.movie.title;
  if (event.kind === "moved") return `${formatDay(event.from.day)} ${event.from.time} → ${formatDay(event.to.day)} ${event.to.time}`;
  return `${formatDay(event.showing.day)} ${event.showing.time}`;
}

export interface RoundLogInput {
  hunt: Hunt;
  observation: HuntObservation;
  events: HuntEvent[];
  at: number;
  deliveryErrors: string[];
  newSeatTypes: string[];
  secrets: string[];
}

export function roundEntries(input: RoundLogInput): EventEntry[] {
  const { hunt, observation, at } = input;
  const entry = (kind: string, key: string | null, detail: string | null): EventEntry => ({ t: at, huntId: hunt.id, kind, key, detail });
  return [
    entry(observation.errors.length > 0 ? "error" : "round", null, observation.errors[0] ?? `${observation.round.showings.length}`),
    ...input.events.map((event) => entry(event.kind, eventKey(event), eventDetail(event))),
    ...observation.hallChanged.map(({ showingKey }) => entry("hallChanged", showingKey, null)),
    ...input.newSeatTypes.map((type) => entry("unknownSeatType", null, type)),
    ...input.deliveryErrors.map((error) => entry("telegramError", null, redact(error, input.secrets))),
  ];
}
