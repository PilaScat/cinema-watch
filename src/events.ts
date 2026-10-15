import type { createStore } from "./store.js";

type Store = ReturnType<typeof createStore>;

const EVENTS_FILE = "events.jsonl";
export const EVENTS_KEPT = 500;

export interface EventEntry {
  t: number;
  huntId: string | null;
  kind: string;
  key: string | null;
  detail: string | null;
}

function parseEntry(line: string): EventEntry | null {
  try {
    const value = JSON.parse(line) as Partial<EventEntry>;
    if (typeof value.t !== "number" || typeof value.kind !== "string") return null;
    return { t: value.t, huntId: value.huntId ?? null, kind: value.kind, key: value.key ?? null, detail: value.detail ?? null };
  } catch {
    return null;
  }
}

export function createEventLog(store: Store) {
  async function add(entries: EventEntry[]): Promise<void> {
    if (entries.length === 0) return;
    for (const entry of entries) await store.appendLine(EVENTS_FILE, JSON.stringify(entry));
    await store.keepLastLines(EVENTS_FILE, EVENTS_KEPT);
  }

  async function list(limit = EVENTS_KEPT): Promise<EventEntry[]> {
    const entries = (await store.readLines(EVENTS_FILE)).flatMap((line) => parseEntry(line) ?? []);
    return entries.reverse().slice(0, limit);
  }

  return { add, list };
}
