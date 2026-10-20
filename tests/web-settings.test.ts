import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/model.js";
import { createApp } from "../src/web/app.js";
import { FAKE_TOKEN } from "./support/fake-world.js";
import { createHarness, PRIMARY_CHAT, type Harness } from "./support/harness.js";
import { fakeBotToken } from "./support/tokens.js";
import { createWebApp, scriptTags } from "./support/web.js";

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

async function app() {
  const config = await harness.seed();
  const watcher = await harness.watcher();
  const instance = await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: {}, now: () => harness.now(), publicDir, assetsDir });
  return { instance, watcher, config };
}

function post(entries: Record<string, string> = {}, headers: Record<string, string> = { origin: ORIGIN }) {
  return { method: "POST", body: new URLSearchParams(entries), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } };
}

function settingsForm(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    token: "",
    chatId: PRIMARY_CHAT,
    publicUrl: "",
    interval: "5",
    quietFrom: "",
    quietTo: "",
    digestEnabled: "1",
    digestTime: "20:00",
    albumSize: "3",
    threshold: "10",
    sellableTypes: "STANDARD",
    zoneFrom: "",
    zoneTo: "",
    zoneCenter: "",
    ...overrides,
  };
}

function multipart(fields: Record<string, string | File>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return { method: "POST", body, headers: { origin: ORIGIN } };
}

describe("settings page", () => {
  it("never writes the token in the page, only its last digits in the placeholder", async () => {
    const { instance } = await app();

    const response = await instance.request("/settings");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain(FAKE_TOKEN);
    expect(html).toContain(`Impostato, termina con ${FAKE_TOKEN.slice(-4)}`);
    expect(html).toMatch(/name="token"[^>]*type="password"/);
    expect(html).toMatch(/name="chatId"[^>]*value="4242"/);
  });

  it("keeps the token when the field stays empty and saves the other values", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request(
      "/settings",
      post(settingsForm({ interval: "9", albumSize: "4", quietFrom: "23:00", quietTo: "07:00", sellableTypes: "STANDARD, COMFORT", publicUrl: "https://cw.example.org" })),
    );
    const settings = watcher.config().settings;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings?saved=1");
    expect(settings.telegram.token).toBe(FAKE_TOKEN);
    expect(settings.defaultIntervalMinutes).toBe(9);
    expect(settings.albumSize).toBe(4);
    expect(settings.quietHours).toEqual({ from: "23:00", to: "07:00" });
    expect(settings.sellableTypes).toEqual(["STANDARD", "COMFORT"]);
    expect(settings.publicUrl).toBe("https://cw.example.org");
    expect(await (await instance.request("/settings?saved=1")).text()).toContain("Impostazioni salvate.");
  });

  it("replaces the token with a new one and removes it on request", async () => {
    const { instance, watcher } = await app();
    const replacement = `987654321:${"a".repeat(35)}`;

    await instance.request("/settings", post(settingsForm({ token: replacement })));
    const replaced = watcher.config().settings.telegram.token;
    const page = await (await instance.request("/settings")).text();
    await instance.request("/settings", post(settingsForm({ clearToken: "1" })));

    expect(replaced).toBe(replacement);
    expect(page).not.toContain(replacement);
    expect(watcher.config().settings.telegram.token).toBeNull();
    expect(await (await instance.request("/settings")).text()).toContain("Nessun token");
  });

  it("shows each error next to its field and keeps the typed values", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/settings", post(settingsForm({ albumSize: "0", interval: "12", token: "non-un-token", quietFrom: "22:00" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("intero da 1 a 10");
    expect(html).toContain("formato del token non valido");
    expect(html).toContain("formato HH:MM");
    expect(html).toMatch(/name="albumSize"[^>]*value="0"/);
    expect(html).toMatch(/name="interval"[^>]*value="12"/);
    expect(html).not.toContain("non-un-token");
    expect(watcher.config().settings.albumSize).toBe(3);
    expect(watcher.config().settings.telegram.token).toBe(FAKE_TOKEN);
  });

  it("changes the default zone only when its numbers are filled", async () => {
    const { instance, watcher } = await app();
    const before = watcher.config().settings.defaultZone;

    await instance.request("/settings", post(settingsForm()));
    const kept = watcher.config().settings.defaultZone;
    await instance.request("/settings", post(settingsForm({ zoneFrom: "20", zoneTo: "90", zoneCenter: "70" })));

    expect(kept).toEqual(before);
    expect(watcher.config().settings.defaultZone).toEqual({ kind: "relative", rowsFromPercent: 20, rowsToPercent: 90, centerPercent: 70 });
  });
});

