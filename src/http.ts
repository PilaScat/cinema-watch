import { HttpError } from "./errors.js";
import type { HttpClient, HttpRequestOptions } from "./types.js";

export interface HttpClientOptions {
  allowedHosts: string[];
  userAgent: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  now?: () => number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  retryDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface HostState {
  failures: number;
  until: number;
}

function retryAfterMsOf(response: Response): number | null {
  if (response.status !== 429 && response.status !== 503) {
    return null;
  }
  const header = response.headers.get("retry-after");
  const seconds = Number(header);
  return header !== null && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

function allowedUrl(url: string, allowed: Set<string>): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError("host", "", `Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:" || !allowed.has(parsed.hostname)) {
    throw new HttpError("host", parsed.hostname, `Host not allowed: ${parsed.protocol}//${parsed.hostname}`);
  }
  return parsed;
}

export type GuardedFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createGuardedFetch(allowedHosts: string[], doFetch: typeof fetch = globalThis.fetch): GuardedFetch {
  const allowed = new Set(allowedHosts);
  return async (url, init = {}) => doFetch(allowedUrl(url, allowed).toString(), { ...init, redirect: "manual" });
}

function countsAsHostFailure(error: HttpError): boolean {
  if (error.kind === "timeout" || error.kind === "network") {
    return true;
  }
  return error.kind === "status" && error.status !== null && (error.status >= 500 || error.status === 429);
}

const RETRIED_STATUSES = new Set([502, 503, 504]);

function worthRetrying(error: unknown, signal: AbortSignal | undefined): boolean {
  if (!(error instanceof HttpError) || signal?.aborted === true) {
    return false;
  }
  if (error.kind === "network") {
    return true;
  }
  return error.kind === "status" && error.status !== null && RETRIED_STATUSES.has(error.status) && error.retryAfterMs === null;
}

export function createHttpClient(
  options: HttpClientOptions,
): HttpClient & { hostStatus(host: string): { failures: number; until: number } | null } {
  const allowed = new Set(options.allowedHosts);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const backoffBaseMs = options.backoffBaseMs ?? 30_000;
  const backoffMaxMs = options.backoffMaxMs ?? 1_800_000;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const states = new Map<string, HostState>();
  const queues = new Map<string, Promise<unknown>>();

  function registerFailure(host: string, error: HttpError): void {
    const failures = (states.get(host)?.failures ?? 0) + 1;
    const computed = Math.min(backoffBaseMs * 2 ** (failures - 1), backoffMaxMs);
    const wait = Math.max(computed, error.retryAfterMs ?? 0);
    states.set(host, { failures, until: now() + wait });
  }

  function assertNotInBackoff(host: string): void {
    const state = states.get(host);
    if (state && now() < state.until) {
      throw new HttpError("backoff", host, `Host in backoff for ${state.until - now()} ms`);
    }
  }

  async function perform(parsed: URL, init: RequestInit, extra: HttpRequestOptions | undefined): Promise<unknown> {
    const host = parsed.hostname;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = extra?.signal ? AbortSignal.any([timeoutSignal, extra.signal]) : timeoutSignal;
    const failure = (cause: unknown): HttpError =>
      timeoutSignal.aborted
        ? new HttpError("timeout", host, `Timeout after ${timeoutMs} ms`)
        : new HttpError("network", host, cause instanceof Error ? cause.message : "Network error");

    let response: Response;
    try {
      response = await doFetch(parsed.toString(), { ...init, redirect: "manual", signal });
    } catch (cause) {
      throw failure(cause);
    }
    if (response.status >= 300 && response.status < 400) {
      throw new HttpError("redirect", host, `Redirect ${response.status}`, response.status);
    }
    if (!response.ok) {
      throw new HttpError("status", host, `Status ${response.status}`, response.status, retryAfterMsOf(response));
    }
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      throw failure(cause);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError("parse", host, "Response is not JSON");
    }
  }

  async function execute(
    url: string,
    init: RequestInit,
    extra: HttpRequestOptions | undefined,
  ): Promise<unknown> {
    const parsed = allowedUrl(url, allowed);
    const host = parsed.hostname;
    const headers = { "User-Agent": options.userAgent, Accept: "application/json", ...init.headers, ...extra?.headers };
    const run = async (): Promise<unknown> => {
      assertNotInBackoff(host);
      const attempt = () => perform(parsed, { ...init, headers }, extra);
      try {
        const result = await attempt().catch(async (error: unknown) => {
          if (retryDelayMs <= 0 || !worthRetrying(error, extra?.signal)) throw error;
          await sleep(retryDelayMs);
          return attempt();
        });
        states.delete(host);
        return result;
      } catch (error) {
        if (error instanceof HttpError && countsAsHostFailure(error)) {
          registerFailure(host, error);
        }
        throw error;
      }
    };
    const previous = queues.get(host) ?? Promise.resolve();
    const task = previous.then(run);
    queues.set(
      host,
      task.catch(() => undefined),
    );
    return task;
  }

  return {
    getJson: (url, requestOptions) => execute(url, { method: "GET" }, requestOptions),
    postJson: (url, body, requestOptions) =>
      execute(
        url,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
        requestOptions,
      ),
    hostStatus(host) {
      const state = states.get(host);
      return state ? { failures: state.failures, until: state.until } : null;
    },
  };
}
