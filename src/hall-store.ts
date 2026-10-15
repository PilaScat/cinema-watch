import type { createStore } from "./store.js";
import type { Hall } from "./types.js";
import type { HallStore } from "./webtic.js";

type Store = ReturnType<typeof createStore>;

function isHall(value: unknown): value is Hall {
  if (typeof value !== "object" || value === null) return false;
  const hall = value as Partial<Hall>;
  return typeof hall.localId === "number" && typeof hall.screenId === "number" && Array.isArray(hall.seats) && typeof hall.fetchedAt === "number";
}

export function createFileHallStore(store: Store): HallStore {
  const name = (localId: number, screenId: number) => `screens/${localId}-${screenId}.json`;
  return {
    async get(localId, screenId) {
      try {
        const value = await store.readJson(name(localId, screenId));
        return isHall(value) ? value : null;
      } catch {
        return null;
      }
    },
    async set(hall) {
      await store.writeJson(name(hall.localId, hall.screenId), hall);
    },
  };
}
