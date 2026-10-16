import { describe, expect, it } from "vitest";
import { isNewerVersion } from "../src/web/version.js";

describe("isNewerVersion", () => {
  it("compares the three numbers, not the text", () => {
    expect(isNewerVersion("v2026.10.10", "v2026.10.9")).toBe(true);
    expect(isNewerVersion("v2026.10.9", "v2026.10.10")).toBe(false);
    expect(isNewerVersion("v2027.1.1", "v2026.12.3")).toBe(true);
    expect(isNewerVersion("v2026.11.0", "v2026.10.1")).toBe(true);
  });

  it("says no for the same version, a missing release, a dev build or an unknown format", () => {
    expect(isNewerVersion("v2026.10.1", "v2026.10.1")).toBe(false);
    expect(isNewerVersion(null, "v2026.10.1")).toBe(false);
    expect(isNewerVersion("v2026.10.2", "dev")).toBe(false);
    expect(isNewerVersion("latest", "v2026.10.1")).toBe(false);
  });
});
