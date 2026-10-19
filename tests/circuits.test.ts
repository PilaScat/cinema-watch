import { describe, expect, it } from "vitest";
import { createTtlCache } from "../src/cache.js";
import { chainOfSlug, createCircuits } from "../src/circuits/index.js";
import { createUciCircuit, createWebticCircuit, parseLegacyKey, type LegacyCaches } from "../src/circuits/legacy.js";
import { ApiShapeError } from "../src/errors.js";
import type { IsoDay, Occupancy, PerformanceInfo, Showing } from "../src/types.js";
import type { createUciClient } from "../src/uci.js";
import type { createSeatClient } from "../src/webtic.js";

type UciClient = ReturnType<typeof createUciClient>;
type SeatClient = ReturnType<typeof createSeatClient>;

const PERFORMANCE: PerformanceInfo = { key: "5116-575978", hallKey: "5116-2", eventRef: "9803", screenName: "SALA 1", startTime: "2026-12-15T20:30:00", title: "Dune", priceFrom: null };

function caches(): LegacyCaches {
  return {
    programming: createTtlCache<Showing[]>({ ttlMs: 60_000 }),
    schedule: createTtlCache<Map<IsoDay, Showing[]>>({ ttlMs: 60_000 }),
    occupancy: createTtlCache<Occupancy>({ ttlMs: 60_000 }),
    performance: createTtlCache<PerformanceInfo>({ ttlMs: 60_000 }),
  };
}

function unused<T>(): T {
  return {} as T;
}

describe("chainOfSlug and the registry", () => {
  it("tells a Webtic cinema from a UCI one by its slug", () => {
    expect(chainOfSlug("webtic-5779")).toBe("webtic");
    expect(chainOfSlug("uci-cinemas-verona")).toBe("uci");
  });

  it("finds the circuit of a slug and refuses a circuit it does not have", () => {
    const uci = createUciCircuit({ uci: unused<UciClient>(), seats: unused<SeatClient>(), caches: caches() });
    const circuits = createCircuits([uci]);

    expect(circuits.forSlug("uci-cinemas-verona")).toBe(uci);
    expect(() => circuits.forSlug("webtic-5779")).toThrow("no circuit for webtic");
  });
});

describe("parseLegacyKey", () => {
  it("splits a UCI or Webtic key and refuses anything else", () => {
    expect(parseLegacyKey("5116-575978")).toEqual([5116, 575978]);
    expect(() => parseLegacyKey("space-1028-58625")).toThrow(ApiShapeError);
  });
});

describe("UCI circuit", () => {
  it("builds the purchase link only when the film is known", () => {
    const circuit = createUciCircuit({ uci: unused<UciClient>(), seats: unused<SeatClient>(), caches: caches() });

    expect(circuit.cartUrl("5116-575978", PERFORMANCE, undefined)).toBeNull();
    expect(circuit.cartUrl("5116-575978", PERFORMANCE, "dune-parte-tre")).toBe("https://ucicinemas.it/movies/dune-parte-tre/acquista/5116/9803/575978");
  });

  it("reports a failing day and keeps reading the others", async () => {
    const uci = { programmingDay: (_slug: string, day: string) => (day === "2026-12-15" ? Promise.reject(new Error("down")) : Promise.resolve([])) } as unknown as UciClient;
    const circuit = createUciCircuit({ uci, seats: unused<SeatClient>(), caches: caches() });

    const results = await circuit.programmingDays("uci-cinemas-verona", ["2026-12-15", "2026-12-16"], false);

    expect(results).toEqual([
      { day: "2026-12-15", error: new Error("down") },
      { day: "2026-12-16", showings: [] },
    ]);
  });
});

describe("Webtic circuit", () => {
  function webtic(knows: boolean) {
    return createWebticCircuit({
      roundScheduling: () => Promise.resolve(new Map()),
      scheduling: () => Promise.resolve(new Map()),
      knows: () => knows,
      seats: unused<SeatClient>(),
      caches: caches(),
    });
  }

  it("refuses the programming of a slug that is not Webtic or not known", async () => {
    await expect(webtic(true).programming("uci-cinemas-verona")).rejects.toThrow("not a Webtic cinema");
    await expect(webtic(false).programming("webtic-999")).rejects.toThrow("unknown cinema");
    expect(await webtic(true).programmingDays("uci-cinemas-verona", ["2026-12-15"], false)).toEqual([{ day: "2026-12-15", error: expect.any(ApiShapeError) as unknown }]);
  });

  it("builds the Webtic purchase link from the key and the event", () => {
    expect(webtic(true).cartUrl("5779-51133", { ...PERFORMANCE, eventRef: "1223" }, undefined)).toBe(
      "https://secure.webtic.it/angwt/webtic.aspx?lid=5779&lng=it#/shoppingmode/it/0/5779/1223/51133",
    );
  });
});
