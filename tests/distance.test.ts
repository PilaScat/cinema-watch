import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { byDistance, distanceKm, formatKm } from "../src/distance.js";
import type { Theatre } from "../src/types.js";
import { parseTheatres } from "../src/uci.js";

const VERONA = { lat: 45.4384, lon: 10.9916 };
const MILANO = { lat: 45.4642, lon: 9.19 };

function theatre(slug: string, lat: number | null, lon: number | null): Theatre {
  return { slug, name: slug, city: "", province: null, region: null, isLuxe: false, screens: [], lat, lon };
}

describe("distanceKm", () => {
  it("measures known distances along the earth surface", () => {
    expect(distanceKm(VERONA, VERONA)).toBe(0);
    expect(distanceKm(VERONA, MILANO)).toBeGreaterThan(138);
    expect(distanceKm(VERONA, MILANO)).toBeLessThan(144);
    expect(distanceKm(MILANO, VERONA)).toBeCloseTo(distanceKm(VERONA, MILANO), 9);
  });
});

describe("byDistance", () => {
  const near = theatre("near", 45.44, 11.0);
  const middle = theatre("middle", 45.4642, 9.19);
  const far = theatre("far", 41.9028, 12.4964);
  const unknown = theatre("unknown", null, null);

  it("sorts by km, puts theatres without coordinates last and splits by radius", () => {
    const result = byDistance([far, unknown, middle, near], VERONA, 200);

    expect(result.near.map((item) => item.theatre.slug)).toEqual(["near", "middle"]);
    expect(result.far.map((item) => item.theatre.slug)).toEqual(["far", "unknown"]);
    expect(result.near[0]?.km).toBeLessThan(1);
    expect(result.far[1]?.km).toBeNull();
  });

  it("keeps everything near without a radius", () => {
    const result = byDistance([far, near, unknown], VERONA, null);

    expect(result.near.map((item) => item.theatre.slug)).toEqual(["near", "far", "unknown"]);
    expect(result.far).toEqual([]);
  });

  it("includes a theatre exactly on the radius", () => {
    const km = distanceKm(VERONA, { lat: 45.4642, lon: 9.19 });
    expect(byDistance([middle], VERONA, km).near).toHaveLength(1);
  });
});

describe("formatKm", () => {
  it("rounds to whole km, with one decimal under 10 km", () => {
    expect(formatKm(0.34)).toBe("0,3 km");
    expect(formatKm(9.96)).toBe("10 km");
    expect(formatKm(141.4)).toBe("141 km");
  });
});

describe("theatre coordinates", () => {
  it("reads latitude and longitude of UCI theatres and drops zero or missing ones", () => {
    const theatres = parseTheatres(JSON.parse(readFileSync(new URL("./fixtures/uci/theatres.json", import.meta.url), "utf8")));
    const verona = theatres.find((item) => item.slug === "uci-cinemas-verona");

    expect(verona?.lat).toBeCloseTo(45.3966, 3);
    expect(verona?.lon).toBeCloseTo(11.0164, 3);
    expect(parseTheatres({ data: [{ slug: "a", latitude: "0", longitude: "0" }, { slug: "b" }, { slug: "c", latitude: "x", longitude: "1" }] }).map((item) => [item.lat, item.lon])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
  });
});
