import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatKm } from "../src/distance.js";
import { formatters } from "../src/format.js";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp, huntForm, ORIGIN, post } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

const plain = (text: string): string => text.replaceAll(" ", " ").replaceAll("&nbsp;", " ");

async function pageIn(headers: Record<string, string>, path = "/"): Promise<string> {
  const { instance } = await createWebApp(harness, { language: null });
  return (await instance.request(path, { headers })).text();
}

describe("language of the page", () => {
  it("follows the browser: Italian when it asks for it, English otherwise", async () => {
    const italian = await pageIn({ "accept-language": "it-IT,it;q=0.9,en;q=0.8" });
    const german = await pageIn({ "accept-language": "de-DE,de;q=0.9" });
    const silent = await pageIn({});

    expect(italian).toContain('<html lang="it">');
    expect(italian).toContain("Cacce");
    expect(german).toContain('<html lang="en">');
    expect(german).toContain("Hunts");
    expect(german).not.toContain("Cacce");
    expect(silent).toContain('<html lang="en">');
  });

  it("prefers the chosen language to the one of the browser", async () => {
    const html = await pageIn({ "accept-language": "it", cookie: "language=en" });

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<option value="en" selected="">English</option>');
  });

  it("ignores a language it does not have, in the cookie or in the address", async () => {
    const cookie = await pageIn({ "accept-language": "it", cookie: "language=fr" });
    const query = await pageIn({ "accept-language": "it" }, "/?lng=en");

    expect(cookie).toContain('<html lang="it">');
    expect(cookie).toContain('<option value="auto" selected="">Automatica</option>');
    expect(query).toContain('<html lang="it">');
  });

  it("writes dates, prices and distances the English way in English", () => {
    const english = formatters("en");
    const moment = Date.parse("2026-12-15T19:30:00Z");

    expect(english.day("2026-12-15")).toBe("Tue 15/12");
    expect(english.dayTime(moment)).toBe("Tue 15/12 20:30");
    expect(english.eur(12.9)).toBe("€12.90");
    expect(english.tier({ sector: "HA", name: "Vip", price: 13.9 })).toBe("Vip €13.90");
    expect(plain(formatters("it").eur(12.9))).toBe("12,90 €");
    expect(formatKm(0.34, "en")).toBe("0.3 km");
  });

  it("shows a showing in English from end to end: seat map, legend, prices and day", async () => {
    const html = plain(await pageIn({ "accept-language": "en" }, "/showings/5116-576749?theatre=uci-cinemas-verona"));

    expect(html).toContain(">SCREEN</text>");
    expect(html).toContain("Normale €12.90");
    expect(html).toContain("Best seats");
    expect(html).toContain("Wed 16/12");
    expect(html).not.toContain("Pianta");
    expect(html).not.toContain("Liberi");
  });

  it("explains a refused form in the language of the page", async () => {
    const { instance } = await createWebApp(harness, { language: null });
    const send = (language: string) => instance.request("/hunts", post(huntForm({ name: "" }), { origin: ORIGIN, "accept-language": language }));

    expect(await (await send("en")).text()).toContain("from 1 to 80 characters");
    expect(await (await send("it")).text()).toContain("da 1 a 80 caratteri");
  });
});