describe("telegram test", () => {
  it("sends the test message and shows the outcome", async () => {
    const { instance } = await app();

    const response = await instance.request("/settings/test", post());
    const page = await (await instance.request(response.headers.get("location") ?? "")).text();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/settings?test=ok");
    expect(harness.world.telegram.map((call) => `${call.method}:${call.chatId}`)).toEqual([`sendMessage:${PRIMARY_CHAT}`]);
    expect(harness.world.telegram[0]?.text).toContain("Prova di cinema-watch");
    expect(page).toContain("Messaggio di prova inviato.");
  });

  it("says under the public URL when Telegram refused it as a button", async () => {
    await harness.seed((config) => {
      config.settings.publicUrl = "https://cw.example";
    });
    const original = harness.world.fetch;
    harness.world.fetch = (input, init) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (body.includes("reply_markup")) return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request" }), { status: 400 }));
      return original(input, init);
    };
    const watcher = await harness.watcher();
    const instance = await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: {}, now: () => harness.now(), publicDir, assetsDir });

    await instance.request("/settings/test", post());
    const page = await (await instance.request("/settings")).text();

    expect(page).toContain("Telegram non lo accetta come pulsante: i link vanno nel testo");
  });

  it("reports a failure when Telegram is not configured", async () => {
    const { instance } = await app();
    await instance.request("/settings", post(settingsForm({ clearToken: "1", chatId: "" })));

    const response = await instance.request("/settings/test", post());
    const page = await (await instance.request(response.headers.get("location") ?? "")).text();

    expect(response.headers.get("location")).toBe("/settings?test=fail");
    expect(page).toContain("Invio della prova non riuscito.");
  });
});

describe("export and import", () => {
  it("exports without the token by default and with it on request", async () => {
    const { instance } = await app();

    const without = await instance.request("/settings/export?token=0");
    const withToken = await instance.request("/settings/export?token=1");
    const stripped = JSON.parse(await without.text()) as Config;
    const full = JSON.parse(await withToken.text()) as Config;

    expect(without.headers.get("content-disposition")).toBe('attachment; filename="cinema-watch-config.json"');
    expect(without.headers.get("content-type")).toContain("application/json");
    expect(stripped.settings.telegram.token).toBeNull();
    expect(full.settings.telegram.token).toBe(FAKE_TOKEN);
    expect(stripped.hunts).toHaveLength(1);
  });

  it("imports a valid configuration from the text area", async () => {
    const { instance, watcher, config } = await app();
    const next = structuredClone(config);
    next.settings.albumSize = 7;
    next.settings.telegram.token = null;

    const response = await instance.request("/settings/import", multipart({ config: JSON.stringify(next) }));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Configurazione importata.");
    expect(watcher.config().settings.albumSize).toBe(7);
    expect(watcher.config().settings.telegram.token).toBe(FAKE_TOKEN);
  });

  it("imports a valid configuration from a file", async () => {
    const { instance, watcher, config } = await app();
    const next = structuredClone(config);
    next.hunts = [];

    const response = await instance.request(
      "/settings/import",
      multipart({ config: "", file: new File([JSON.stringify(next)], "config.json", { type: "application/json" }) }),
    );

    expect(response.status).toBe(200);
    expect(watcher.config().hunts).toEqual([]);
  });

  it("explains why an invalid import is refused and changes nothing", async () => {
    const { instance, watcher, config } = await app();
    const broken = structuredClone(config);
    broken.settings.albumSize = 0;

    const invalid = await instance.request("/settings/import", multipart({ config: JSON.stringify(broken) }));
    const notJson = await instance.request("/settings/import", multipart({ config: "{" }));
    const empty = await instance.request("/settings/import", multipart({ config: "  " }));

    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain("settings.albumSize: intero da 1 a 10");
    expect(await notJson.text()).toContain("JSON non valido");
    expect(empty.status).toBe(400);
    expect(watcher.config().settings.albumSize).toBe(3);
  });
});

describe("settings page in general", () => {
  it("has a nonce on each script and no inline style", async () => {
    const { instance } = await app();

    const response = await instance.request("/settings");
    const html = await response.text();
    const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1] ?? "";

    expect(html).not.toContain("style=");
    expect(nonce).not.toBe("");
    expect(scriptTags(html).every((tag) => tag.includes(`nonce="${nonce}"`))).toBe(true);
  });

  it("refuses posts without the right origin", async () => {
    const { instance, watcher } = await app();

    const statuses = await Promise.all(["/settings", "/settings/test", "/settings/import"].map(async (path) => (await instance.request(path, post(settingsForm(), {}))).status));

    expect(statuses).toEqual([403, 403, 403]);
    expect(harness.world.telegram).toEqual([]);
    expect(watcher.config().settings.telegram.token).toBe(FAKE_TOKEN);
  });
});

