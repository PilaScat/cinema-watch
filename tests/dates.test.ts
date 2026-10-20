import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  addDays,
  dayRange,
  isHhMm,
  isIsoDay,
  resolveWindow,
  romeNow,
  romeToday,
  timeInRange,
  weekdayOf,
} from "../src/dates.js";

const dayArbitrary = fc
  .date({ min: new Date("2000-01-01T00:00:00Z"), max: new Date("2100-01-01T00:00:00Z"), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const timeArbitrary = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

describe("romeNow and romeToday", () => {
  it("handles the end of daylight saving time on 2026-10-25", () => {
    expect(romeNow(new Date("2026-10-25T00:30:00Z"))).toEqual({ day: "2026-10-25", time: "02:30", weekday: 7 });
    expect(romeNow(new Date("2026-10-25T01:30:00Z"))).toEqual({ day: "2026-10-25", time: "02:30", weekday: 7 });
  });

  it("uses Rome midnight, not UTC midnight", () => {
    expect(romeToday(new Date("2026-07-14T21:59:00Z"))).toBe("2026-07-14");
    expect(romeToday(new Date("2026-07-14T22:00:00Z"))).toBe("2026-07-15");
    expect(romeToday(new Date("2026-01-14T22:59:00Z"))).toBe("2026-01-14");
    expect(romeToday(new Date("2026-01-14T23:00:00Z"))).toBe("2026-01-15");
  });

  it("reports hour 00 and not 24 at midnight", () => {
    expect(romeNow(new Date("2026-01-14T23:05:00Z")).time).toBe("00:05");
  });

  it("numbers weekdays from Monday=1", () => {
    expect(romeNow(new Date("2026-10-19T10:00:00Z")).weekday).toBe(1);
  });
});

describe("calendar arithmetic", () => {
  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("computes weekdays", () => {
    expect(weekdayOf("2026-10-18")).toBe(7);
    expect(weekdayOf("2026-10-19")).toBe(1);
  });

  it("rejects malformed days", () => {
    expect(() => addDays("nope", 1)).toThrow(RangeError);
  });

  it("validates days and times", () => {
    expect(isIsoDay("2026-02-28")).toBe(true);
    expect(isIsoDay("2026-02-30")).toBe(false);
    expect(isIsoDay("2026-2-3")).toBe(false);
    expect(isHhMm("23:59")).toBe(true);
    expect(isHhMm("24:00")).toBe(false);
    expect(isHhMm("9:30")).toBe(false);
  });

  it("builds inclusive ranges and empty ranges", () => {
    expect(dayRange("2026-12-30", "2027-01-01")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(dayRange("2026-12-30", "2026-12-30")).toEqual(["2026-12-30"]);
    expect(dayRange("2026-12-31", "2026-12-30")).toEqual([]);
  });

  it("addDays is invertible", () => {
    fc.assert(
      fc.property(dayArbitrary, fc.integer({ min: -4000, max: 4000 }), (day, n) => {
        expect(addDays(addDays(day, n), -n)).toBe(day);
      }),
    );
  });

  it("dayRange length equals the distance plus one", () => {
    fc.assert(
      fc.property(dayArbitrary, fc.integer({ min: 0, max: 400 }), (day, n) => {
        const range = dayRange(day, addDays(day, n));
        expect(range).toHaveLength(n + 1);
        expect(range[0]).toBe(day);
        expect(range[n]).toBe(addDays(day, n));
      }),
    );
  });
});

describe("resolveWindow", () => {
  const now = new Date("2026-10-16T10:00:00Z");

  it("clamps a fixed window starting in the past to today", () => {
    expect(resolveWindow({ kind: "fixed", from: "2026-10-01", to: "2026-10-18" }, now)).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });

  it("keeps a fixed window starting in the future", () => {
    expect(resolveWindow({ kind: "fixed", from: "2026-10-20", to: "2026-10-21" }, now)).toEqual([
      "2026-10-20",
      "2026-10-21",
    ]);
  });

  it("is empty when a fixed window is entirely in the past", () => {
    expect(resolveWindow({ kind: "fixed", from: "2026-10-01", to: "2026-10-05" }, now)).toEqual([]);
  });

  it("covers the next N days starting today in Rome", () => {
    expect(resolveWindow({ kind: "next", days: 3 }, now)).toEqual(["2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(resolveWindow({ kind: "next", days: 1 }, new Date("2026-10-16T22:30:00Z"))).toEqual(["2026-10-17"]);
    expect(resolveWindow({ kind: "next", days: 0 }, now)).toEqual([]);
  });
});

describe("timeInRange", () => {
  it("accepts everything without bounds", () => {
    expect(timeInRange("03:00")).toBe(true);
  });

  it("is inclusive on a same-day range", () => {
    expect(timeInRange("18:00", "18:00", "22:00")).toBe(true);
    expect(timeInRange("22:00", "18:00", "22:00")).toBe(true);
    expect(timeInRange("17:59", "18:00", "22:00")).toBe(false);
    expect(timeInRange("22:01", "18:00", "22:00")).toBe(false);
  });

  it("takes the whole day when from and to are the same", () => {
    expect(timeInRange("00:00", "00:00", "00:00")).toBe(true);
    expect(timeInRange("09:20", "00:00", "00:00")).toBe(true);
    expect(timeInRange("23:40", "18:00", "18:00")).toBe(true);
    expect(timeInRange("03:00", "18:00", "18:00")).toBe(true);
  });

  it("supports a single bound", () => {
    expect(timeInRange("20:00", "18:00")).toBe(true);
    expect(timeInRange("17:00", "18:00")).toBe(false);
    expect(timeInRange("17:00", undefined, "18:00")).toBe(true);
    expect(timeInRange("19:00", undefined, "18:00")).toBe(false);
  });

  it("wraps past midnight", () => {
    expect(timeInRange("23:00", "18:00", "01:00")).toBe(true);
    expect(timeInRange("00:30", "18:00", "01:00")).toBe(true);
    expect(timeInRange("12:00", "18:00", "01:00")).toBe(false);
    expect(timeInRange("18:00", "18:00", "01:00")).toBe(true);
    expect(timeInRange("01:00", "18:00", "01:00")).toBe(true);
  });

  it("is consistent with plain comparison when from < to, and takes everything when they are equal", () => {
    fc.assert(
      fc.property(timeArbitrary, timeArbitrary, timeArbitrary, (time, a, b) => {
        const [from, to] = a <= b ? [a, b] : [b, a];
        expect(timeInRange(time, from, to)).toBe(from === to || (time >= from && time <= to));
      }),
    );
  });

  it("wrapped range is the complement of the open gap", () => {
    fc.assert(
      fc.property(timeArbitrary, timeArbitrary, timeArbitrary, (time, from, to) => {
        fc.pre(from > to);
        expect(timeInRange(time, from, to)).toBe(!(time > to && time < from));
      }),
    );
  });
});
