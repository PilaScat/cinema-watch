import type { createStore } from "./store.js";

type Store = ReturnType<typeof createStore>;

export interface HistoryPoint {
  t: number;
  free: number;
  freeGood: number;
}

function fileOf(key: string): string {
  return `history/${key}.jsonl`;
}

function parsePoint(line: string): HistoryPoint | null {
  try {
    const value = JSON.parse(line) as Partial<HistoryPoint>;
    return typeof value.t === "number" && typeof value.free === "number" && typeof value.freeGood === "number"
      ? { t: value.t, free: value.free, freeGood: value.freeGood }
      : null;
  } catch {
    return null;
  }
}

export function createHistory(store: Store) {
  async function read(key: string): Promise<HistoryPoint[]> {
    return (await store.readLines(fileOf(key))).flatMap((line) => parsePoint(line) ?? []);
  }

  async function append(key: string, point: HistoryPoint): Promise<void> {
    const last = (await read(key)).at(-1);
    if (last && last.free === point.free && last.freeGood === point.freeGood) return;
    await store.appendLine(fileOf(key), JSON.stringify(point));
  }

  async function remove(key: string): Promise<void> {
    await store.remove(fileOf(key));
  }

  return { read, append, remove };
}
