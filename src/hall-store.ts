import type { createStore } from "./store.js";
import type { Hall } from "./types.js";
import type { HallStore } from "./webtic.js";

type Store = ReturnType<typeof createStore>;

function isStoredHall(value: unknown): value is Pick<Hall, "seats" | "fetchedAt"> {
  if (typeof value !== "object" || value === null) return false;
  const hall = value as Partial<Hall>;
  return Array.isArray(hall.seats) && typeof hall.fetchedAt === "number";
}

export function createFileHallStore(store: Store): HallStore {
  const name = (key: string) => `screens/${key}.json`;
  return {
    async get(key) {
      try {
        const value = await store.readJson(name(key));
        return isStoredHall(value) ? { key, seats: value.seats, fetchedAt: value.fetchedAt } : null;
      } catch {
        return null;
      }
    },
    async set(hall) {
      await store.writeJson(name(hall.key), hall);
    },
  };
}
