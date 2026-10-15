import { describe, expect, it, vi } from "vitest";
import { createTelegram, TELEGRAM_API, TelegramError } from "../src/telegram.js";
import type { TelegramClock } from "../src/telegram.js";

const TOKEN = "123456:SECRET-TOKEN-xyz";

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function okMessage(id: number): Response {
  return reply({ ok: true, result: { message_id: id } });
}

function failure(status: number, description: string, retryAfter?: number): Response {
  return reply(
    {
      ok: false,
      error_code: status,
      description,
      ...(retryAfter === undefined ? {} : { parameters: { retry_after: retryAfter } }),
    },
    status,
  );
}

function fakeClock(start = 1_000_000): TelegramClock & { sleeps: number[] } {
  let current = start;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      await Promise.resolve();
      await Promise.resolve();
      current += ms;
    },
  };
}

function setup(
  responses: Array<Response | Error> = [],
  options: { token?: string | null; maxRetries?: number } = {},
) {
  const queue = [...responses];
  const clock = fakeClock();
  const fetchTimes: number[] = [];
  const fetchMock = vi.fn<typeof fetch>(() => {
    fetchTimes.push(clock.now());
    const next = queue.shift();
    if (next === undefined) return Promise.resolve(okMessage(1));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  });
  const telegram = createTelegram({
    token: () => (options.token === undefined ? TOKEN : options.token),
    fetch: fetchMock,
    clock,
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
  return { telegram, fetchMock, clock, fetchTimes };
}

type FetchMock = ReturnType<typeof setup>["fetchMock"];

function jsonBody(fetchMock: FetchMock, call = 0): unknown {
  const init = fetchMock.mock.calls[call]?.[1];
  return JSON.parse(init?.body as string);
}

function formBody(fetchMock: FetchMock, call = 0): FormData {
  const body = fetchMock.mock.calls[call]?.[1]?.body;
  if (!(body instanceof FormData)) throw new Error("not multipart");
  return body;
}

describe("sendMessage", () => {
  it("posts the exact body without keyboard", async () => {
    const { telegram, fetchMock } = setup([okMessage(42)]);
    const result = await telegram.sendMessage("555", "<b>Ciao</b>");
    expect(result).toEqual({ ok: true, messageIds: [42], error: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${TELEGRAM_API}/bot${TOKEN}/sendMessage`);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(jsonBody(fetchMock)).toEqual({
      chat_id: "555",
      text: "<b>Ciao</b>",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  it("maps url and callback buttons into inline_keyboard", async () => {
    const { telegram, fetchMock } = setup([okMessage(1)]);
    await telegram.sendMessage("555", "x", [
      [
        { text: "Apri", url: "https://example.com" },
        { text: "Muta", callbackData: "mute:1" },
      ],
      [{ text: "Ok", callbackData: "ok" }],
    ]);
    expect(jsonBody(fetchMock)).toEqual({
      chat_id: "555",
      text: "x",
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: "Apri", url: "https://example.com" },
            { text: "Muta", callback_data: "mute:1" },
          ],
          [{ text: "Ok", callback_data: "ok" }],
        ],
      },
    });
  });

  it("omits reply_markup for a null keyboard", async () => {
    const { telegram, fetchMock } = setup([okMessage(1)]);
    await telegram.sendMessage("555", "x", null);
    expect(jsonBody(fetchMock)).not.toHaveProperty("reply_markup");
  });

  it("reports an unconfigured bot without calling fetch", async () => {
    const { telegram, fetchMock } = setup([], { token: null });
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: false,
      messageIds: [],
      error: "Telegram non configurato",
    });
    expect(await telegram.sendPhoto("555", new Uint8Array([1]), "c")).toEqual({
      ok: false,
      messageIds: [],
      error: "Telegram non configurato",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects texts over 4096 characters before calling", async () => {
    const { telegram, fetchMock } = setup();
    await expect(telegram.sendMessage("555", "a".repeat(4097))).rejects.toThrow(Error);
    expect(fetchMock).not.toHaveBeenCalled();
    await telegram.sendMessage("555", "a".repeat(4096));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the description on 401, 403 and 400 without retrying and without the token", async () => {
    const { telegram, fetchMock } = setup([
      failure(401, `Unauthorized ${TOKEN}`),
      failure(403, "Forbidden: bot was blocked by the user"),
      failure(400, "Bad Request: chat not found"),
    ]);
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: false,
      messageIds: [],
      error: "Unauthorized ***",
    });
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: false,
      messageIds: [],
      error: "Forbidden: bot was blocked by the user",
    });
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: false,
      messageIds: [],
      error: "Bad Request: chat not found",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("waits retry_after on 429 then succeeds", async () => {
    const { telegram, fetchMock, clock } = setup([
      failure(429, "Too Many Requests", 7),
      okMessage(9),
    ]);
    const result = await telegram.sendMessage("555", "x");
    expect(result).toEqual({ ok: true, messageIds: [9], error: null });
    expect(clock.sleeps).toEqual([7000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries on 429", async () => {
    const { telegram, fetchMock, clock } = setup(
      [
        failure(429, "Too Many Requests", 2),
        failure(429, "Too Many Requests", 3),
        failure(429, "Too Many Requests", 4),
      ],
      { maxRetries: 2 },
    );
    const result = await telegram.sendMessage("555", "x");
    expect(result).toEqual({ ok: false, messageIds: [], error: "Too Many Requests" });
    expect(clock.sleeps).toEqual([2000, 3000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("defaults to 3 retries on 429", async () => {
    const { telegram, fetchMock } = setup(
      Array.from({ length: 10 }, () => failure(429, "Too Many Requests", 1)),
    );
    const result = await telegram.sendMessage("555", "x");
    expect(result.ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries once after one second on 5xx", async () => {
    const { telegram, fetchMock, clock } = setup([failure(502, "Bad Gateway"), okMessage(5)]);
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: true,
      messageIds: [5],
      error: null,
    });
    expect(clock.sleeps).toEqual([1000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails after the single 5xx retry", async () => {
    const { telegram, fetchMock } = setup([failure(500, "Internal"), failure(503, "Unavailable")]);
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: false,
      messageIds: [],
      error: "Unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on network errors and never leaks the token", async () => {
    const leaky = () => new TypeError(`fetch failed for ${TELEGRAM_API}/bot${TOKEN}/sendMessage`);
    const { telegram, fetchMock, clock } = setup([leaky(), leaky()]);
    const result = await telegram.sendMessage("555", "x");
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(TOKEN);
    expect(result.error).toContain("***");
    expect(clock.sleeps).toEqual([1000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from a network error on the retry", async () => {
    const { telegram } = setup([new TypeError("down"), okMessage(3)]);
    expect(await telegram.sendMessage("555", "x")).toEqual({
      ok: true,
      messageIds: [3],
      error: null,
    });
  });

  it("handles non-JSON error bodies by status", async () => {
    const { telegram } = setup([new Response("<html>nope</html>", { status: 400 })]);
    const result = await telegram.sendMessage("555", "x");
    expect(result).toEqual({ ok: false, messageIds: [], error: "HTTP 400" });
  });

  it("falls back to the status when the error body has an unexpected shape", async () => {
    const { telegram } = setup([reply([], 400)]);
    expect((await telegram.sendMessage("555", "x")).error).toBe("HTTP 400");
  });

  it("waits one second on 429 without retry_after", async () => {
    const { telegram, clock } = setup([failure(429, "Too Many Requests"), okMessage(2)]);
    expect((await telegram.sendMessage("555", "x")).ok).toBe(true);
    expect(clock.sleeps).toEqual([1000]);
  });

  it("describes non-Error rejections", async () => {
    const fetchMock = vi.fn<typeof fetch>(() => Promise.reject(new Error("boom")));
    const raw = createTelegram({ token: () => TOKEN, fetch: fetchMock, clock: fakeClock() });
    expect(await raw.sendMessage("555", "x")).toEqual({ ok: false, messageIds: [], error: "boom" });
  });

  it("treats a malformed ok response as a failure", async () => {
    const { telegram } = setup([reply({ ok: true, result: { nope: 1 } })]);
    const result = await telegram.sendMessage("555", "x");
    expect(result).toEqual({
      ok: false,
      messageIds: [],
      error: "Risposta di Telegram non valida",
    });
  });
});

describe("non-Error rejections", () => {
  it("are described with String()", async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const rejecting = (): Promise<Response> => Promise.reject("boom");
    const raw = createTelegram({
      token: () => TOKEN,
      fetch: vi.fn<typeof fetch>(() => rejecting()),
      clock: fakeClock(),
    });
    const result = await raw.sendMessage("555", "x");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });
});

describe("TelegramError", () => {
  it("carries kind, status and description", () => {
    const error = new TelegramError("conflict", 409, "Conflict: other getUpdates");
    expect(error).toBeInstanceOf(Error);
    expect(error.kind).toBe("conflict");
    expect(error.status).toBe(409);
    expect(error.description).toBe("Conflict: other getUpdates");
    expect(error.message).toBe("Conflict: other getUpdates");
  });
});

describe("rate limits", () => {
  it("spaces private chat messages by one second", async () => {
    const { telegram, clock } = setup();
    await telegram.sendMessage("555", "1");
    await telegram.sendMessage("555", "2");
    await telegram.sendMessage("555", "3");
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it("does not wait when a second has already passed", async () => {
    const { telegram, clock } = setup();
    await telegram.sendMessage("555", "1");
    await clock.sleep(1500);
    await telegram.sendMessage("555", "2");
    expect(clock.sleeps).toEqual([1500]);
  });

  it("allows 20 messages per 60 seconds in groups and waits for the oldest to expire", async () => {
    const { telegram, clock } = setup();
    for (let i = 0; i < 20; i++) await telegram.sendMessage("-100", String(i));
    expect(clock.sleeps).toEqual([]);
    await telegram.sendMessage("-100", "21");
    expect(clock.sleeps).toEqual([60000]);
  });

  it("applies the group limit to channels by username", async () => {
    const { telegram, clock } = setup();
    for (let i = 0; i < 21; i++) await telegram.sendMessage("@channel", String(i));
    expect(clock.sleeps).toEqual([60000]);
  });

  it("counts an album of 3 as 3 messages", async () => {
    const { telegram, clock } = setup([
      reply({ ok: true, result: [{ message_id: 1 }, { message_id: 2 }, { message_id: 3 }] }),
    ]);
    const png = new Uint8Array([1]);
    await telegram.sendMediaGroup("-100", [
      { png, caption: "a" },
      { png, caption: "b" },
      { png, caption: "c" },
    ]);
    for (let i = 0; i < 17; i++) await telegram.sendMessage("-100", String(i));
    expect(clock.sleeps).toEqual([]);
    await telegram.sendMessage("-100", "over");
    expect(clock.sleeps).toEqual([60000]);
  });

  it("serializes concurrent sends on a private chat in call order", async () => {
    const { telegram, clock, fetchMock, fetchTimes } = setup();
    await Promise.all([
      telegram.sendMessage("555", "first"),
      telegram.sendMessage("555", "second"),
      telegram.sendMessage("555", "third"),
    ]);
    expect(clock.sleeps).toEqual([1000, 1000]);
    expect(fetchTimes.map((t) => t - (fetchTimes[0] ?? 0))).toEqual([0, 1000, 2000]);
    expect([0, 1, 2].map((i) => (jsonBody(fetchMock, i) as { text: string }).text)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("respects the group count with a concurrent album and messages", async () => {
    const { telegram, clock } = setup([
      reply({ ok: true, result: [{ message_id: 1 }, { message_id: 2 }, { message_id: 3 }] }),
    ]);
    const png = new Uint8Array([1]);
    const sends = [
      telegram.sendMediaGroup("-100", [
        { png, caption: "a" },
        { png, caption: "b" },
        { png, caption: "c" },
      ]),
      ...Array.from({ length: 19 }, (_, i) => telegram.sendMessage("-100", String(i))),
    ];
    await Promise.all(sends);
    expect(clock.sleeps).toEqual([60000]);
  });

  it("does not block different chats on each other", async () => {
    const { telegram, clock } = setup();
    await telegram.sendMessage("1", "a");
    await telegram.sendMessage("2", "b");
    await telegram.sendMessage("-100", "c");
    expect(clock.sleeps).toEqual([]);
  });
});

describe("default clock", () => {
  it("uses real time with fake timers when no clock is injected", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(okMessage(1)));
      const telegram = createTelegram({ token: () => TOKEN, fetch: fetchMock });
      await telegram.sendMessage("555", "1");
      const second = telegram.sendMessage("555", "2");
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await second;
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("sendPhoto", () => {
  it("posts multipart fields with a png blob", async () => {
    const { telegram, fetchMock } = setup([okMessage(8)]);
    const result = await telegram.sendPhoto("555", new Uint8Array([1, 2, 3]), "Didascalia", [
      [{ text: "Apri", url: "https://example.com" }],
    ]);
    expect(result).toEqual({ ok: true, messageIds: [8], error: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${TELEGRAM_API}/bot${TOKEN}/sendPhoto`);
    const form = formBody(fetchMock);
    expect(form.get("chat_id")).toBe("555");
    expect(form.get("caption")).toBe("Didascalia");
    expect(form.get("parse_mode")).toBe("HTML");
    expect(form.get("reply_markup")).toBe(
      JSON.stringify({ inline_keyboard: [[{ text: "Apri", url: "https://example.com" }]] }),
    );
    const photo = form.get("photo") as File;
    expect(photo.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await photo.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it("omits reply_markup without keyboard", async () => {
    const { telegram, fetchMock } = setup([okMessage(8)]);
    await telegram.sendPhoto("555", new Uint8Array([1]), "c");
    expect(formBody(fetchMock).has("reply_markup")).toBe(false);
  });

  it("rejects captions over 1024 characters", async () => {
    const { telegram, fetchMock } = setup();
    await expect(
      telegram.sendPhoto("555", new Uint8Array([1]), "a".repeat(1025)),
    ).rejects.toThrow(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendMediaGroup", () => {
  const png = (n: number) => new Uint8Array([n]);

  it("posts media JSON with attach:// references and the files", async () => {
    const { telegram, fetchMock } = setup([
      reply({ ok: true, result: [{ message_id: 10 }, { message_id: 11 }] }),
    ]);
    const result = await telegram.sendMediaGroup("555", [
      { png: png(1), caption: "uno" },
      { png: png(2), caption: "due" },
    ]);
    expect(result).toEqual({ ok: true, messageIds: [10, 11], error: null });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${TELEGRAM_API}/bot${TOKEN}/sendMediaGroup`);
    const form = formBody(fetchMock);
    expect(form.get("chat_id")).toBe("555");
    expect(JSON.parse(form.get("media") as string)).toEqual([
      { type: "photo", media: "attach://p0", caption: "uno", parse_mode: "HTML" },
      { type: "photo", media: "attach://p1", caption: "due", parse_mode: "HTML" },
    ]);
    const second = form.get("p1") as File;
    expect(second.type).toBe("image/png");
    expect(Array.from(new Uint8Array(await second.arrayBuffer()))).toEqual([2]);
    expect(form.has("p0")).toBe(true);
  });

  it("rejects fewer than 2 and more than 10 items", async () => {
    const { telegram, fetchMock } = setup();
    await expect(
      telegram.sendMediaGroup("555", [{ png: png(1), caption: "a" }]),
    ).rejects.toThrow(Error);
    const eleven = Array.from({ length: 11 }, () => ({ png: png(1), caption: "a" }));
    await expect(telegram.sendMediaGroup("555", eleven)).rejects.toThrow(Error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects captions over 1024 characters", async () => {
    const { telegram } = setup();
    await expect(
      telegram.sendMediaGroup("555", [
        { png: png(1), caption: "a".repeat(1025) },
        { png: png(2), caption: "b" },
      ]),
    ).rejects.toThrow(Error);
  });

  it("reports unconfigured and failures as results", async () => {
    const items = [
      { png: png(1), caption: "a" },
      { png: png(2), caption: "b" },
    ];
    const unconfigured = await setup([], { token: null }).telegram.sendMediaGroup("555", items);
    expect(unconfigured.error).toBe("Telegram non configurato");
    const { telegram } = setup([failure(400, "Bad Request: wrong file")]);
    expect(await telegram.sendMediaGroup("555", items)).toEqual({
      ok: false,
      messageIds: [],
      error: "Bad Request: wrong file",
    });
  });
});

describe("deliver", () => {
  const photos = new Map<string, Uint8Array>([
    ["a", new Uint8Array([1])],
    ["b", new Uint8Array([2])],
    ["c", new Uint8Array([3])],
  ]);

  function methods(fetchMock: FetchMock): string[] {
    return fetchMock.mock.calls.map((call) => String(call[0] as string).split("/").pop() ?? "");
  }

  it("sends each message in order and returns one result per message", async () => {
    const { telegram, fetchMock } = setup([
      okMessage(1),
      reply({ ok: true, result: [{ message_id: 2 }, { message_id: 3 }] }),
      okMessage(4),
    ]);
    const results = await telegram.deliver(
      [
        { kind: "photo", chatId: "555", showingKey: "a", caption: "cap" },
        {
          kind: "album",
          chatId: "555",
          items: [
            { showingKey: "b", caption: "x" },
            { showingKey: "c", caption: "y" },
          ],
        },
        {
          kind: "text",
          chatId: "555",
          text: "ciao",
          keyboard: [[{ text: "Ok", callbackData: "ok" }]],
        },
      ],
      photos,
    );
    expect(methods(fetchMock)).toEqual(["sendPhoto", "sendMediaGroup", "sendMessage"]);
    expect(results).toEqual([
      { ok: true, messageIds: [1], error: null },
      { ok: true, messageIds: [2, 3], error: null },
      { ok: true, messageIds: [4], error: null },
    ]);
    expect((jsonBody(fetchMock, 2) as { reply_markup: unknown }).reply_markup).toEqual({
      inline_keyboard: [[{ text: "Ok", callback_data: "ok" }]],
    });
  });

  it("turns a photo with a missing png into a text with the same caption", async () => {
    const { telegram, fetchMock } = setup([okMessage(1)]);
    const results = await telegram.deliver(
      [{ kind: "photo", chatId: "555", showingKey: "zzz", caption: "cap" }],
      photos,
    );
    expect(methods(fetchMock)).toEqual(["sendMessage"]);
    expect((jsonBody(fetchMock) as { text: string }).text).toBe("cap");
    expect(results).toEqual([{ ok: true, messageIds: [1], error: null }]);
  });

  it("sends a single photo when only one album png is available", async () => {
    const { telegram, fetchMock } = setup([okMessage(1)]);
    const results = await telegram.deliver(
      [
        {
          kind: "album",
          chatId: "555",
          items: [
            { showingKey: "zzz", caption: "x" },
            { showingKey: "b", caption: "y" },
          ],
        },
      ],
      photos,
    );
    expect(methods(fetchMock)).toEqual(["sendPhoto"]);
    expect(formBody(fetchMock).get("caption")).toBe("y");
    expect(results).toEqual([{ ok: true, messageIds: [1], error: null }]);
  });

  it("sends nothing when no album png is available", async () => {
    const { telegram, fetchMock } = setup();
    const results = await telegram.deliver(
      [
        {
          kind: "album",
          chatId: "555",
          items: [
            { showingKey: "zzz", caption: "x" },
            { showingKey: "yyy", caption: "y" },
          ],
        },
      ],
      photos,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(results).toEqual([{ ok: true, messageIds: [], error: null }]);
  });

  it("keeps going after a failed message", async () => {
    const { telegram } = setup([failure(400, "Bad Request: chat not found"), okMessage(2)]);
    const results = await telegram.deliver(
      [
        { kind: "text", chatId: "1", text: "a", keyboard: null },
        { kind: "text", chatId: "2", text: "b", keyboard: null },
      ],
      photos,
    );
    expect(results.map((r) => r.ok)).toEqual([false, true]);
  });
});

describe("getUpdates", () => {
  it("posts offset, timeout and allowed_updates and maps updates", async () => {
    const { telegram, fetchMock } = setup([
      reply({
        ok: true,
        result: [
          {
            update_id: 10,
            message: { message_id: 1, chat: { id: 555 }, text: "/start", from: { id: 7 } },
          },
          { update_id: 11, message: { message_id: 2, chat: { id: -100 } } },
          {
            update_id: 12,
            callback_query: {
              id: "cb1",
              from: { id: 8 },
              data: "mute:1",
              message: { chat: { id: 555 } },
            },
          },
          { update_id: 13, callback_query: { id: "cb2", from: { id: 9 }, data: "x" } },
          { update_id: 14, edited_message: { chat: { id: 1 } } },
          { update_id: 15, callback_query: { id: "cb3", from: { id: 9 } } },
        ],
      }),
    ]);
    const controller = new AbortController();
    const updates = await telegram.getUpdates(10, 30, controller.signal);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${TELEGRAM_API}/bot${TOKEN}/getUpdates`);
    const sentSignal = fetchMock.mock.calls[0]?.[1]?.signal;
    controller.abort();
    expect(sentSignal?.aborted).toBe(true);
    expect(jsonBody(fetchMock)).toEqual({
      offset: 10,
      timeout: 30,
      allowed_updates: ["message", "callback_query"],
    });
    expect(updates).toEqual([
      { updateId: 10, message: { chatId: "555", text: "/start", fromId: 7 }, callback: null },
      { updateId: 11, message: { chatId: "-100", text: "", fromId: null }, callback: null },
      {
        updateId: 12,
        message: null,
        callback: { id: "cb1", chatId: "555", data: "mute:1", fromId: 8 },
      },
      {
        updateId: 13,
        message: null,
        callback: { id: "cb2", chatId: null, data: "x", fromId: 9 },
      },
      { updateId: 14, message: null, callback: null },
      { updateId: 15, message: null, callback: null },
    ]);
  });

  it("throws a conflict error on 409", async () => {
    const { telegram } = setup([failure(409, "Conflict: terminated by other getUpdates request")]);
    await expect(telegram.getUpdates(0, 0)).rejects.toMatchObject({
      name: "TelegramError",
      kind: "conflict",
      status: 409,
    });
  });

  it("throws unauthorized without a token and on 401, never exposing the token", async () => {
    await expect(setup([], { token: null }).telegram.getUpdates(0, 0)).rejects.toMatchObject({
      kind: "unauthorized",
    });
    const { telegram } = setup([failure(401, `Unauthorized ${TOKEN}`)]);
    const error = (await telegram.getUpdates(0, 0).catch((e: unknown) => e)) as TelegramError;
    expect(error).toBeInstanceOf(TelegramError);
    expect(error.kind).toBe("unauthorized");
    expect(error.description).not.toContain(TOKEN);
    expect(error.message).not.toContain(TOKEN);
  });

  it("maps other failures to their kinds", async () => {
    await expect(setup([failure(400, "bad")]).telegram.getUpdates(0, 0)).rejects.toMatchObject({
      kind: "bad_request",
    });
    await expect(
      setup([failure(429, "slow", 1), failure(429, "slow", 1)], { maxRetries: 1 }).telegram.getUpdates(0, 0),
    ).rejects.toMatchObject({ kind: "rate_limited", status: 429 });
    await expect(
      setup([failure(500, "x"), failure(500, "x")]).telegram.getUpdates(0, 0),
    ).rejects.toMatchObject({ kind: "server", status: 500 });
    await expect(
      setup([new TypeError("down"), new TypeError("down")]).telegram.getUpdates(0, 0),
    ).rejects.toMatchObject({ kind: "network", status: null });
  });

  it("does not retry an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    const { telegram, fetchMock, clock } = setup([new DOMException("aborted", "AbortError")]);
    await expect(telegram.getUpdates(0, 30, controller.signal)).rejects.toMatchObject({
      kind: "network",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]);
  });
});

describe("getMe", () => {
  it("returns id and username", async () => {
    const { telegram, fetchMock } = setup([
      reply({ ok: true, result: { id: 99, is_bot: true, username: "cinema_bot" } }),
    ]);
    expect(await telegram.getMe()).toEqual({ id: 99, username: "cinema_bot" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${TELEGRAM_API}/bot${TOKEN}/getMe`);
  });

  it("throws unauthorized without a token and on a bad token", async () => {
    await expect(setup([], { token: null }).telegram.getMe()).rejects.toMatchObject({
      kind: "unauthorized",
    });
    await expect(setup([failure(401, "Unauthorized")]).telegram.getMe()).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("throws on a malformed result", async () => {
    await expect(
      setup([reply({ ok: true, result: { id: 1 } })]).telegram.getMe(),
    ).rejects.toBeInstanceOf(TelegramError);
  });
});

describe("answerCallbackQuery", () => {
  it("posts callback_query_id and optional text", async () => {
    const { telegram, fetchMock } = setup([
      reply({ ok: true, result: true }),
      reply({ ok: true, result: true }),
    ]);
    await telegram.answerCallbackQuery("cb1", "Fatto");
    await telegram.answerCallbackQuery("cb2");
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${TELEGRAM_API}/bot${TOKEN}/answerCallbackQuery`);
    expect(jsonBody(fetchMock, 0)).toEqual({ callback_query_id: "cb1", text: "Fatto" });
    expect(jsonBody(fetchMock, 1)).toEqual({ callback_query_id: "cb2" });
  });

  it("swallows every error", async () => {
    await expect(
      setup([failure(400, "query is too old")]).telegram.answerCallbackQuery("cb"),
    ).resolves.toBeUndefined();
    await expect(
      setup([], { token: null }).telegram.answerCallbackQuery("cb"),
    ).resolves.toBeUndefined();
  });
});

describe("hanging connections", () => {
  it("gives up on a send that never answers and keeps the chat usable", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const fetchMock = vi.fn<typeof fetch>((_url, init) => {
        calls += 1;
        if (calls > 2) return Promise.resolve(okMessage(7));
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      });
      const telegram = createTelegram({ token: () => TOKEN, fetch: fetchMock, clock: fakeClock() });
      const hanging = telegram.sendMessage("42", "hello");
      await vi.advanceTimersByTimeAsync(30_000);
      await vi.advanceTimersByTimeAsync(30_000);
      const first = await hanging;
      const second = await telegram.sendMessage("42", "again");

      expect(first.ok).toBe(false);
      expect(second).toEqual({ ok: true, messageIds: [7], error: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
