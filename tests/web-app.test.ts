import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/model.js";
import { createApp } from "../src/web/app.js";
import { createHarness, type Harness } from "./support/harness.js";
import { scriptTags } from "./support/web.js";

const publicDir = fileURLToPath(new URL("../src/web/public/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));
const ORIGIN = "http://localhost";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function app(options: { env?: NodeJS.ProcessEnv; mutate?: (config: Config) => void } = {}) {
  const config = await harness.seed(options.mutate);
  const watcher = await harness.watcher();
  const instance = await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: options.env ?? {}, now: () => harness.now(), publicDir, assetsDir });
  return { instance, watcher, config };
}

function post(path: string, body: Record<string, string> = {}, headers: Record<string, string> = { origin: ORIGIN }) {
  return { method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } };
}

describe("web app", () => {
  it("renders the hunts with a strict content security policy and a nonce on every script", async () => {
    const { instance } = await app();

    const response = await instance.request("/");
    const html = await response.text();
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];

    expect(response.status).toBe(200);
    expect(html).toContain("Dune IMAX Verona");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
    expect(nonce).toBeTruthy();
    expect(scriptTags(html).every((tag) => tag.includes(`nonce="${nonce ?? ""}"`))).toBe(true);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("answers health and status for Docker and Homepage", async () => {
    const { instance } = await app();

    const health = await instance.request("/health");
    const status = (await (await instance.request("/api/status")).json()) as { status: string; activeHunts: number; telegramConfigured: boolean; hunts: Array<{ name: string }> };

    expect(await health.json()).toEqual({ status: "ok" });
    expect(status.status).toBe("ok");
    expect(status.activeHunts).toBe(1);
    expect(status.telegramConfigured).toBe(true);
    expect(status.hunts.map((hunt) => hunt.name)).toEqual(["Dune IMAX Verona"]);
  });

  it("mutes and resumes a hunt from its buttons and refuses posts from other origins", async () => {
    const { instance, watcher, config } = await app();
    const id = config.hunts[0]?.id ?? "";

    const muted = await instance.request(`/hunts/${id}/mute`, post(`/hunts/${id}/mute`));
    const mutedUntil = watcher.state().hunts[id]?.mutedUntil;
    const foreign = await instance.request(`/hunts/${id}/resume`, post(`/hunts/${id}/resume`, {}, { origin: "https://evil.example" }));
    const resumed = await instance.request(`/hunts/${id}/resume`, post(`/hunts/${id}/resume`));

    expect(muted.status).toBe(303);
    expect(mutedUntil).toBe(harness.now() + 24 * 60 * 60_000);
    expect(foreign.status).toBe(403);
    expect(resumed.status).toBe(303);
    expect(watcher.state().hunts[id]?.mutedUntil).toBeNull();
  });

  it("returns 404 for unknown or malformed hunt ids", async () => {
    const { instance } = await app();

    expect((await instance.request("/hunts/zzzzzzzz/mute", post("/"))).status).toBe(404);
    expect((await instance.request("/hunts/..%2Fsecret/mute", post("/"))).status).toBe(404);
  });

  it("serves only known assets", async () => {
    const { instance } = await app();

    const logo = await instance.request("/assets/logo.svg");
    const font = await instance.request("/assets/fonts/BebasNeue-Regular.ttf");
    const script = await instance.request("/assets/app.js");

    expect(logo.headers.get("content-type")).toBe("image/svg+xml");
    expect(font.status).toBe(200);
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect((await instance.request("/assets/..%2Fpackage.json")).status).toBe(404);
    expect((await instance.request("/assets/fonts/OFL-Barlow.txt")).status).toBe(404);
  });

  it("describes the app for installation on a phone", async () => {
    const { instance } = await app();

    const manifest = (await (await instance.request("/manifest.webmanifest")).json()) as { name: string; icons: Array<{ purpose?: string }> };

    expect(manifest.name).toBe("cinema-watch");
    expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
  });

  it("asks for the password when one is set, and locks out after five wrong attempts", async () => {
    const { instance } = await app({ env: { UI_PASSWORD: "segreta" } });

    const guarded = await instance.request("/");
    const health = await instance.request("/health");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await instance.request("/login", post("/login", { password: "no" }))).status);
    const locked = await (await instance.request("/login", post("/login", { password: "segreta" }))).text();

    expect(guarded.status).toBe(303);
    expect(guarded.headers.get("location")).toBe("/login");
    expect(health.status).toBe(200);
    expect(statuses).toEqual([400, 400, 400, 400, 400]);
    expect(locked).toContain("Troppi tentativi");
  });

  it("lets in with the right password through a signed, http-only cookie", async () => {
    const { instance } = await app({ env: { UI_PASSWORD: "segreta" } });

    const login = await instance.request("/login", post("/login", { password: "segreta" }));
    const cookie = login.headers.get("set-cookie") ?? "";
    const home = await instance.request("/", { headers: { cookie: cookie.split(";")[0] ?? "" } });

    expect(login.status).toBe(303);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(home.status).toBe(200);
  });

  it("warns on the home page when Telegram is not configured", async () => {
    const { instance } = await app({
      mutate: (config) => {
        config.settings.telegram = { token: null, chatId: null };
      },
    });

    expect(await (await instance.request("/")).text()).toContain("Telegram non configurato");
  });

  it("shows a 404 page for unknown addresses", async () => {
    const { instance } = await app();

    const response = await instance.request("/nowhere");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Pagina non trovata");
  });
});
