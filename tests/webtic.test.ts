import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it, vi, type Mock } from "vitest";
import { ApiShapeError, WebticError } from "../src/errors.js";
import type { HttpClient, Hall } from "../src/types.js";
import {
  HALL_TTL_MS,
  WEBTIC_API_BASE,
  WEBTIC_HEADERS,
  createMemoryHallStore,
  createWebticClient,
  parseHall,
  parseOccupancy,
  parsePerformance,
  parseSeatId,
} from "../src/webtic.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/webtic/${name}.json`, import.meta.url), "utf-8"));
}

const PERFORMANCES = [
  { localId: 5116, performanceId: 575978, screenId: 2 },
  { localId: 5116, performanceId: 576749, screenId: 14 },
  { localId: 5116, performanceId: 576820, screenId: 4 },
  { localId: 5124, performanceId: 536257, screenId: 69 },
];

interface FakeHttp extends HttpClient {
  postJson: Mock<HttpClient["postJson"]>;
  getJson: Mock<HttpClient["getJson"]>;
}

function fakeHttp(): FakeHttp {
  const postJson = vi.fn<HttpClient["postJson"]>((url, body) => {
    const { LocalId, PerformanceId, ScreenId } = body as Record<string, number>;
    if (url.endsWith("/Performance")) return Promise.resolve(fixture(`performance-${LocalId}-${PerformanceId}`));
    if (url.endsWith("/Occupancy")) return Promise.resolve(fixture(`occupancy-${LocalId}-${PerformanceId}`));
    if (url.endsWith("/Screen")) return Promise.resolve(fixture(`screen-${LocalId}-${ScreenId}`));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  return { postJson, getJson: vi.fn<HttpClient["getJson"]>() };
}

const malformed: [string, unknown][] = [
  ["null", null],
  ["empty object", {}],
  ["html string", "<html><body>Bad gateway</body></html>"],
  ["number", 42],
  ["array", []],
  ["status without success", { Data: {}, Status: {} }],
  ["success of wrong type", { Data: {}, Status: { Success: "yes" } }],
  ["missing Data", { Status: { Success: true, ReasonCode: 0 } }],
  ["null Data", { Data: null, Status: { Success: true } }],
];

describe("parsePerformance", () => {
  it.each(PERFORMANCES)("parses $localId-$performanceId", ({ localId, performanceId, screenId }) => {
    const info = parsePerformance(fixture(`performance-${localId}-${performanceId}`));
    expect(info.key).toBe(`${localId}-${performanceId}`);
    expect(info.hallKey).toBe(`${localId}-${screenId}`);
    expect(info.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(info.title.length).toBeGreaterThan(0);
    expect(info.priceFrom).not.toBeNull();
  });

  it("parses the Dune IMAX performance", () => {
    expect(parsePerformance(fixture("performance-5116-575978"))).toEqual({
      key: "5116-575978",
      hallKey: "5116-2",
      eventRef: "9803",
      screenName: "SALA 1 IMAX",
      startTime: "2026-12-15T20:30:00",
      title: "Dune - Parte Tre Sala Imax",
      priceFrom: 14.9,
    });
  });

  it("takes the lowest PriceStartFrom across sectors", () => {
    expect(parsePerformance(fixture("performance-5116-576749")).priceFrom).toBe(12.9);
    expect(parsePerformance(fixture("performance-5116-576820")).priceFrom).toBe(10.9);
  });

  function performanceJson(shoppingModes: unknown): unknown {
    return {
      Data: {
        Performance: {
          LocalId: 1,
          EventId: 2,
          PerformanceId: 3,
          ScreenId: 4,
          ScreenName: "S",
          StartTime: "2026-01-01T10:00:00",
        },
        Event: { Title: "T" },
        Tickets: shoppingModes === undefined ? undefined : { ShoppingModes: shoppingModes },
      },
      Status: { Success: true, Message: "", ReasonCode: 0 },
    };
  }

  it("falls back to the lowest TotalPrice without PriceStartFrom", () => {
    const json = performanceJson([
      { PaymentModes: [{ SectorPrices: [{ Prices: [{ TotalPrice: 9 }, { TotalPrice: 7.5 }] }, { Prices: [{ TotalPrice: 8 }] }] }] },
    ]);
    expect(parsePerformance(json).priceFrom).toBe(7.5);
  });

  it("returns null price when nothing is priced", () => {
    expect(parsePerformance(performanceJson([{ PaymentModes: [{ SectorPrices: [{ Prices: [{}] }, {}] }] }, {}])).priceFrom).toBeNull();
    expect(parsePerformance(performanceJson([])).priceFrom).toBeNull();
    expect(parsePerformance(performanceJson(undefined)).priceFrom).toBeNull();
  });

  it.each(malformed)("rejects %s with ApiShapeError", (_name, json) => {
    expect(() => parsePerformance(json)).toThrow(ApiShapeError);
  });

  it("rejects wrongly typed fields", () => {
    const json = performanceJson([]) as { Data: { Performance: Record<string, unknown> } };
    json.Data.Performance["ScreenId"] = "2";
    expect(() => parsePerformance(json)).toThrow(ApiShapeError);
  });

  it("throws ApiShapeError with source webtic", () => {
    try {
      parsePerformance(null);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiShapeError);
      expect((error as ApiShapeError).source).toBe("webtic");
    }
  });
});

describe("parseHall", () => {
  const halls = [
    { name: "screen-5116-2", seats: 236, sectors: { PT: 232, UN: 4 } },
    { name: "screen-5116-14", seats: 282, sectors: { PT: 244, HA: 36, UN: 2 } },
    { name: "screen-5116-4", seats: 154, sectors: { PT: 124, HA: 28, UN: 2 } },
    { name: "screen-5124-69", seats: 138, sectors: { PT: 136, UN: 2 } },
  ];

  it.each(halls)("parses $name", ({ name, seats, sectors }) => {
    const hall = parseHall(fixture(name), 123);
    expect(hall.seats).toHaveLength(seats);
    expect(hall.fetchedAt).toBe(123);
    const bySector: Record<string, number> = {};
    for (const seat of hall.seats) bySector[seat.sector] = (bySector[seat.sector] ?? 0) + 1;
    expect(bySector).toEqual(sectors);
    expect(new Set(hall.seats.map((seat) => seat.id)).size).toBe(seats);
  });

  it("maps the seat fields", () => {
    const hall = parseHall(fixture("screen-5116-2"), 0);
    expect(hall.key).toBe("5116-2");
    expect(hall.seats[0]).toEqual({
      id: "A/1",
      rowLabel: "A",
      number: 1,
      row: 2,
      column: 2,
      sector: "PT",
      type: "STANDARD",
    });
  });

  it("keeps the seat types of the fixture", () => {
    const types = new Set(parseHall(fixture("screen-5116-14"), 0).seats.map((seat) => seat.type));
    expect([...types].sort()).toEqual(["DISABILE", "RISERVATO", "STANDARD"]);
  });

  it.each(malformed)("rejects %s with ApiShapeError", (_name, json) => {
    expect(() => parseHall(json, 0)).toThrow(ApiShapeError);
  });

  it("rejects Seats that is not an array", () => {
    const json = { Data: { Screen: { LocalId: 1, ScreenId: 2, Seats: "none" } }, Status: { Success: true } };
    expect(() => parseHall(json, 0)).toThrow(ApiShapeError);
  });

  it("rejects seats with wrongly typed fields", () => {
    const seat = { SeatId: "A/1", SeatType: "STANDARD", SectorId: "PT", Row: "2", Column: 2 };
    const json = { Data: { Screen: { LocalId: 1, ScreenId: 2, Seats: [seat] } }, Status: { Success: true } };
    expect(() => parseHall(json, 0)).toThrow(ApiShapeError);
  });
});

describe("parseOccupancy", () => {
  it("counts sold and blocked seats for Dune IMAX", () => {
    const occupancy = parseOccupancy(fixture("occupancy-5116-575978"));
    const statuses = Object.values(occupancy.taken);
    expect(occupancy.key).toBe("5116-575978");
    expect(statuses).toHaveLength(192);
    expect(statuses.filter((status) => status === "blocked")).toHaveLength(8);
    expect(statuses.filter((status) => status === "sold")).toHaveLength(184);
  });

  it.each([
    ["occupancy-5116-576749", 78, 5],
    ["occupancy-5116-576820", 11, 4],
    ["occupancy-5124-536257", 8, 4],
  ])("parses %s", (name, total, blocked) => {
    const statuses = Object.values(parseOccupancy(fixture(name)).taken);
    expect(statuses).toHaveLength(total);
    expect(statuses.filter((status) => status === "blocked")).toHaveLength(blocked);
  });

  it("maps unknown statuses to other", () => {
    const json = {
      Data: {
        Occupancy: {
          LocalId: 1,
          PerformanceId: 2,
          Seats: [
            { SeatId: "A/1", SeatStatus: "ACQUISTO" },
            { SeatId: "A/2", SeatStatus: "BLOCCATO" },
            { SeatId: "A/3", SeatStatus: "PRENOTATO" },
          ],
        },
      },
      Status: { Success: true },
    };
    expect(parseOccupancy(json).taken).toEqual({ "A/1": "sold", "A/2": "blocked", "A/3": "other" });
  });

  it.each(malformed)("rejects %s with ApiShapeError", (_name, json) => {
    expect(() => parseOccupancy(json)).toThrow(ApiShapeError);
  });

  it("rejects Seats that is not an array", () => {
    const json = { Data: { Occupancy: { LocalId: 1, PerformanceId: 2, Seats: {} } }, Status: { Success: true } };
    expect(() => parseOccupancy(json)).toThrow(ApiShapeError);
  });
});

describe("Success false", () => {
  const failure = { Data: null, Status: { Success: false, Message: "Spettacolo non trovato", ReasonCode: 404 } };

  it.each([
    ["performance", parsePerformance],
    ["hall", (json: unknown) => parseHall(json, 0)],
    ["occupancy", parseOccupancy],
  ])("%s throws WebticError with the reason code", (_name, parse) => {
    try {
      parse(failure);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(WebticError);
      expect((error as WebticError).reasonCode).toBe(404);
      expect((error as WebticError).message).toBe("Spettacolo non trovato");
    }
  });

  it("tolerates a missing message and reason code", () => {
    try {
      parsePerformance({ Status: { Success: false } });
      expect.unreachable();
    } catch (error) {
      expect((error as WebticError).reasonCode).toBeNull();
      expect((error as WebticError).message).toBe("");
    }
  });
});

describe("parseSeatId", () => {
  it.each([
    ["F/12", "F", 12],
    ["HX/3", "HX", 3],
    ["A/0", "A", 0],
    ["B/x", "B", null],
    ["B/", "B", null],
    ["B/1a", "B", null],
    ["B/-1", "B", null],
    ["A/B/7", "A/B", 7],
    ["/5", "", 5],
    ["NOSLASH", "NOSLASH", null],
    ["", "", null],
  ])("parses %j", (id, rowLabel, number) => {
    expect(parseSeatId(id)).toEqual({ rowLabel, number });
  });

  it("round-trips L/N", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((label) => !label.includes("/")),
        fc.nat(),
        (label, number) => {
          expect(parseSeatId(`${label}/${number}`)).toEqual({ rowLabel: label, number });
        },
      ),
    );
  });

  it("never throws on arbitrary input", () => {
    fc.assert(fc.property(fc.string(), (id) => parseSeatId(id).rowLabel !== undefined));
  });
});

