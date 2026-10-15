import { readFileSync } from "node:fs";

export const FAKE_TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghijklmn";

export interface TelegramCall {
  method: string;
  chatId: string | null;
  text: string | null;
  caption: string | null;
  photos: number;
  replyMarkup: unknown;
}

export interface FakeWorld {
  fetch: typeof fetch;
  telegram: TelegramCall[];
  requests: string[];
  setProgramming(theatreSlug: string, day: string, json: unknown): void;
  setOccupancy(localId: number, performanceId: number, json: unknown): void;
  failHost(host: string, status: number): void;
  pushUpdate(update: unknown): void;
  conflictOnPoll(on?: boolean): void;
  restoreHost(host: string): void;
  latestRelease: string;
}

export function fixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8"));
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body === "string") return JSON.parse(init.body) as Record<string, unknown>;
  if (init?.body instanceof FormData) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of init.body.entries()) fields[key] = value;
    return fields;
  }
  return {};
}

function countPhotos(fields: Record<string, unknown>): number {
  return Object.values(fields).filter((value) => value instanceof Blob).length;
}

function maybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value ?? null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function createFakeWorld(): FakeWorld {
  const programming = new Map<string, unknown>([
    ["uci-cinemas-verona|2026-12-15", fixture("uci/programming-uci-cinemas-verona-2026-12-15.json")],
    ["uci-cinemas-verona|2026-12-16", fixture("uci/programming-uci-cinemas-verona-2026-12-16.json")],
  ]);
  const occupancies = new Map<string, unknown>();
  const failing = new Map<string, number>();
  const telegram: TelegramCall[] = [];
  const updates: unknown[] = [];
  let pollConflict = false;
  const requests: string[] = [];
  let messageId = 1000;

  const world: FakeWorld = {
    telegram,
    requests,
    latestRelease: "v2026.10.1",
    setProgramming: (theatreSlug, day, body) => programming.set(`${theatreSlug}|${day}`, body),
    setOccupancy: (localId, performanceId, body) => occupancies.set(`${localId}-${performanceId}`, body),
    failHost: (host, status) => failing.set(host, status),
    restoreHost: (host) => failing.delete(host),
    pushUpdate: (update) => updates.push(update),
    conflictOnPoll: (on = true) => {
      pollConflict = on;
    },
    fetch: (input, init) => Promise.resolve(respond(input, init)),
  };

  function respond(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): Response {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      requests.push(`${init?.method ?? "GET"} ${url.hostname}${url.pathname}`);
      const failure = failing.get(url.hostname);
      if (failure !== undefined) return json({ message: "down" }, failure);
      const body = bodyOf(init);

      if (url.hostname.startsWith("myuci---")) {
        const path = url.pathname.replace(/^\/api/, "");
        if (path === "/theatres") return json(fixture("uci/theatres.json"));
        const day = /^\/theatres\/([a-z0-9-]+)\/programming\/(\d{4}-\d{2}-\d{2})$/.exec(path);
        if (day) return json(programming.get(`${day[1]}|${day[2]}`) ?? { data: [] });
        if (path === "/movies/dune-parte-tre") return json(fixture("uci/movie-dune-parte-tre.json"));
        if (path === "/movies/dune-parte-tre/theatres") return json(fixture("uci/movie-dune-parte-tre-theatres.json"));
        return json({ message: "API Endpoint Not Found" }, 404);
      }

      if (url.hostname.startsWith("uci-website-webtic-proxy")) {
        const method = url.pathname.split("/").pop();
        const localId = Number(body.LocalId);
        if (method === "Performance") return json(fixture(`webtic/performance-${localId}-${Number(body.PerformanceId)}.json`));
        if (method === "Screen") return json(fixture(`webtic/screen-${localId}-${Number(body.ScreenId)}.json`));
        if (method === "Occupancy") {
          const key = `${localId}-${Number(body.PerformanceId)}`;
          return json(occupancies.get(key) ?? fixture(`webtic/occupancy-${key}.json`));
        }
      }

      if (url.hostname === "api.telegram.org") {
        const method = url.pathname.split("/").pop() ?? "";
        if (method === "getUpdates") {
          if (pollConflict) return json({ ok: false, error_code: 409, description: "Conflict: terminated by other getUpdates request" }, 409);
          const offset = typeof body.offset === "number" ? body.offset : 0;
          const pending = updates.filter((update) => (update as { update_id: number }).update_id >= offset);
          return json({ ok: true, result: pending });
        }
        if (method === "getMe") return json({ ok: true, result: { id: 1, is_bot: true, username: "cinema_watch_test_bot" } });
        if (method === "answerCallbackQuery") {
          telegram.push({ method, chatId: null, text: typeof body.text === "string" ? body.text : null, caption: null, photos: 0, replyMarkup: null });
          return json({ ok: true, result: true });
        }
        const media = maybeJson(body.media);
        telegram.push({
          method,
          chatId: typeof body.chat_id === "string" || typeof body.chat_id === "number" ? String(body.chat_id) : null,
          text: typeof body.text === "string" ? body.text : null,
          caption: typeof body.caption === "string" ? body.caption : Array.isArray(media) ? String((media[0] as { caption?: string }).caption ?? "") : null,
          photos: countPhotos(body),
          replyMarkup: maybeJson(body.reply_markup),
        });
        messageId += 1;
        return json({ ok: true, result: method === "sendMediaGroup" ? [{ message_id: messageId }] : { message_id: messageId } });
      }

      if (url.hostname === "api.github.com") {
        return json({ tag_name: world.latestRelease, html_url: `https://github.com/PilaScat/cinema-watch/releases/tag/${world.latestRelease}` });
      }

      return json({ message: `unexpected ${url.href}` }, 599);
  }

  return world;
}
