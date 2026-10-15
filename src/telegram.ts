import { z } from "zod";
import { copy } from "./copy.js";
import type { InlineButton, OutgoingMessage, SentResult } from "./model.js";

export const TELEGRAM_API = "https://api.telegram.org";

const MAX_TEXT_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;
const MIN_ALBUM_SIZE = 2;
const MAX_ALBUM_SIZE = 10;
const PRIVATE_INTERVAL_MS = 1000;
const GROUP_WINDOW_MS = 60_000;
const GROUP_LIMIT = 20;
const TRANSIENT_RETRY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const LONG_POLL_MARGIN_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const NOT_CONFIGURED = copy.errors.telegramNotConfigured;
const INVALID_RESPONSE = copy.errors.telegramInvalid;

export type TelegramErrorKind =
  | "unauthorized"
  | "bad_request"
  | "conflict"
  | "rate_limited"
  | "network"
  | "server";

export class TelegramError extends Error {
  readonly kind: TelegramErrorKind;
  readonly status: number | null;
  readonly description: string;

  constructor(kind: TelegramErrorKind, status: number | null, description: string) {
    super(description);
    this.name = "TelegramError";
    this.kind = kind;
    this.status = status;
    this.description = description;
  }
}

export interface TelegramClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface TelegramUpdate {
  updateId: number;
  message: { chatId: string; text: string; fromId: number | null } | null;
  callback: { id: string; chatId: string | null; data: string; fromId: number } | null;
}

export interface TelegramOptions {
  token: () => string | null;
  fetch?: typeof fetch;
  clock?: TelegramClock;
  maxRetries?: number;
}

export interface Telegram {
  sendMessage(chatId: string, text: string, keyboard?: InlineButton[][] | null): Promise<SentResult>;
  sendPhoto(
    chatId: string,
    png: Uint8Array,
    caption: string,
    keyboard?: InlineButton[][] | null,
  ): Promise<SentResult>;
  sendMediaGroup(
    chatId: string,
    items: Array<{ png: Uint8Array; caption: string }>,
  ): Promise<SentResult>;
  deliver(messages: OutgoingMessage[], photos: Map<string, Uint8Array>): Promise<SentResult[]>;
  answerCallbackQuery(callbackId: string, text?: string): Promise<void>;
  getUpdates(offset: number, timeoutSeconds: number, signal?: AbortSignal): Promise<TelegramUpdate[]>;
  getMe(): Promise<{ id: number; username: string }>;
}

const envelopeSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

const sentMessageSchema = z.object({ message_id: z.number() });
const sentMessagesSchema = z.array(sentMessageSchema);
const meSchema = z.object({ id: z.number(), username: z.string() });
const updatesSchema = z.array(
  z.object({
    update_id: z.number(),
    message: z
      .object({
        chat: z.object({ id: z.number() }),
        text: z.string().optional(),
        from: z.object({ id: z.number() }).optional(),
      })
      .optional(),
    callback_query: z
      .object({
        id: z.string(),
        from: z.object({ id: z.number() }),
        data: z.string().optional(),
        message: z.object({ chat: z.object({ id: z.number() }) }).optional(),
      })
      .optional(),
  }),
);

const defaultClock: TelegramClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function kindForStatus(status: number): TelegramErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

function isPrivateChat(chatId: string): boolean {
  return !chatId.startsWith("-") && !chatId.startsWith("@");
}

function replyMarkup(keyboard: InlineButton[][]): { inline_keyboard: Array<Array<Record<string, string>>> } {
  return {
    inline_keyboard: keyboard.map((row) =>
      row.map((button): Record<string, string> => {
        if (button.callbackData !== undefined) {
          return { text: button.text, callback_data: button.callbackData };
        }
        return { text: button.text, url: button.url as string };
      }),
    ),
  };
}

function pngBlob(png: Uint8Array): Blob {
  return new Blob([new Uint8Array(png)], { type: "image/png" });
}

function assertCaption(caption: string): void {
  if (caption.length > MAX_CAPTION_LENGTH) {
    throw new Error(`Didascalia oltre ${MAX_CAPTION_LENGTH} caratteri`);
  }
}

function failed(error: string): SentResult {
  return { ok: false, messageIds: [], error };
}

