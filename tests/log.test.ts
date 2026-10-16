import { describe, expect, it, vi } from "vitest";
import { createLogger, redact } from "../src/log.js";
import { fakeBotToken } from "./support/tokens.js";

const TOKEN = fakeBotToken(123456789, "a");

describe("redact", () => {
  it("replaces configured secrets", () => {
    expect(redact("password is hunter2 ok", ["hunter2"])).toBe("password is *** ok");
  });

  it("replaces every occurrence and ignores empty secrets", () => {
    expect(redact("abc abc", ["", "abc"])).toBe("*** ***");
    expect(redact("unchanged", [""])).toBe("unchanged");
  });

  it("matches secrets literally, not as patterns", () => {
    expect(redact("a.c abc", ["a.c"])).toBe("*** abc");
  });

  it("replaces telegram tokens without knowing them", () => {
    expect(redact(`token ${TOKEN} end`, [])).toBe("token *** end");
  });

  it("hides the token in api urls", () => {
    expect(redact(`POST https://api.telegram.org/bot${TOKEN}/sendMessage failed`, [])).toBe(
      "POST https://api.telegram.org/bot***/sendMessage failed",
    );
    expect(redact("https://api.telegram.org/botsecret-short/getMe", [])).toBe(
      "https://api.telegram.org/bot***/getMe",
    );
  });

  it("does not touch ordinary numbers", () => {
    const text = "showing 5116-575978 at 12:30, id 1234567890, ratio 123456:abc, bot is fine";
    expect(redact(text, [])).toBe(text);
  });
});

describe("createLogger", () => {
  function setup(secrets: string[] = []) {
    const lines: string[] = [];
    const logger = createLogger({
      secrets: () => secrets,
      sink: (line) => lines.push(line),
      now: () => Date.UTC(2026, 9, 16, 8, 30, 15, 123),
    });
    return { lines, logger };
  }

  it("writes a json line with time, level, message and data", () => {
    const { lines, logger } = setup();
    logger.info("round done", { hunt: "ab12cd34", count: 3 });
    logger.warn("slow");
    logger.error("boom", { ok: false });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { t: "2026-10-16T08:30:15.123Z", level: "info", msg: "round done", hunt: "ab12cd34", count: 3 },
      { t: "2026-10-16T08:30:15.123Z", level: "warn", msg: "slow" },
      { t: "2026-10-16T08:30:15.123Z", level: "error", msg: "boom", ok: false },
    ]);
  });

  it("redacts the message and nested string values", () => {
    const { lines, logger } = setup(["s3cr3t"]);
    logger.info(`sent with ${TOKEN}`, { a: { b: ["x s3cr3t y", { c: `bot${TOKEN}` }] }, n: 5 });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      msg: "sent with ***",
      a: { b: ["x *** y", { c: "bot***" }] },
      n: 5,
    });
    expect(lines[0]).not.toContain(TOKEN);
    expect(lines[0]).not.toContain("s3cr3t");
  });

  it("serializes errors with a redacted message", () => {
    const { lines, logger } = setup();
    logger.error("request failed", {
      error: new Error(`GET https://api.telegram.org/bot${TOKEN}/getMe: 401`),
    });
    const parsed = JSON.parse(lines[0] ?? "") as { error: { name: string; message: string } };
    expect(parsed.error).toEqual({
      name: "Error",
      message: "GET https://api.telegram.org/bot***/getMe: 401",
    });
  });

  it("reads secrets at each call", () => {
    const secrets: string[] = [];
    const lines: string[] = [];
    const logger = createLogger({ secrets: () => secrets, sink: (line) => lines.push(line) });
    logger.info("late");
    secrets.push("late");
    logger.info("late");
    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual(["late", "***"]);
  });

  it("defaults to stdout and the system clock", () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      createLogger({ secrets: () => [] }).info("hello");
    } finally {
      spy.mockRestore();
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(chunks[0] ?? "") as { t: string; msg: string };
    expect(parsed.msg).toBe("hello");
    expect(Number.isNaN(Date.parse(parsed.t))).toBe(false);
  });
});
