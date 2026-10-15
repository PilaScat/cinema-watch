export interface Clock {
  now(): number;
}

export interface TtlCacheOptions {
  ttlMs: number;
  maxEntries?: number;
  clock?: Clock;
}

export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  delete(key: string): void;
  clear(): void;
  size(): number;
  getOrLoad(key: string, load: () => Promise<V>, options?: { bypass?: boolean }): Promise<V>;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

const systemClock: Clock = { now: () => Date.now() };

export function createTtlCache<V>(options: TtlCacheOptions): TtlCache<V> {
  const clock = options.clock ?? systemClock;
  const entries = new Map<string, Entry<V>>();
  const inFlight = new Map<string, Promise<V>>();

  function evictOverflow(): void {
    if (options.maxEntries === undefined) return;
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      entries.delete(oldest.value);
    }
  }

  function get(key: string): V | undefined {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    entries.delete(key);
    if (entry.expiresAt <= clock.now()) return undefined;
    entries.set(key, entry);
    return entry.value;
  }

  function set(key: string, value: V): void {
    entries.delete(key);
    entries.set(key, { value, expiresAt: clock.now() + options.ttlMs });
    evictOverflow();
  }

  function startLoad(key: string, load: () => Promise<V>): Promise<V> {
    const promise = load().then((value) => {
      set(key, value);
      return value;
    });
    inFlight.set(key, promise);
    const release = (): void => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    };
    promise.then(release, release);
    return promise;
  }

  function getOrLoad(key: string, load: () => Promise<V>, loadOptions?: { bypass?: boolean }): Promise<V> {
    if (loadOptions?.bypass !== true) {
      const cached = get(key);
      if (cached !== undefined) return Promise.resolve(cached);
      const pending = inFlight.get(key);
      if (pending !== undefined) return pending;
    }
    return startLoad(key, load);
  }

  return {
    get,
    set,
    delete: (key) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
    size: () => entries.size,
    getOrLoad,
  };
}
