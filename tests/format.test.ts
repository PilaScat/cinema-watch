import { describe, expect, it } from "vitest";
import { escapeHtml, formatDay, formatDayLong, formatEur, formatGroup, formatTime } from "../src/format.js";

describe("formatEur", () => {
  it("formats euros in Italian", () => {
    expect(formatEur(14.9).replace(/\s/g, " ")).toBe("14,90 €");
    expect(formatEur(0).replace(/\s/g, " ")).toBe("0,00 €");
  });
});

describe("formatDay", () => {
  it("gives short weekday and dd/mm", () => {
    expect(formatDay("2026-12-15")).toBe("mar 15/12");
    expect(formatDay("2026-12-20")).toBe("dom 20/12");
    expect(formatDay("2027-01-01")).toBe("ven 01/01");
  });
});

describe("formatDayLong", () => {
  it("gives full weekday and month", () => {
    expect(formatDayLong("2026-12-15")).toBe("martedì 15 dicembre");
    expect(formatDayLong("2027-03-01")).toBe("lunedì 1 marzo");
  });
});

describe("formatGroup", () => {
  it("gives row and first-last seat", () => {
    expect(formatGroup({ rowLabel: "H", seatIds: ["H/9", "H/10", "H/11"], score: 1 })).toBe("H 9-11");
  });
  it("orders numerically", () => {
    expect(formatGroup({ rowLabel: "H", seatIds: ["H/11", "H/9", "H/10"], score: 1 })).toBe("H 9-11");
  });
  it("gives a single seat without range", () => {
    expect(formatGroup({ rowLabel: "H", seatIds: ["H/9"], score: 1 })).toBe("H 9");
  });
  it("gives only the row when no seat number parses", () => {
    expect(formatGroup({ rowLabel: "H", seatIds: [], score: 1 })).toBe("H");
  });
});

describe("escapeHtml", () => {
  it("escapes the Telegram HTML characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;");
  });
});

describe("formatTime", () => {
  it("gives HH:MM in Rome time", () => {
    expect(formatTime(Date.UTC(2026, 11, 15, 19, 30))).toBe("20:30");
    expect(formatTime(Date.UTC(2026, 6, 15, 19, 5))).toBe("21:05");
    expect(formatTime(Date.UTC(2026, 11, 15, 23, 5))).toBe("00:05");
  });
});
