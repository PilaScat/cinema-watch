import { describe, it, expect, vi } from "vitest";
import { createHttpClient } from "../src/http.js";
import { HttpError } from "../src/errors.js";

const URL_A = "https://a.example.com/x";
const URL_B = "https://b.example.com/y";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), init);
}

function setup(
  fetchImpl: (...args: Parameters<typeof fetch>) => Response | Promise<Response>,
  extra: object = {},
) {
  const fetchMock = vi.fn((...args: Parameters<typeof fetch>) => Promise.resolve(fetchImpl(...args)));
  let clock = 1_000_000;
  const client = createHttpClient({
    allowedHosts: ["a.example.com", "b.example.com"],
    userAgent: "test-agent/1.0",
    fetch: fetchMock,
    now: () => clock,
    ...extra,
  });
  return {
    client,
    fetchMock,
    advance: (ms: number) => {
      clock += ms;
    },
    clock: () => clock,
  };
}

async function catchHttpError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    return error as HttpError;
  }
  throw new Error("expected rejection");
}

describe("request validation", () => {
  it("rejects hosts that are not allowed without calling fetch", async () => {
    const { client, fetchMock } = setup(() => jsonResponse({}));
    const error = await catchHttpError(client.getJson("https://evil.example.org/x"));
    expect(error.kind).toBe("host");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects http:// and invalid URLs", async () => {
    const { client, fetchMock } = setup(() => jsonResponse({}));
    expect((await catchHttpError(client.getJson("http://a.example.com/x"))).kind).toBe("host");
    expect((await catchHttpError(client.getJson("not a url"))).kind).toBe("host");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("request shape", () => {
  it("sends User-Agent, Accept and extra headers with manual redirects", async () => {
    const { client, fetchMock } = setup(() => jsonResponse({ ok: true }));
    const result = await client.getJson(URL_A, { headers: { Referer: "https://ucicinemas.it" } });
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_A);
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("manual");
    expect(init.headers).toEqual({
      "User-Agent": "test-agent/1.0",
      Accept: "application/json",
      Referer: "https://ucicinemas.it",
    });
  });

  it("postJson adds Content-Type and a JSON body", async () => {
    const { client, fetchMock } = setup(() => jsonResponse({ ok: 1 }));
    await client.postJson(URL_A, { a: [1, 2] });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"a":[1,2]}');
    expect(init.headers).toMatchObject({ "Content-Type": "application/json", "User-Agent": "test-agent/1.0" });
  });

  it("honours a caller abort signal as a network error", async () => {
    const controller = new AbortController();
    const { client } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new Error("aborted"));
          }
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const pending = catchHttpError(client.getJson(URL_A, { signal: controller.signal }));
    controller.abort();
    expect((await pending).kind).toBe("network");
  });
});

describe("error classification", () => {
  it("maps redirects", async () => {
    const { client } = setup(() => new Response(null, { status: 302, headers: { location: "https://x" } }));
    const error = await catchHttpError(client.getJson(URL_A));
    expect(error.kind).toBe("redirect");
    expect(error.status).toBe(302);
    expect(client.hostStatus("a.example.com")).toBeNull();
  });

  it("maps timeouts", async () => {
    const { client } = setup(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
      { timeoutMs: 20 },
    );
    const error = await catchHttpError(client.getJson(URL_A));
    expect(error.kind).toBe("timeout");
    expect(client.hostStatus("a.example.com")?.failures).toBe(1);
  });

  it("maps network errors, including non-Error causes", async () => {
    const first = setup(() => {
      throw new TypeError("fetch failed");
    });
    const error = await catchHttpError(first.client.getJson(URL_A));
    expect(error.kind).toBe("network");
    expect(error.message).toBe("fetch failed");
    const second = setup(() => Promise.reject(Object.create(null) as Error));
    expect((await catchHttpError(second.client.getJson(URL_A))).message).toBe("Network error");
  });

  it("maps a failure while reading the body", async () => {
    const broken = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("stream broke"));
        },
      }),
    );
    const { client } = setup(() => broken);
    expect((await catchHttpError(client.getJson(URL_A))).kind).toBe("network");
  });

  it("maps non-JSON bodies to parse without backoff", async () => {
    const { client } = setup(() => new Response("<html>", { status: 200 }));
    expect((await catchHttpError(client.getJson(URL_A))).kind).toBe("parse");
    expect(client.hostStatus("a.example.com")).toBeNull();
  });

  it("does not put the host in backoff on 404", async () => {
    const { client, fetchMock } = setup(() => new Response("nope", { status: 404 }));
    const error = await catchHttpError(client.getJson(URL_A));
    expect(error.kind).toBe("status");
    expect(error.status).toBe(404);
    await catchHttpError(client.getJson(URL_A));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.hostStatus("a.example.com")).toBeNull();
  });
});

