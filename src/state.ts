import { STATE_SCHEMA_VERSION, type HuntState, type State } from "./model.js";
import { emptyHuntState } from "./round.js";
import { StoreError, type createStore } from "./store.js";

type Store = ReturnType<typeof createStore>;

const STATE_FILE = "state.json";

export function emptyState(): State {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    hunts: {},
    lastDigestDate: null,
    lastVersionCheckAt: null,
    latestVersion: null,
    historyDays: {},
    publicUrlCheck: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const LEGACY_SHOWING_FIELDS = ["localId", "eventId", "performanceId", "screenId"];

function legacyHallKey(showing: Record<string, unknown>): string | null {
  const { localId, screenId } = showing;
  return typeof localId === "number" && typeof screenId === "number" ? `${localId}-${screenId}` : null;
}

function showingToVersion2(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const kept = Object.fromEntries(Object.entries(raw).filter(([field]) => !LEGACY_SHOWING_FIELDS.includes(field)));
  return { ...kept, hallKey: legacyHallKey(raw) };
}

function huntToVersion2(raw: unknown): unknown {
  if (!isRecord(raw) || !isRecord(raw.showings)) return raw;
  return { ...raw, showings: Object.fromEntries(Object.entries(raw.showings).map(([key, showing]) => [key, showingToVersion2(showing)])) };
}

function toVersion2(raw: Record<string, unknown>): Record<string, unknown> {
  const hunts = isRecord(raw.hunts) ? raw.hunts : {};
  return { ...raw, schemaVersion: 2, hunts: Object.fromEntries(Object.entries(hunts).map(([id, hunt]) => [id, huntToVersion2(hunt)])) };
}

function migrateHunt(raw: unknown): HuntState {
  return { ...emptyHuntState(), ...(isRecord(raw) ? raw : {}) };
}

export function migrateState(raw: unknown): State {
  if (!isRecord(raw)) return emptyState();
  const current = raw.schemaVersion === 1 ? toVersion2(raw) : raw;
  if (current.schemaVersion !== STATE_SCHEMA_VERSION) return emptyState();
  const hunts = isRecord(current.hunts) ? current.hunts : {};
  return {
    ...emptyState(),
    ...current,
    hunts: Object.fromEntries(Object.entries(hunts).map(([id, hunt]) => [id, migrateHunt(hunt)])),
  };
}

function isNewer(raw: unknown): boolean {
  return isRecord(raw) && typeof raw.schemaVersion === "number" && raw.schemaVersion > STATE_SCHEMA_VERSION;
}

export async function loadState(store: Store, now: () => number): Promise<State> {
  try {
    const raw = await store.readJson(STATE_FILE);
    if (isNewer(raw)) await store.backup(STATE_FILE, String(now()));
    return migrateState(raw);
  } catch (error) {
    if (!(error instanceof StoreError) || error.kind !== "corrupt") throw error;
    await store.backup(STATE_FILE, String(now()));
    return emptyState();
  }
}

export async function saveState(store: Store, state: State): Promise<void> {
  await store.writeJson(STATE_FILE, state);
}

export function huntStateOf(state: State, huntId: string): HuntState {
  return state.hunts[huntId] ?? emptyHuntState();
}