export function createTelegram(options: TelegramOptions): Telegram {
  const doFetch = options.fetch ?? fetch;
  const clock = options.clock ?? defaultClock;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const lastPrivateAt = new Map<string, number>();
  const groupSends = new Map<string, number[]>();
  const queues = new Map<string, Promise<unknown>>();

  function enqueue<T>(chatId: string, job: () => Promise<T>): Promise<T> {
    const run = (queues.get(chatId) ?? Promise.resolve()).then(job);
    queues.set(chatId, run.catch(() => undefined));
    return run;
  }

  async function throttle(chatId: string, units: number): Promise<void> {
    if (isPrivateChat(chatId)) {
      const wait = (lastPrivateAt.get(chatId) ?? -Infinity) + PRIVATE_INTERVAL_MS - clock.now();
      if (wait > 0) await clock.sleep(wait);
      lastPrivateAt.set(chatId, clock.now());
      return;
    }
    let times = groupSends.get(chatId) ?? [];
    for (;;) {
      const windowStart = clock.now() - GROUP_WINDOW_MS;
      times = times.filter((time) => time > windowStart);
      const oldest = times[0];
      if (oldest === undefined || times.length + units <= GROUP_LIMIT) break;
      await clock.sleep(oldest + GROUP_WINDOW_MS - clock.now());
    }
    const now = clock.now();
    for (let i = 0; i < units; i++) times.push(now);
    groupSends.set(chatId, times);
  }

  async function attempt(
    token: string,
    method: string,
    body: Record<string, unknown> | FormData,
    signal: AbortSignal | undefined,
    timeoutMs: number,
  ): Promise<{ status: number; text: string } | TelegramError> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), timeoutMs);
    const init: RequestInit = {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
      ...(body instanceof FormData ? {} : { headers: { "content-type": "application/json" } }),
      signal: signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal]),
    };
    try {
      const response = await doFetch(`${TELEGRAM_API}/bot${token}/${method}`, init);
      return { status: response.status, text: await response.text() };
    } catch (error) {
      const message = timeout.signal.aborted ? `Nessuna risposta in ${timeoutMs / 1000} s` : error instanceof Error ? error.message : String(error);
      return new TelegramError("network", null, message.split(token).join("***"));
    } finally {
      clearTimeout(timer);
    }
  }

  function parseEnvelope(text: string): z.infer<typeof envelopeSchema> | null {
    try {
      const parsed = envelopeSchema.safeParse(JSON.parse(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async function request<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const token = options.token();
    if (token === null) throw new TelegramError("unauthorized", null, NOT_CONFIGURED);
    let rateRetries = 0;
    let transientRetried = false;
    for (;;) {
      const outcome = await attempt(token, method, body, signal, timeoutMs);
      let retryAfter = 1;
      let failure: TelegramError;
      if (outcome instanceof TelegramError) {
        failure = outcome;
      } else {
        const envelope = parseEnvelope(outcome.text);
        if (outcome.status >= 200 && outcome.status < 300) {
          const result = envelope?.ok === true ? schema.safeParse(envelope.result) : null;
          if (result?.success !== true) {
            throw new TelegramError("server", outcome.status, INVALID_RESPONSE);
          }
          return result.data;
        }
        retryAfter = envelope?.parameters?.retry_after ?? 1;
        const description = (envelope?.description ?? `HTTP ${outcome.status}`)
          .split(token)
          .join("***");
        failure = new TelegramError(kindForStatus(outcome.status), outcome.status, description);
      }
      if (failure.kind === "rate_limited" && rateRetries < maxRetries) {
        rateRetries++;
        await clock.sleep(retryAfter * 1000);
        continue;
      }
      const transient = failure.status === null || failure.status >= 500;
      if (transient && !transientRetried && signal?.aborted !== true) {
        transientRetried = true;
        await clock.sleep(TRANSIENT_RETRY_MS);
        continue;
      }
      throw failure;
    }
  }

  async function requestWithFallback<T>(
    method: string,
    body: Record<string, unknown> | FormData,
    fallbackBody: Record<string, unknown> | null,
    units: number,
    chatId: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
    try {
      return await request(method, body, schema);
    } catch (error) {
      if (fallbackBody === null || !(error instanceof TelegramError) || error.kind !== "bad_request") throw error;
      await throttle(chatId, units);
      return await request(method, fallbackBody, schema);
    }
  }

  async function send<T>(
    chatId: string,
    units: number,
    method: string,
    body: Record<string, unknown> | FormData,
    schema: z.ZodType<T>,
    ids: (result: T) => number[],
    fallbackBody: Record<string, unknown> | null = null,
  ): Promise<SentResult> {
    if (options.token() === null) return failed(NOT_CONFIGURED);
    return enqueue(chatId, async () => {
      await throttle(chatId, units);
      try {
        const result = await requestWithFallback(method, body, fallbackBody, units, chatId, schema);
        return { ok: true, messageIds: ids(result), error: null };
      } catch (error) {
        return failed(error instanceof TelegramError ? error.description : INVALID_RESPONSE);
      }
    });
  }

  async function sendMessage(
    chatId: string,
    text: string,
    keyboard: InlineButton[][] | null = null,
  ): Promise<SentResult> {
    if (text.length > MAX_TEXT_LENGTH) throw new Error(`Testo oltre ${MAX_TEXT_LENGTH} caratteri`);
    const plain: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    };
    if (keyboard === null) {
      return await send(chatId, 1, "sendMessage", plain, sentMessageSchema, (r) => [r.message_id]);
    }
    const body = { ...plain, reply_markup: replyMarkup(keyboard) };
    return await send(chatId, 1, "sendMessage", body, sentMessageSchema, (r) => [r.message_id], plain);
  }

  async function sendPhoto(
    chatId: string,
    png: Uint8Array,
    caption: string,
    keyboard: InlineButton[][] | null = null,
  ): Promise<SentResult> {
    assertCaption(caption);
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
    if (keyboard !== null) form.append("reply_markup", JSON.stringify(replyMarkup(keyboard)));
    form.append("photo", pngBlob(png), "photo.png");
    return await send(chatId, 1, "sendPhoto", form, sentMessageSchema, (r) => [r.message_id]);
  }

  async function sendMediaGroup(
    chatId: string,
    items: Array<{ png: Uint8Array; caption: string }>,
  ): Promise<SentResult> {
    if (items.length < MIN_ALBUM_SIZE || items.length > MAX_ALBUM_SIZE) {
      throw new Error(`Un album ha da ${MIN_ALBUM_SIZE} a ${MAX_ALBUM_SIZE} elementi`);
    }
    items.forEach((item) => {
      assertCaption(item.caption);
    });
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append(
      "media",
      JSON.stringify(
        items.map((item, index) => ({
          type: "photo",
          media: `attach://p${index}`,
          caption: item.caption,
          parse_mode: "HTML",
        })),
      ),
    );
    items.forEach((item, index) => {
      form.append(`p${index}`, pngBlob(item.png), `p${index}.png`);
    });
    return await send(chatId, items.length, "sendMediaGroup", form, sentMessagesSchema, (r) =>
      r.map((m) => m.message_id),
    );
  }

  async function deliverOne(
    message: OutgoingMessage,
    photos: Map<string, Uint8Array>,
  ): Promise<SentResult> {
    if (message.kind === "text") {
      return sendMessage(message.chatId, message.text, message.keyboard);
    }
    if (message.kind === "photo") {
      const png = photos.get(message.showingKey);
      if (png === undefined) return sendMessage(message.chatId, message.caption);
      return sendPhoto(message.chatId, png, message.caption);
    }
    const available = message.items.flatMap((item) => {
      const png = photos.get(item.showingKey);
      return png === undefined ? [] : [{ png, caption: item.caption }];
    });
    const [only] = available;
    if (only === undefined) return { ok: true, messageIds: [], error: null };
    if (available.length === 1) return sendPhoto(message.chatId, only.png, only.caption);
    return sendMediaGroup(message.chatId, available);
  }

  async function deliver(
    messages: OutgoingMessage[],
    photos: Map<string, Uint8Array>,
  ): Promise<SentResult[]> {
    const results: SentResult[] = [];
    for (const message of messages) results.push(await deliverOne(message, photos));
    return results;
  }

  async function answerCallbackQuery(callbackId: string, text?: string): Promise<void> {
    try {
      await request(
        "answerCallbackQuery",
        { callback_query_id: callbackId, ...(text === undefined ? {} : { text }) },
        z.unknown(),
      );
    } catch {
      return;
    }
  }

  async function getUpdates(
    offset: number,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TelegramUpdate[]> {
    const updates = await request(
      "getUpdates",
      { offset, timeout: timeoutSeconds, allowed_updates: ["message", "callback_query"] },
      updatesSchema,
      signal,
      timeoutSeconds * 1000 + LONG_POLL_MARGIN_MS,
    );
    return updates.map((update) => {
      const message = update.message;
      const callback = update.callback_query;
      return {
        updateId: update.update_id,
        message:
          message === undefined
            ? null
            : {
                chatId: String(message.chat.id),
                text: message.text ?? "",
                fromId: message.from?.id ?? null,
              },
        callback:
          callback?.data === undefined
            ? null
            : {
                id: callback.id,
                chatId: callback.message === undefined ? null : String(callback.message.chat.id),
                data: callback.data,
                fromId: callback.from.id,
              },
      };
    });
  }

  function getMe(): Promise<{ id: number; username: string }> {
    return request("getMe", {}, meSchema);
  }

  return { sendMessage, sendPhoto, sendMediaGroup, deliver, answerCallbackQuery, getUpdates, getMe };
}