describe("createWebticClient", () => {
  it("posts the body and headers to the performance endpoint", async () => {
    const http = fakeHttp();
    const client = createWebticClient(http, { hallStore: createMemoryHallStore() });
    const info = await client.performance(5116, 575978);
    expect(info.screenName).toBe("SALA 1 IMAX");
    expect(http.postJson).toHaveBeenCalledWith(
      `${WEBTIC_API_BASE}/Performance`,
      { LocalId: 5116, PerformanceId: 575978 },
      { headers: WEBTIC_HEADERS },
    );
  });

  it("posts the body and headers to the occupancy endpoint", async () => {
    const http = fakeHttp();
    const client = createWebticClient(http, { hallStore: createMemoryHallStore() });
    const occupancy = await client.occupancy(5116, 575978);
    expect(Object.keys(occupancy.taken)).toHaveLength(192);
    expect(http.postJson).toHaveBeenCalledWith(
      `${WEBTIC_API_BASE}/Occupancy`,
      { LocalId: 5116, PerformanceId: 575978 },
      { headers: WEBTIC_HEADERS },
    );
  });

  it("exposes the expected constants", () => {
    expect(WEBTIC_HEADERS).toEqual({ Origin: "https://ucicinemas.it", Referer: "https://ucicinemas.it/" });
    expect(HALL_TTL_MS).toBe(604_800_000);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid id %s without a request", async (id) => {
    const http = fakeHttp();
    const client = createWebticClient(http, { hallStore: createMemoryHallStore() });
    await expect(client.performance(id, 1)).rejects.toThrow(ApiShapeError);
    await expect(client.performance(1, id)).rejects.toThrow(ApiShapeError);
    await expect(client.occupancy(id, 1)).rejects.toThrow(ApiShapeError);
    await expect(client.occupancy(1, id)).rejects.toThrow(ApiShapeError);
    await expect(client.hall(id, 1)).rejects.toThrow(ApiShapeError);
    await expect(client.hall(1, id)).rejects.toThrow(ApiShapeError);
    expect(http.postJson).not.toHaveBeenCalled();
  });

  it("propagates WebticError and ApiShapeError from the server", async () => {
    const http = fakeHttp();
    http.postJson.mockResolvedValueOnce({ Data: null, Status: { Success: false, Message: "no", ReasonCode: 7 } });
    http.postJson.mockResolvedValueOnce("<html></html>");
    const client = createWebticClient(http, { hallStore: createMemoryHallStore() });
    await expect(client.performance(5116, 575978)).rejects.toMatchObject({ reasonCode: 7 });
    await expect(client.occupancy(5116, 575978)).rejects.toThrow(ApiShapeError);
  });

  describe("hall", () => {
    it("downloads into an empty store", async () => {
      const http = fakeHttp();
      const store = createMemoryHallStore();
      const client = createWebticClient(http, { hallStore: store, now: () => 1000 });
      const result = await client.hall(5116, 2);
      expect(result.refreshed).toBe(true);
      expect(result.changed).toBe(false);
      expect(result.hall.seats).toHaveLength(236);
      expect(result.hall.fetchedAt).toBe(1000);
      expect(await store.get("5116-2")).toEqual(result.hall);
      expect(http.postJson).toHaveBeenCalledWith(
        `${WEBTIC_API_BASE}/Screen`,
        { LocalId: 5116, ScreenId: 2 },
        { headers: WEBTIC_HEADERS },
      );
    });

    it("uses the cached hall within the ttl", async () => {
      const http = fakeHttp();
      let clock = 0;
      const client = createWebticClient(http, { hallStore: createMemoryHallStore(), now: () => clock });
      await client.hall(5116, 2);
      clock = HALL_TTL_MS - 1;
      const result = await client.hall(5116, 2);
      expect(result).toMatchObject({ refreshed: false, changed: false });
      expect(http.postJson).toHaveBeenCalledTimes(1);
    });

    it("refreshes once the ttl has passed", async () => {
      const http = fakeHttp();
      let clock = 0;
      const client = createWebticClient(http, { hallStore: createMemoryHallStore(), now: () => clock });
      await client.hall(5116, 2);
      clock = HALL_TTL_MS;
      const result = await client.hall(5116, 2);
      expect(result).toMatchObject({ refreshed: true, changed: false });
      expect(result.hall.fetchedAt).toBe(HALL_TTL_MS);
      expect(http.postJson).toHaveBeenCalledTimes(2);
    });

    it("keeps the cache when the occupancy only has known seats", async () => {
      const http = fakeHttp();
      const client = createWebticClient(http, { hallStore: createMemoryHallStore(), now: () => 0 });
      await client.hall(5116, 2);
      const occupancy = parseOccupancy(fixture("occupancy-5116-575978"));
      const result = await client.hall(5116, 2, occupancy);
      expect(result.refreshed).toBe(false);
      expect(http.postJson).toHaveBeenCalledTimes(1);
    });

    it("refreshes and reports a change when the occupancy has unknown seats", async () => {
      const http = fakeHttp();
      const store = createMemoryHallStore();
      const stale = parseHall(fixture("screen-5116-2"), 0);
      const reduced: Hall = { ...stale, seats: stale.seats.slice(1) };
      await store.set(reduced);
      const client = createWebticClient(http, { hallStore: store, now: () => 10 });
      const occupancy = { key: "5116-575978", taken: { "A/1": "sold" as const } };
      const result = await client.hall(5116, 2, occupancy);
      expect(result.refreshed).toBe(true);
      expect(result.changed).toBe(true);
      expect(result.hall.seats).toHaveLength(236);
      expect((await store.get("5116-2"))?.seats).toHaveLength(236);
    });

    it("reports no change when the refreshed hall has the same seats", async () => {
      const http = fakeHttp();
      const store = createMemoryHallStore();
      await store.set({ ...parseHall(fixture("screen-5116-2"), 0), seats: [...parseHall(fixture("screen-5116-2"), 0).seats].reverse() });
      const client = createWebticClient(http, { hallStore: store, now: () => HALL_TTL_MS + 1 });
      expect(await client.hall(5116, 2)).toMatchObject({ refreshed: true, changed: false });
    });

    it("reports a change when the seat count differs", async () => {
      const http = fakeHttp();
      const store = createMemoryHallStore();
      const full = parseHall(fixture("screen-5116-2"), 0);
      await store.set({ ...full, seats: [...full.seats, { ...full.seats[0]!, id: "Z/99" }] });
      const client = createWebticClient(http, { hallStore: store, now: () => HALL_TTL_MS + 1 });
      expect(await client.hall(5116, 2)).toMatchObject({ refreshed: true, changed: true });
    });

    it("keeps halls of different screens apart", async () => {
      const http = fakeHttp();
      const client = createWebticClient(http, { hallStore: createMemoryHallStore(), now: () => 0 });
      const first = await client.hall(5116, 2);
      const second = await client.hall(5124, 69);
      expect(first.hall.seats).toHaveLength(236);
      expect(second.hall.seats).toHaveLength(138);
    });

    it("uses Date.now by default", async () => {
      const http = fakeHttp();
      const client = createWebticClient(http, { hallStore: createMemoryHallStore() });
      const before = Date.now();
      const { hall } = await client.hall(5116, 4);
      expect(hall.fetchedAt).toBeGreaterThanOrEqual(before);
    });
  });
});
