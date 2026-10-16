import { describe, expect, it } from "vitest";
import { renderTrendSvg } from "../src/chart-svg.js";

const labels = { free: "Liberi", freeGood: "Nella zona buona", time: (t: number) => `T${t}` };
const options = { width: 640, height: 240, labels };

function gridLabels(svg: string): string[] {
  return [...svg.matchAll(/class="chart-axis" font-size="12">(\d+)<\/text>/g)].map((match) => match[1] ?? "");
}

function endLabelY(svg: string, value: number): number {
  const match = new RegExp(`y="([\\d.]+)"[^>]*font-weight="600">${value}</text>`).exec(svg);
  return Number(match?.[1]);
}

describe("renderTrendSvg grid steps", () => {
  it.each([
    [40, ["0", "10", "20", "30", "40"]],
    [80, ["0", "20", "40", "60", "80"]],
    [200, ["0", "50", "100", "150", "200"]],
    [90, ["0", "50", "100"]],
    [28, ["0", "10", "20", "30"]],
    [0, ["0", "1"]],
  ])("rounds a peak of %i to a readable grid", (peak, expected) => {
    const svg = renderTrendSvg([{ t: 1, free: peak, freeGood: 0 }], options);

    expect(gridLabels(svg)).toEqual(expected);
  });
});

describe("renderTrendSvg end labels", () => {
  it("keeps the labels apart when the zone count ends just above the free count", () => {
    const svg = renderTrendSvg(
      [
        { t: 1, free: 10, freeGood: 11 },
        { t: 2, free: 10, freeGood: 11 },
      ],
      options,
    );

    expect(endLabelY(svg, 10) - endLabelY(svg, 11)).toBeGreaterThanOrEqual(14);
  });

  it("keeps the labels apart when the free count ends just above the zone count", () => {
    const svg = renderTrendSvg(
      [
        { t: 1, free: 11, freeGood: 10 },
        { t: 2, free: 11, freeGood: 10 },
      ],
      options,
    );

    expect(endLabelY(svg, 10) - endLabelY(svg, 11)).toBeGreaterThanOrEqual(14);
  });
});

describe("renderTrendSvg without points", () => {
  it("draws an empty frame with no dots, hover areas or time labels", () => {
    const svg = renderTrendSvg([], options);

    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).not.toContain("<circle");
    expect(svg).not.toContain("transparent");
    expect(svg).not.toContain(">T");
    expect(gridLabels(svg)).toEqual(["0", "1"]);
  });

  it("sorts points given out of order", () => {
    const ordered = renderTrendSvg(
      [
        { t: 1000, free: 5, freeGood: 1 },
        { t: 2000, free: 8, freeGood: 2 },
      ],
      options,
    );
    const shuffled = renderTrendSvg(
      [
        { t: 2000, free: 8, freeGood: 2 },
        { t: 1000, free: 5, freeGood: 1 },
      ],
      options,
    );

    expect(shuffled).toBe(ordered);
  });
});
