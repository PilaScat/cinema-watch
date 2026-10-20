import { readFileSync } from "node:fs";

export const SPACE_TOKEN = "microservicesToken=guest-token";
import { fakeBotToken } from "./tokens.js";

export const FAKE_TOKEN = fakeBotToken(123456789, "f");

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
  webticCalls: string[];
  spaceCalls: string[];
  t18Calls: string[];
  setT18Page(host: string, path: string, body: string | number): void;
  setSpaceProgramming(cinemaId: string, json: unknown): void;
  expireSpaceToken(): void;
  setProgramming(theatreSlug: string, day: string, json: unknown): void;
  setOccupancy(localId: number, performanceId: number, json: unknown): void;
  setScheduling(localId: number, json: unknown): void;
  failHost(host: string, status: number): void;
  pushUpdate(update: unknown): void;
  conflictOnPoll(on?: boolean): void;
  restoreHost(host: string): void;
  latestRelease: string;
}

export const T18_PROJECTION = "097c8f93-6c1c-459d-bb22-1d5457272000";
export const T18_THEATER = "a4999780-a922-4814-a65b-c3b5b6f78fc8";

export function fixture(path: string): unknown {
  return JSON.parse(readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8"));
}

export function textFixture(path: string): string {
  return readFileSync(new URL(`../fixtures/${path}`, import.meta.url), "utf8");
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
  const schedulings = new Map<number, unknown>([
    [5779, fixture("webtic-direct/scheduling-5779.json")],
    [5851, fixture("webtic-direct/scheduling-5851.json")],
  ]);
  const failing = new Map<string, number>();
  const telegram: TelegramCall[] = [];
  const updates: unknown[] = [];
  let pollConflict = false;
  const requests: string[] = [];
  const webticCalls: string[] = [];
  const spaceCalls: string[] = [];
  const t18Calls: string[] = [];
  const t18Pages = new Map<string, string | number>([
    ["roma.andromeda.18tickets.it/", textFixture("t18/home-roma-andromeda.html")],
    ["roma.andromeda.18tickets.it/film/81500", textFixture("t18/film-roma-andromeda-81500.html")],
    [`roma.andromeda.18tickets.it/theater/${T18_THEATER}.svg`, textFixture(`t18/theater-${T18_THEATER}.svg`)],
    [`roma.andromeda.18tickets.it/seats/${T18_PROJECTION}`, textFixture(`t18/seats-${T18_PROJECTION}.json`)],
    ["ccroma.18tickets.it/", textFixture("t18/home-ccroma.html")],
    ["cdr.18tickets.it/", 302],
    ["cdr.18tickets.it/select_cinema?mandatory=true", textFixture("t18/select-cdr.html")],
  ]);
  const spaceProgramming = new Map<string, unknown>([["1028", fixture("space/programming-1028.json")]]);
  let spaceToken = SPACE_TOKEN;
  let messageId = 1000;

  const world: FakeWorld = {
    telegram,
    requests,
    webticCalls,
    spaceCalls,
    t18Calls,
    setT18Page: (host, path, body) => t18Pages.set(`${host}${path}`, body),
    setSpaceProgramming: (cinemaId, body) => spaceProgramming.set(cinemaId, body),
    expireSpaceToken: () => {
      spaceToken = "microservicesToken=renewed-token";
    },
    latestRelease: "v2026.10.1",
    setProgramming: (theatreSlug, day, body) => programming.set(`${theatreSlug}|${day}`, body),
    setOccupancy: (localId, performanceId, body) => occupancies.set(`${localId}-${performanceId}`, body),
    setScheduling: (localId, body) => schedulings.set(localId, body),
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
        const all = /^\/theatres\/([a-z0-9-]+)\/programming$/.exec(path);
        if (all) {
          const days = [...programming.entries()]
            .filter(([key]) => key.startsWith(`${all[1]}|`))
            .map(([key, body]) => ({ [key.split("|")[1] ?? ""]: (body as { data: unknown[] }).data }));
          return json({ data: days });
        }
        const day = /^\/theatres\/([a-z0-9-]+)\/programming\/(\d{4}-\d{2}-\d{2})$/.exec(path);
        if (day) return json(programming.get(`${day[1]}|${day[2]}`) ?? { data: [] });
        if (path === "/movies") return json(fixture("uci/movies.json"));
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

      if (url.hostname === "secure.webtic.it") {
        const wtid = url.searchParams.get("wtid");
        webticCalls.push(wtid ?? "");
        const data = (body.data ?? {}) as Record<string, unknown>;
        const dead = fixture("webtic-direct/scheduling-dead.json");
        if (wtid === "getLocalsTitles") return json(fixture("webtic-direct/locals.json"));
        if (wtid === "getFullScheduling") return json(schedulings.get(Number(url.searchParams.get("localid"))) ?? dead);
        if (wtid === "getPerformanceInfo") {
          const key = `${url.searchParams.get("localid") ?? ""}-${url.searchParams.get("performanceid") ?? ""}`;
          return json(key === "5779-51133" ? fixture("webtic-direct/performance-5779-51133.json") : dead);
        }
        if (wtid === "getMapSeats") return json(`${String(data.LocalId)}-${String(data.ScreenId)}` === "5779-233" ? fixture("webtic-direct/map-5779-233.json") : dead);
        if (wtid === "getOccupancy") {
          const key = `${String(data.LocalId)}-${String(data.PerformanceId)}`;
          return json(occupancies.get(key) ?? (key === "5779-51133" ? fixture("webtic-direct/occupancy-5779-51133.json") : dead));
        }
      }

      if (url.hostname.endsWith(".18tickets.it")) {
        const page = `${url.hostname}${url.pathname}${url.search}`;
        t18Calls.push(page);
        const body = t18Pages.get(page);
        if (body === 302) return new Response("", { status: 302, headers: { location: `https://${url.hostname}/select_cinema?mandatory=true` } });
        if (typeof body === "number") return new Response("", { status: body });
        if (body === undefined) return new Response("", { status: 404 });
        return new Response(body, { status: 200, headers: { "content-type": url.pathname.startsWith("/seats/") ? "application/json" : "text/html; charset=utf-8" } });
      }

      if (url.hostname === "www.thespacecinema.it") {
        const path = url.pathname.replace(/^\/api\/microservice/, "");
        spaceCalls.push(path);
        if (path === "/auth/token") {
          const headers = new Headers({ "content-type": "application/json" });
          headers.append("set-cookie", `${spaceToken}; Path=/; HttpOnly`);
          headers.append("set-cookie", "microservicesRefreshToken=refresh; Path=/; HttpOnly");
          headers.append("set-cookie", "accessTokenExpirationTime=later; Path=/");
          headers.append("set-cookie", "__cflb=node-a; Path=/; HttpOnly");
          return new Response(JSON.stringify({ accessToken: null }), { status: 200, headers });
        }
        if (path === "/cinema/beinasco/al-cinema") return new Response(textFixture("space/cinema-beinasco.html"), { status: 200 });
        if (path.startsWith("/cinema/")) return new Response("<html></html>", { status: 200 });
        const cookie = new Headers(init?.headers).get("cookie") ?? "";
        if (!cookie.includes(spaceToken) || !cookie.includes("__cflb=node-a")) return new Response("", { status: 401 });
        if (path === "/showings/cinemas") return json(fixture("space/cinemas.json"));
        if (path === "/showings/films") return json(fixture("space/films.json"));
        const programming = /^\/showings\/cinemas\/(\d+)\/films$/.exec(path);
        if (programming) return json(spaceProgramming.get(programming[1] ?? "") ?? { result: [], responseCode: 0, errorMessage: null });
        if (path === "/booking/Session/1028/58489/seats") return json(fixture("space/seats-1028-58489.json"));
        return new Response("", { status: 404 });
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
