import { describe, expect, it } from "vitest";
import { localPath, withFrom } from "../src/web/parts/navigation.js";

describe("from parameter", () => {
  it("keeps only paths inside the app", () => {
    expect(localPath("/hunts/abcd1234#showings")).toBe("/hunts/abcd1234#showings");
    expect(localPath("/log?hunt=a&kind=b")).toBe("/log?hunt=a&kind=b");
    expect(localPath(undefined)).toBeNull();
    expect(localPath("")).toBeNull();
    expect(localPath("//evil.example/x")).toBeNull();
    expect(localPath("/\\evil.example")).toBeNull();
    expect(localPath("https://evil.example/")).toBeNull();
    expect(localPath("javascript:alert(1)")).toBeNull();
    expect(localPath("/log\nx")).toBeNull();
    expect(localPath(`/${"a".repeat(1000)}`)).toBeNull();
  });

  it("adds the origin to a link with or without a query", () => {
    expect(withFrom("/showings/1-2", "/log?kind=x")).toBe("/showings/1-2?from=%2Flog%3Fkind%3Dx");
    expect(withFrom("/hunts/new?theatre=a", "/x")).toBe("/hunts/new?theatre=a&from=%2Fx");
    expect(withFrom("/hunts", null)).toBe("/hunts");
  });
});