describe("telegram values from the environment", () => {
  const ENV_TOKEN = fakeBotToken(987654321, "e");

  async function envApp(env: NodeJS.ProcessEnv) {
    return createWebApp(harness, {
      env,
      mutate: (config) => {
        config.settings.telegram = { token: null, chatId: null };
      },
    });
  }

  it("says the token and the chat come from the environment without writing the token", async () => {
    const { instance } = await envApp({ TELEGRAM_TOKEN: ENV_TOKEN, TELEGRAM_CHAT_ID: "-100777" });

    const html = await (await instance.request("/settings")).text();

    expect(html).not.toContain(ENV_TOKEN);
    expect(html).toMatch(new RegExp(`name="token"[^>]*placeholder="Dalle variabili d&#39;ambiente [(]…${ENV_TOKEN.slice(-4)}[)]"`));
    expect(html).toMatch(/name="chatId"[^>]*value=""[^>]*placeholder="Dalle variabili d&#39;ambiente \(-100777\)"/);
    expect(html.match(/Un valore qui lo sostituisce/g)).toHaveLength(2);
    expect(html).not.toContain("Nessun token");
  });

  it("keeps saying Nessun token when neither the UI nor the environment has one", async () => {
    const { instance } = await envApp({});

    const html = await (await instance.request("/settings")).text();

    expect(html).toContain("Nessun token");
    expect(html).not.toContain("Dalle variabili d&#39;ambiente");
  });

  it("prefers the value saved in the UI over the environment", async () => {
    const { instance } = await createWebApp(harness, { env: { TELEGRAM_TOKEN: ENV_TOKEN, TELEGRAM_CHAT_ID: "-100777" } });

    const html = await (await instance.request("/settings")).text();

    expect(html).toContain(`Impostato, termina con ${FAKE_TOKEN.slice(-4)}`);
    expect(html).toMatch(/name="chatId"[^>]*value="4242"/);
    expect(html).not.toContain("Dalle variabili d&#39;ambiente");
  });

  it("reports the source of each value from the watcher", async () => {
    await harness.seed((config) => {
      config.settings.telegram = { token: null, chatId: "4242" };
    });

    expect((await harness.watcher({ env: { TELEGRAM_TOKEN: ENV_TOKEN, TELEGRAM_CHAT_ID: "-100777" } })).telegramSource()).toEqual({ token: "env", chatId: "config" });
    expect((await harness.watcher({ env: {} })).telegramSource()).toEqual({ token: null, chatId: "config" });
  });
});

describe("home and radius", () => {
  it("saves home pasted as latitude, longitude and the radius, and shows them back", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/settings", post(settingsForm({ home: " 45.4384,10.9916 ", radiusKm: "60" })));
    const page = await (await instance.request("/settings")).text();

    expect(response.status).toBe(303);
    expect(watcher.config().settings.home).toEqual({ lat: 45.4384, lon: 10.9916 });
    expect(watcher.config().settings.radiusKm).toBe(60);
    expect(page).toMatch(/name="home"[^>]*value="45.4384, 10.9916"/);
    expect(page).toMatch(/name="radiusKm"[^>]*value="60"/);
  });

  it("clears home and radius when the fields are empty", async () => {
    const { instance, watcher } = await app();
    await instance.request("/settings", post(settingsForm({ home: "45.4384, 10.9916", radiusKm: "60" })));

    await instance.request("/settings", post(settingsForm({ home: "", radiusKm: "" })));

    expect(watcher.config().settings.home).toBeNull();
    expect(watcher.config().settings.radiusKm).toBeNull();
  });

  it("refuses a home that is not two coordinates and keeps the old one", async () => {
    const { instance, watcher } = await app();

    const notNumbers = await instance.request("/settings", post(settingsForm({ home: "via Roma 1, Verona" })));
    const outOfRange = await instance.request("/settings", post(settingsForm({ home: "95, 10" })));
    const html = await outOfRange.text();

    expect(notNumbers.status).toBe(400);
    expect(outOfRange.status).toBe(400);
    expect(html).toContain("latitudine da -90 a 90");
    expect(watcher.config().settings.home).toBeNull();
  });

  it("offers the browser position button only through a page script", async () => {
    const { instance } = await app();

    const html = await (await instance.request("/settings")).text();

    expect(html).toContain('data-home-picker');
    expect(html).toContain('src="/assets/home-picker.js"');
  });
});

describe("18Tickets cinemas", () => {
  it("saves the added cinemas from addresses or links, without repeats, and shows them back", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/settings", post(settingsForm({ t18Hosts: "Vittoria.18tickets.it, https://splendorbari.18tickets.it/, vittoria.18tickets.it" })));
    const page = await (await instance.request("/settings")).text();

    expect(response.status).toBe(303);
    expect(watcher.config().settings.t18Hosts).toEqual(["vittoria.18tickets.it", "splendorbari.18tickets.it"]);
    expect(page).toMatch(/name="t18Hosts"[^>]*value="vittoria.18tickets.it, splendorbari.18tickets.it"/);
    expect(page).toContain("Cinema 18Tickets");
  });

  it("refuses an address outside 18Tickets next to its field", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/settings", post(settingsForm({ t18Hosts: "cinema.example.com" })));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("indirizzi del tipo nomecinema.18tickets.it");
    expect(watcher.config().settings.t18Hosts).toEqual([]);
  });
});