describe("choice of the language", () => {
  it("remembers the chosen language in a cookie that plain http keeps, and goes back to the page", async () => {
    const { instance } = await createWebApp(harness, { language: null });

    const response = await instance.request("/language", post({ language: "it" }, { origin: ORIGIN, referer: `${ORIGIN}/theatres?q=verona` }));
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/theatres?q=verona");
    expect(cookie).toMatch(/^language=it; Max-Age=31536000; Path=\/; HttpOnly; SameSite=Strict$/);
  });

  it("marks the cookie as secure when the page arrived over https", async () => {
    const { instance } = await createWebApp(harness, { language: null });

    const response = await instance.request("/language", post({ language: "en" }, { origin: ORIGIN, "x-forwarded-proto": "https" }));

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("forgets the choice with Automatic, and with a language it does not have", async () => {
    const { instance } = await createWebApp(harness, { language: null });

    for (const language of ["auto", "fr"]) {
      const cookie = (await instance.request("/language", post({ language }))).headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/^language=; Max-Age=0; Path=\//);
    }
  });

  it("offers Automatic, English and Italiano on every page, also before signing in", async () => {
    const { instance } = await createWebApp(harness, { language: null, env: { UI_PASSWORD: "segreta-lunga" } });

    const login = await (await instance.request("/login", { headers: { "accept-language": "en" } })).text();
    const changed = await instance.request("/language", post({ language: "it" }));

    expect(login).toContain('<form method="post" action="/language"');
    expect([...login.matchAll(/<option value="(auto|en|it)"/g)].map((match) => match[1])).toEqual(["auto", "en", "it"]);
    expect(login).toContain('<option value="auto" selected="">Automatic</option>');
    expect(changed.headers.get("set-cookie")).toContain("language=it");
  });

  it("refuses a change of language asked by another site", async () => {
    const { instance } = await createWebApp(harness, { language: null });

    const response = await instance.request("/language", post({ language: "it" }, { origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("language of the messages", () => {
  const settingsForm = (overrides: Record<string, string> = {}): Record<string, string> => ({
    token: "",
    chatId: "4242",
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
  });

  it("is the one of the settings, whatever the browser asks", async () => {
    const { instance } = await createWebApp(harness, { language: "en" });

    const page = await (await instance.request("/settings")).text();
    await instance.request("/settings/test", post());

    expect(page).toContain("Language of the messages");
    expect(page).toContain('<option value="it" selected="">Italiano</option>');
    expect(harness.world.telegram[0]?.text).toContain("Prova di cinema-watch");
  });

  it("changes as soon as the setting is saved, without touching the language of the page", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const saved = await instance.request("/settings", post(settingsForm({ messageLanguage: "en" })));
    await instance.request("/settings/test", post());
    const page = await (await instance.request("/settings")).text();

    expect(saved.status).toBe(303);
    expect(watcher.config().settings.language).toBe("en");
    expect(harness.world.telegram[0]?.text).toContain("cinema-watch test");
    expect(harness.world.telegram[0]?.text).toContain("The alerts of the hunts will arrive in this chat.");
    expect(page).toContain('<html lang="it">');
  });

  it("stays as it was when the form does not carry it or carries one it does not have", async () => {
    const { instance, watcher } = await createWebApp(harness);

    await instance.request("/settings", post(settingsForm()));
    await instance.request("/settings", post(settingsForm({ messageLanguage: "fr" })));

    expect(watcher.config().settings.language).toBe("it");
  });

  it("writes the alerts of a round in English when the setting says so", async () => {
    await harness.seed((config) => {
      config.settings.language = "en";
    });
    const watcher = await harness.watcher();

    await watcher.tick();
    const texts = harness.world.telegram.map((call) => call.text ?? call.caption ?? "").join(" | ");

    expect(texts).toContain("New showings");
    expect(texts).not.toContain("Nuovi spettacoli");
  });
});

describe("texts of the pages", () => {
  const webDir = fileURLToPath(new URL("../src/web/", import.meta.url));
  const sources = ["", "parts", "routes"].flatMap((folder) =>
    readdirSync(join(webDir, folder))
      .filter((name) => /\.tsx?$/.test(name) && name !== "i18n.ts")
      .map((name) => ({ name: join(folder, name), text: readFileSync(join(webDir, folder, name), "utf8") })),
  );

  it("come from the language of the request: no page imports the texts or the formats of one language", () => {
    const fixed = sources.filter(({ text }) => /from "(\.\.\/)+copy\.js"/.test(text) || /import \{[^}]*\bformat(Eur|Day|DayOf|DayTime|DayLong|Time|Tier)\b[^}]*\} from "(\.\.\/)+format\.js"/.test(text) || /\bformatKm\b[^}]*\} from "(\.\.\/)+distance\.js"/.test(text));

    expect(sources.length).toBeGreaterThan(15);
    expect(fixed.map(({ name }) => name)).toEqual([]);
  });

  it("are not read once at startup: outside a function a page only prepares them", () => {
    const eager = sources.flatMap(({ name, text }) =>
      text
        .split("\n")
        .filter((line) => /^(export )?const \w+ = (copy|ui|common)\./.test(line))
        .map((line) => `${name}: ${line}`),
    );

    expect(eager).toEqual([]);
  });
});