describe("backoff", () => {
  it("rejects requests during backoff without fetching, then allows them again", async () => {
    const { client, fetchMock, advance } = setup(() => new Response("err", { status: 500 }), {
      backoffBaseMs: 1000,
    });
    expect((await catchHttpError(client.getJson(URL_A))).status).toBe(500);
    const blocked = await catchHttpError(client.getJson(URL_A));
    expect(blocked.kind).toBe("backoff");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    advance(1000);
    expect((await catchHttpError(client.getJson(URL_A))).kind).toBe("status");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("grows exponentially up to the cap and resets on success", async () => {
    let fail = true;
    const { client, advance, clock } = setup(
      () => (fail ? new Response("err", { status: 502 }) : jsonResponse({ ok: true })),
      { backoffBaseMs: 1000, backoffMaxMs: 3000 },
    );
    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const before = clock();
      await catchHttpError(client.getJson(URL_A));
      const status = client.hostStatus("a.example.com");
      waits.push((status?.until ?? 0) - before);
      expect(status?.failures).toBe(i + 1);
      advance(10_000);
    }
    expect(waits).toEqual([1000, 2000, 3000, 3000]);
    fail = false;
    await client.getJson(URL_A);
    expect(client.hostStatus("a.example.com")).toBeNull();
  });

  it("uses Retry-After on 429 and 503 when larger than the computed wait", async () => {
    const { client, clock } = setup(
      () => new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }),
      { backoffBaseMs: 1000 },
    );
    const before = clock();
    const error = await catchHttpError(client.getJson(URL_A));
    expect(error.status).toBe(429);
    expect(error.retryAfterMs).toBe(120_000);
    expect(client.hostStatus("a.example.com")?.until).toBe(before + 120_000);

    const second = setup(() => new Response("busy", { status: 503, headers: { "Retry-After": "1" } }), {
      backoffBaseMs: 5000,
    });
    const before2 = second.clock();
    await catchHttpError(second.client.getJson(URL_A));
    expect(second.client.hostStatus("a.example.com")?.until).toBe(before2 + 5000);
  });

  it("ignores an invalid or missing Retry-After and non-429/503 statuses", async () => {
    const invalid = setup(() => new Response("x", { status: 429, headers: { "Retry-After": "soon" } }));
    expect((await catchHttpError(invalid.client.getJson(URL_A))).retryAfterMs).toBeNull();
    const missing = setup(() => new Response("x", { status: 429 }));
    expect((await catchHttpError(missing.client.getJson(URL_A))).retryAfterMs).toBeNull();
    const other = setup(() => new Response("x", { status: 500, headers: { "Retry-After": "5" } }));
    expect((await catchHttpError(other.client.getJson(URL_A))).retryAfterMs).toBeNull();
  });

  it("is tracked per host", async () => {
    const { client } = setup((url) =>
      (typeof url === "string" && new URL(url).hostname === "a.example.com") ? new Response("err", { status: 500 }) : jsonResponse({ ok: true }),
    );
    await catchHttpError(client.getJson(URL_A));
    expect(await client.getJson(URL_B)).toEqual({ ok: true });
    expect((await catchHttpError(client.getJson(URL_A))).kind).toBe("backoff");
  });
});

describe("concurrency", () => {
  function gatedFetch() {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    const impl = (): Promise<Response> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve(jsonResponse({ ok: true }));
        });
      });
    };
    return { impl, releases, maxActive: () => maxActive };
  }

  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  it("serialises requests to the same host", async () => {
    const gate = gatedFetch();
    const { client, fetchMock } = setup(gate.impl);
    const first = client.getJson(URL_A);
    const second = client.getJson(URL_A);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    gate.releases[0]?.();
    await first;
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    gate.releases[1]?.();
    await second;
    expect(gate.maxActive()).toBe(1);
  });

  it("runs different hosts in parallel", async () => {
    const gate = gatedFetch();
    const { client, fetchMock } = setup(gate.impl);
    const first = client.getJson(URL_A);
    const second = client.getJson(URL_B);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    gate.releases.forEach((release) => release());
    await Promise.all([first, second]);
    expect(gate.maxActive()).toBe(2);
  });

  it("keeps the queue going after a failure", async () => {
    let call = 0;
    const { client } = setup(() => {
      call += 1;
      return call === 1 ? new Response("x", { status: 404 }) : jsonResponse({ n: call });
    });
    const first = catchHttpError(client.getJson(URL_A));
    const second = client.getJson(URL_A);
    expect((await first).status).toBe(404);
    expect(await second).toEqual({ n: 2 });
  });
});

describe("defaults", () => {
  it("uses global fetch and Date.now when not injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));
    const client = createHttpClient({ allowedHosts: ["a.example.com"], userAgent: "ua" });
    expect(await client.getJson(URL_A)).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
