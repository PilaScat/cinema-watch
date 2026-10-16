import { describe, expect, it, vi } from "vitest";
import { createTelegram } from "../src/telegram.js";

const TOKEN = "123456:SECRET-TOKEN-xyz";

function clientAnswering(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(response));
  const telegram = createTelegram({ token: () => TOKEN, fetch: fetchMock, clock: { now: () => 0, sleep: () => Promise.resolve() } });
  return { telegram, fetchMock };
}

describe("telegram answers that look successful but are not", () => {
  it("reports an invalid answer when a 200 is not json", async () => {
    const { telegram } = clientAnswering(new Response("<html>gateway</html>", { status: 200 }));

    const result = await telegram.sendMessage("555", "x");

    expect(result).toEqual({ ok: false, messageIds: [], error: "Risposta di Telegram non valida" });
  });

  it("reports an invalid answer when a 200 says ok is false", async () => {
    const { telegram } = clientAnswering(new Response(JSON.stringify({ ok: false, description: "odd" }), { status: 200 }));

    const result = await telegram.sendMessage("555", "x");

    expect(result).toEqual({ ok: false, messageIds: [], error: "Risposta di Telegram non valida" });
  });

  it("reports an invalid answer when the result has the wrong shape", async () => {
    const { telegram } = clientAnswering(new Response(JSON.stringify({ ok: true, result: { message_id: "seven" } }), { status: 200 }));

    const result = await telegram.sendMessage("555", "x");

    expect(result).toEqual({ ok: false, messageIds: [], error: "Risposta di Telegram non valida" });
  });
});
