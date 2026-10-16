import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";
import { fixture } from "./support/fake-world.js";
import { createWebApp, occupancyWithout, post } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

describe("login without a password", () => {
  it("sends the login page and the login post back to the hunts", async () => {
    const { instance } = await createWebApp(harness);

    const page = await instance.request("/login");
    const submitted = await instance.request("/login", post({ password: "qualsiasi" }));

    expect(page.status).toBe(303);
    expect(page.headers.get("location")).toBe("/");
    expect(submitted.status).toBe(303);
    expect(submitted.headers.get("location")).toBe("/");
    expect(submitted.headers.get("set-cookie")).toBeNull();
  });
});

describe("login with a password", () => {
  const env = { UI_PASSWORD: "segreta" };

  it("shows the login form and keeps it open without a cookie", async () => {
    const { instance } = await createWebApp(harness, { env });

    const page = await instance.request("/login");
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain('name="password"');
    expect(html).not.toContain("Password errata");
  });

  it("says the password is wrong and sets no cookie", async () => {
    const { instance } = await createWebApp(harness, { env });

    const response = await instance.request("/login", post({ password: "sbagliata" }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Password errata");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("treats a post without a password field as a wrong password", async () => {
    const { instance } = await createWebApp(harness, { env });

    const response = await instance.request("/login", post({}));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Password errata");
  });

  it("marks the cookie secure only over https", async () => {
    const { instance } = await createWebApp(harness, { env });

    const plain = await instance.request("http://localhost/login", post({ password: "segreta" }));
    const secure = await instance.request("https://localhost/login", post({ password: "segreta" }, { origin: "https://localhost" }));

    expect(plain.headers.get("set-cookie")).not.toContain("Secure");
    expect(secure.headers.get("set-cookie")).toContain("Secure");
  });

  it("refuses a forged session cookie", async () => {
    const { instance } = await createWebApp(harness, { env });

    const response = await instance.request("/", { headers: { cookie: "cw_session=ok.forgedsignature" } });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("logs out by clearing the cookie and going to the login page", async () => {
    const { instance } = await createWebApp(harness, { env });
    const login = await instance.request("/login", post({ password: "segreta" }));
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const logout = await instance.request("/logout", { ...post(), headers: { origin: "http://localhost", cookie } });

    expect(logout.status).toBe(303);
    expect(logout.headers.get("location")).toBe("/login");
    expect(logout.headers.get("set-cookie")).toMatch(/cw_session=;|cw_session=; /);
  });

  it("keeps a session valid across restarts by storing the signing secret", async () => {
    const first = await createWebApp(harness, { env });
    const login = await first.instance.request("/login", post({ password: "segreta" }));
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const secret = await readFile(join(harness.dataDir, "secret"), "utf8");

    const second = await createWebApp(harness, { env });
    const home = await second.instance.request("/", { headers: { cookie } });

    expect(secret).toHaveLength(64);
    expect(await readFile(join(harness.dataDir, "secret"), "utf8")).toBe(secret);
    expect(home.status).toBe(200);
  });

  it("replaces a secret that is too short", async () => {
    await writeFile(join(harness.dataDir, "secret"), "corto");

    await createWebApp(harness, { env });

    expect(await readFile(join(harness.dataDir, "secret"), "utf8")).toHaveLength(64);
  });
});

describe("lockout by address", () => {
  async function fail(instance: Awaited<ReturnType<typeof createWebApp>>["instance"], address: string | null) {
    const headers: Record<string, string> = { origin: "http://localhost" };
    if (address) headers["x-forwarded-for"] = address;
    return instance.request("/login", post({ password: "no" }, headers));
  }

  it("blocks one forwarded address and leaves another one free when the proxy is trusted", async () => {
    const { instance } = await createWebApp(harness, { env: { UI_PASSWORD: "segreta", TRUST_PROXY: "1" } });

    for (let attempt = 0; attempt < 5; attempt += 1) await fail(instance, "10.0.0.1, 172.16.0.1");
    const blocked = await (await fail(instance, "10.0.0.1")).text();
    const other = await (await fail(instance, "10.0.0.2")).text();

    expect(blocked).toContain("Troppi tentativi");
    expect(other).toContain("Password errata");
  });

  it("ignores the forwarded header when the proxy is not trusted", async () => {
    const { instance } = await createWebApp(harness, { env: { UI_PASSWORD: "segreta" } });

    for (let attempt = 0; attempt < 5; attempt += 1) await fail(instance, `10.0.0.${attempt}`);
    const next = await (await fail(instance, "10.0.0.99")).text();

    expect(next).toContain("Troppi tentativi");
  });

  it("falls back to the socket address when the trusted proxy sends no header", async () => {
    const { instance } = await createWebApp(harness, { env: { UI_PASSWORD: "segreta", TRUST_PROXY: "1" } });

    for (let attempt = 0; attempt < 5; attempt += 1) await fail(instance, null);
    const next = await (await fail(instance, null)).text();

    expect(next).toContain("Troppi tentativi");
  });

  it("lets the lockout expire after fifteen minutes", async () => {
    const { instance } = await createWebApp(harness, { env: { UI_PASSWORD: "segreta" } });
    for (let attempt = 0; attempt < 5; attempt += 1) await fail(instance, null);

    harness.advance(15 * 60_000 + 1);
    const after = await instance.request("/login", post({ password: "segreta" }));

    expect(after.status).toBe(303);
  });
});

describe("errors and static files", () => {
  it("answers 404 for a well-named asset that does not exist", async () => {
    const empty = await mkdtemp(join(tmpdir(), "cinema-watch-public-"));
    const { instance } = await createWebApp(harness, { publicDir: empty });

    const missing = await instance.request("/assets/app.js");
    const missingIcon = await instance.request("/assets/icons/none.png");

    expect(missing.status).toBe(404);
    expect(missingIcon.status).toBe(404);
  });

  it("answers 413 to a body over one megabyte", async () => {
    const { instance, huntId } = await createWebApp(harness);

    const response = await instance.request(`/hunts/${huntId}/confirm`, post({ slug: "a".repeat(1024 * 1024 + 10) }));

    expect(response.status).toBe(413);
  });

  it("shows the failure page and logs the error when a route throws", async () => {
    const { instance, watcher } = await createWebApp(harness);
    watcher.runNow = () => Promise.reject(new Error("boom"));

    const response = await instance.request("/hunts/refresh", post());
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(html).toContain("Qualcosa non ha funzionato");
    expect(html).toContain("L&#39;errore è nel registro del container.");
  });

  it("announces a newer release in the footer", async () => {
    const { instance, watcher } = await createWebApp(harness);
    harness.world.latestRelease = "v2026.11.0";
    await watcher.tick();

    const html = await (await instance.request("/")).text();

    expect(html).toContain("Disponibile la v2026.11.0");
  });

  it("stays silent when the latest release is the running one", async () => {
    const { instance, watcher } = await createWebApp(harness);
    await watcher.tick();

    expect(await (await instance.request("/")).text()).not.toContain("Disponibile la");
  });

  it("reports hunts as muted in the status endpoint only while the mute lasts", async () => {
    const { instance, huntId } = await createWebApp(harness);
    await instance.request(`/hunts/${huntId}/mute`, post());

    const during = (await (await instance.request("/api/status")).json()) as { hunts: Array<{ muted: boolean }> };
    harness.advance(25 * 60 * 60_000);
    const after = (await (await instance.request("/api/status")).json()) as { hunts: Array<{ muted: boolean }> };

    expect(during.hunts[0]?.muted).toBe(true);
    expect(after.hunts[0]?.muted).toBe(false);
  });

  it("counts free seats and archived hunts in the status endpoint", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);
    await watcher.tick();
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture("webtic/occupancy-5116-575978.json"), ["H/9", "H/10", "H/11"]));
    harness.advance(6 * 60_000);
    await watcher.tick();
    const active = (await (await instance.request("/api/status")).json()) as { activeHunts: number; withSeats: number; hunts: Array<{ freeInZone: number; showings: number }> };
    await instance.request(`/hunts/${huntId}/bought`, post());
    const archived = (await (await instance.request("/api/status")).json()) as { activeHunts: number; showings: number; hunts: Array<{ active: boolean; lastRunOk: boolean | null }> };

    expect(active.activeHunts).toBe(1);
    expect(active.hunts[0]?.showings).toBeGreaterThan(0);
    expect(active.hunts[0]?.freeInZone).toBe(3);
    expect(active.withSeats).toBe(1);
    expect(archived.activeHunts).toBe(0);
    expect(archived.showings).toBe(0);
    expect(archived.hunts[0]?.active).toBe(false);
  });

  it("gives an empty status to a hunt that never ran", async () => {
    const { instance } = await createWebApp(harness);

    const status = (await (await instance.request("/api/status")).json()) as { hunts: Array<{ showings: number; freeInZone: number; lastRunAt: number | null; lastRunOk: boolean | null; nextRunAt: number | null }> };

    expect(status.hunts[0]).toMatchObject({ showings: 0, freeInZone: 0, lastRunAt: null, lastRunOk: null, nextRunAt: null });
  });
});
