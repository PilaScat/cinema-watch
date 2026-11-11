import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/model.js";
import { createApp } from "../src/web/app.js";
import { askingFor } from "./support/web.js";
import { createLockout } from "../src/web/auth.js";
import { createHarness, type Harness } from "./support/harness.js";

const publicDir = fileURLToPath(new URL("../src/web/public/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));
const DAY = 24 * 60 * 60_000;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function app(options: { env?: NodeJS.ProcessEnv; mutate?: (config: Config) => void; warnings?: string[] } = {}) {
  await harness.seed(options.mutate);
  return appOnSameData(options);
}

async function appOnSameData(options: { env?: NodeJS.ProcessEnv; warnings?: string[] } = {}) {
  const watcher = await harness.watcher();
  return askingFor(await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: options.env ?? {}, now: () => harness.now(), publicDir, assetsDir }), "it");
}

function login(password: string, headers: Record<string, string> = {}) {
  return {
    method: "POST",
    body: new URLSearchParams({ password }),
    headers: { "content-type": "application/x-www-form-urlencoded", origin: "http://localhost", ...headers },
  };
}

async function sessionCookie(instance: Awaited<ReturnType<typeof app>>, password: string): Promise<string> {
  const response = await instance.request("/login", login(password));
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

describe("addresses the app answers to without a password", () => {
  it("refuses a public name it was not told about, so another site cannot pose as the app", async () => {
    const instance = await app();

    const response = await instance.request("http://evil.example/settings/export?token=1");

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("hunts");
  });

  it("answers on an IP, on localhost, on a local network name and on the public address from the settings", async () => {
    const instance = await app({
      mutate: (config) => {
        config.settings.publicUrl = "https://cinema.example.com";
      },
    });

    const statuses = await Promise.all(
      ["http://192.168.1.20:8790/", "http://localhost:8790/", "http://tower/", "http://tower.local:8790/", "https://cinema.example.com/", "http://[fd00::1]:8790/"].map(
        async (url) => (await instance.request(url)).status,
      ),
    );

    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("keeps the health check open on any name", async () => {
    const instance = await app();

    expect((await instance.request("http://evil.example/health")).status).toBe(200);
  });

  it("leaves the name alone when a password protects the app", async () => {
    const instance = await app({ env: { UI_PASSWORD: "segreta" } });

    const response = await instance.request("http://cinema.example.org/");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });
});

describe("session", () => {
  it("ends after 30 days even if the browser still sends the cookie", async () => {
    const instance = await app({ env: { UI_PASSWORD: "segreta" } });
    const cookie = await sessionCookie(instance, "segreta");

    const before = await instance.request("/", { headers: { cookie } });
    harness.advance(31 * DAY);
    const after = await instance.request("/", { headers: { cookie } });

    expect(before.status).toBe(200);
    expect(after.status).toBe(303);
  });

  it("ends when the password changes", async () => {
    const first = await app({ env: { UI_PASSWORD: "segreta" } });
    const cookie = await sessionCookie(first, "segreta");
    const second = await appOnSameData({ env: { UI_PASSWORD: "nuova" } });

    expect((await second.request("/", { headers: { cookie } })).status).toBe(303);
  });

  it("offers a way out only when there is a password", async () => {
    const guarded = await app({ env: { UI_PASSWORD: "segreta" } });
    const cookie = await sessionCookie(guarded, "segreta");
    const open = await appOnSameData();

    expect(await (await guarded.request("/", { headers: { cookie } })).text()).toContain('action="/logout"');
    expect(await (await open.request("/")).text()).not.toContain('action="/logout"');
  });
});

describe("failed logins behind a trusted proxy", () => {
  it("counts them on the address the proxy added, not on the one the client wrote", async () => {
    const instance = await app({ env: { UI_PASSWORD: "segreta", TRUST_PROXY: "1" } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await instance.request("/login", login("no", { "x-forwarded-for": `10.0.0.${attempt}, 203.0.113.7` }));
    }
    const locked = await instance.request("/login", login("segreta", { "x-forwarded-for": "10.0.0.99, 203.0.113.7" }));
    const other = await instance.request("/login", login("segreta", { "x-forwarded-for": "10.0.0.99, 203.0.113.8" }));

    expect(await locked.text()).toContain("Troppi tentativi");
    expect(other.status).toBe(303);
  });
});

describe("failed login memory", () => {
  it("forgets an address 15 minutes after its last failure and never tracks more than 1000", () => {
    let clock = 0;
    const lockout = createLockout(() => clock);

    for (let index = 0; index < 1500; index += 1) lockout.fail(`198.51.100.${index}`);
    const whileFlooded = lockout.tracked();
    clock += 16 * 60_000;
    lockout.fail("203.0.113.1");

    expect(whileFlooded).toBe(1000);
    expect(lockout.tracked()).toBe(1);
  });
});

describe("status for Homepage", () => {
  it("gives the totals but not the names of the hunts to who has not logged in", async () => {
    const instance = await app({ env: { UI_PASSWORD: "segreta" } });
    const cookie = await sessionCookie(instance, "segreta");

    const anonymous = (await (await instance.request("/api/status")).json()) as { activeHunts: number; hunts: unknown[] };
    const loggedIn = (await (await instance.request("/api/status", { headers: { cookie } })).json()) as { hunts: Array<{ name: string }> };

    expect(anonymous.activeHunts).toBe(1);
    expect(anonymous.hunts).toEqual([]);
    expect(loggedIn.hunts.map((hunt) => hunt.name)).toEqual(["Dune IMAX Verona"]);
  });
});
