import { describe, expect, it } from "vitest";
import { renderTrendSvg } from "../src/chart-svg.js";

const labels = { free: "Liberi", freeGood: "Nella zona buona", time: (t: number) => `T${t}` };
const options = { width: 640, height: 240, labels };

describe("renderTrendSvg", () => {
  const points = [
    { t: 1000, free: 44, freeGood: 0 },
    { t: 2000, free: 47, freeGood: 3 },
    { t: 4000, free: 30, freeGood: 5 },
  ];

  it("draws two thick lines, a grid up to the maximum and the axis labels", () => {
    const svg = renderTrendSvg(points, options);

    expect(svg).toContain('class="chart-line-1"');
    expect(svg).toContain('class="chart-line-2"');
    expect(svg.match(/stroke-width="2"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(svg).toContain('fill="none"');
    expect([...svg.matchAll(/class="chart-grid"/g)]).toHaveLength(4);
    expect(svg).toContain(">60</text>");
    expect(svg).toContain(">0</text>");
    expect(svg).toContain(">T1000</text>");
    expect(svg).toContain(">T4000</text>");
  });

  it("labels the last value of each series and marks only the last point", () => {
    const svg = renderTrendSvg(points, options);

    expect(svg).toContain(">30</text>");
    expect(svg).toContain(">5</text>");
    expect(svg.match(/<circle /g)).toHaveLength(2);
    expect(svg).toContain('r="4" stroke-width="2" class="chart-dot-1"');
    expect(svg).toContain('class="chart-dot-2"');
  });

  it("adds one transparent hover rectangle per point carrying its values", () => {
    const svg = renderTrendSvg(points, options);
    const rects = [...svg.matchAll(/<rect [^>]*fill="transparent"[^>]*>/g)].map(([tag]) => tag);

    expect(rects).toHaveLength(points.length);
    expect(rects[1]).toContain('data-t="2000"');
    expect(rects[1]).toContain('data-free="47"');
    expect(rects[1]).toContain('data-good="3"');
  });

  it("escapes every text and never writes inline styles", () => {
    const svg = renderTrendSvg(points, { ...options, labels: { free: "<b>&", freeGood: '"x"', time: () => "<i>" } });

    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("<i>");
    expect(svg).toContain("&lt;i&gt;");
    expect(svg).toContain("&lt;b&gt;&amp;");
    expect(svg).not.toContain("style=");
  });

  it("keeps the two end labels apart when the series end at the same value", () => {
    const svg = renderTrendSvg([{ t: 1, free: 10, freeGood: 10 }, { t: 2, free: 10, freeGood: 10 }], options);
    const ys = [...svg.matchAll(/<text x="[^"]+" y="([^"]+)"[^>]*font-weight="600"/g)].map((match) => Number(match[1]));

    expect(ys).toHaveLength(2);
    expect(Math.abs((ys[0] ?? 0) - (ys[1] ?? 0))).toBeGreaterThanOrEqual(14);
  });

  it("survives constant series, a single point and all zeros without invalid numbers", () => {
    const constant = renderTrendSvg([{ t: 1, free: 5, freeGood: 5 }, { t: 2, free: 5, freeGood: 5 }], options);
    const single = renderTrendSvg([{ t: 7, free: 3, freeGood: 1 }], options);
    const zeros = renderTrendSvg([{ t: 1, free: 0, freeGood: 0 }, { t: 1, free: 0, freeGood: 0 }], options);

    for (const svg of [constant, single, zeros]) {
      expect(svg).not.toMatch(/NaN|Infinity/);
      expect(svg.startsWith("<svg")).toBe(true);
    }
    expect(single.match(/fill="transparent"/g)).toHaveLength(1);
  });
});
