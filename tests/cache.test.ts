import { describe, expect, it, vi } from "vitest";
import { createTtlCache, type Clock } from "../src/cache.js";

function fakeClock(start = 0): Clock & { advance(ms: number): void } {
  let current = start;
  return {
    now: () => current,
    advance: (ms) => {
      current += ms;
    },
  };
}

describe("createTtlCache", () => {
  it("returns stored values until the ttl expires", () => {
    const clock = fakeClock();
    const cache = createTtlCache<number>({ ttlMs: 1000, clock });
    cache.set("a", 1);
    clock.advance(999);
    expect(cache.get("a")).toBe(1);
    clock.advance(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("returns undefined for unknown keys", () => {
    expect(createTtlCache<number>({ ttlMs: 1000 }).get("missing")).toBeUndefined();
  });

  it("uses the system clock by default", () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000 });
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
  });

  it("evicts the least recently used entry beyond maxEntries", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, clock: fakeClock() });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size()).toBe(2);
  });

  it("refreshes recency on get", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, clock: fakeClock() });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(1);
  });

  it("overwriting a key refreshes its ttl and recency", () => {
    const clock = fakeClock();
    const cache = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2, clock });
    cache.set("a", 1);
    cache.set("b", 2);
    clock.advance(600);
    cache.set("a", 10);
    cache.set("c", 3);
    clock.advance(600);
    expect(cache.get("a")).toBe(10);
    expect(cache.get("b")).toBeUndefined();
  });

  it("deletes and clears entries", () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.delete("a");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size()).toBe(1);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("loads once and serves later calls from the cache", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    const load = vi.fn(() => Promise.resolve(7));
    expect(await cache.getOrLoad("a", load)).toBe(7);
    expect(await cache.getOrLoad("a", load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent loads on the same key", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    let resolveLoad: (value: number) => void = () => undefined;
    const load = vi.fn(() => new Promise<number>((resolve) => (resolveLoad = resolve)));
    const first = cache.getOrLoad("a", load);
    const second = cache.getOrLoad("a", load);
    resolveLoad(5);
    expect(await Promise.all([first, second])).toEqual([5, 5]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("does not cache errors and allows a retry", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    const failing = vi.fn(() => Promise.reject(new Error("boom")));
    await expect(cache.getOrLoad("a", failing)).rejects.toThrow("boom");
    expect(cache.get("a")).toBeUndefined();
    expect(await cache.getOrLoad("a", () => Promise.resolve(2))).toBe(2);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("shares a failing load between concurrent callers", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    const failing = vi.fn(() => Promise.reject(new Error("boom")));
    const results = await Promise.allSettled([cache.getOrLoad("a", failing), cache.getOrLoad("a", failing)]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it("bypass reloads and updates the cache", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    cache.set("a", 1);
    const load = vi.fn(() => Promise.resolve(2));
    expect(await cache.getOrLoad("a", load, { bypass: true })).toBe(2);
    expect(cache.get("a")).toBe(2);
    expect(await cache.getOrLoad("a", load, { bypass: false })).toBe(2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("an older bypassed load does not clear a newer in-flight entry", async () => {
    const cache = createTtlCache<number>({ ttlMs: 1000, clock: fakeClock() });
    const resolvers: ((value: number) => void)[] = [];
    const load = (): Promise<number> => new Promise<number>((resolve) => resolvers.push(resolve));
    const first = cache.getOrLoad("a", load);
    const second = cache.getOrLoad("a", load, { bypass: true });
    resolvers[0]?.(1);
    await first;
    cache.delete("a");
    const joined = cache.getOrLoad("a", load);
    resolvers[1]?.(2);
    expect(await Promise.all([second, joined])).toEqual([2, 2]);
    expect(resolvers).toHaveLength(2);
  });
});
