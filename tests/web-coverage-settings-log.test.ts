import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../src/store.js";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp, ORIGIN, post } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function settingsForm(overrides: Record<string, string> = {}): Array<[string, string]> {
  return Object.entries({ chatId: "4242", interval: "5", albumSize: "3", threshold: "10", sellableTypes: "Standard", digestTime: "09:00", ...overrides });
}

describe("settings page", () => {
  it("shows the fixed default zone as a sentence and not the percentages", async () => {
    const { instance } = await createWebApp(harness, {
      mutate: (config) => {
        config.settings.defaultZone = { kind: "absolute", rows: ["F", "G"], seatFrom: 5, seatTo: null };
      },
    });

    const html = await (await instance.request("/settings")).text();

    expect(html).toContain("Zona fissa: file F, G, posti 5-…");
  });

  it("shows no fixed zone sentence when the default zone is relative", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/settings")).text();

    expect(html).not.toContain("Zona fissa");
    expect(html).toMatch(/name="zoneFrom"[^>]*value="40"/);
  });

  it("shows the zone error next to the zone fields", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request("/settings", post(settingsForm({ zoneFrom: "80", zoneTo: "20", zoneCenter: "50" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("le file iniziano dopo che finiscono");
    expect(html.indexOf("le file iniziano")).toBeGreaterThan(html.indexOf('name="zoneCenter"'));
    expect(watcher.config().settings.defaultZone).toEqual({ kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 });
  });

  it("shows quiet hours with only one end as an error on the quiet fields", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/settings", post(settingsForm({ quietFrom: "22:00", quietTo: "" })))).text();

    expect(html).toContain("formato HH:MM");
    expect(html.indexOf("formato HH:MM")).toBeGreaterThan(html.indexOf('name="quietTo"'));
  });

  it("shows an error that belongs to no settings field above the form", async () => {
    const { instance, watcher } = await createWebApp(harness);
    watcher.saveConfig = () => Promise.resolve({ ok: false, errors: ["hunts[0].name: da 1 a 80 caratteri", "settings.schema: valore non ammesso"] });

    const response = await instance.request("/settings", post(settingsForm()));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("hunts[0].name: da 1 a 80 caratteri");
    expect(html).toContain("settings.schema: valore non ammesso");
    expect(html.indexOf("hunts[0].name")).toBeLessThan(html.indexOf('name="token"'));
  });

  it("saves quiet hours and clears them when both ends are empty", async () => {
    const { instance, watcher } = await createWebApp(harness);

    await instance.request("/settings", post(settingsForm({ quietFrom: "23:00", quietTo: "07:00" })));
    const set = watcher.config().settings.quietHours;
    await instance.request("/settings", post(settingsForm()));

    expect(set).toEqual({ from: "23:00", to: "07:00" });
    expect(watcher.config().settings.quietHours).toBeNull();
  });
});

describe("settings import with several files", () => {
  it("reads the first real file when the field is sent twice", async () => {
    const { instance, watcher, config } = await createWebApp(harness);
    const next = structuredClone(config);
    next.hunts = [];
    const body = new FormData();
    body.append("config", "");
    body.append("file", "not a file");
    body.append("file", new File([JSON.stringify(next)], "config.json", { type: "application/json" }));

    const response = await instance.request("/settings/import", { method: "POST", body, headers: { origin: ORIGIN } });

    expect(response.status).toBe(200);
    expect(watcher.config().hunts).toEqual([]);
  });

  it("falls back to the text area when the uploaded file is empty", async () => {
    const { instance, watcher, config } = await createWebApp(harness);
    const next = structuredClone(config);
    next.hunts = [];
    const body = new FormData();
    body.append("config", JSON.stringify(next));
    body.append("file", new File([""], "empty.json", { type: "application/json" }));

    const response = await instance.request("/settings/import", { method: "POST", body, headers: { origin: ORIGIN } });

    expect(response.status).toBe(200);
    expect(watcher.config().hunts).toEqual([]);
  });
});

describe("log page edge cases", () => {
  async function addEvents(entries: Array<Record<string, unknown>>) {
    const store = createStore(harness.dataDir);
    for (const entry of entries) await store.appendLine("events.jsonl", JSON.stringify(entry));
  }

  it("names a hunt that no longer exists, and shows a link without a hunt filter for an event without hunt", async () => {
    const { instance } = await createWebApp(harness);
    await addEvents([
      { t: harness.now(), huntId: "gonegone", kind: "newShowing", key: null, detail: "vecchio" },
      { t: harness.now() - 1000, huntId: null, kind: "hallChanged", key: "5116-575978", detail: null },
    ]);

    const html = await (await instance.request("/log")).text();

    expect(html).toContain("Caccia eliminata");
    expect(html).toContain("vecchio");
    expect(html).toContain('href="/performances/5116/575978"');
    expect(html).toContain("Pianta cambiata");
  });

  it("does not link an event whose key is not a performance", async () => {
    const { instance } = await createWebApp(harness);
    await addEvents([{ t: harness.now(), huntId: null, kind: "error", key: "not-a-key", detail: "x" }]);

    const html = await (await instance.request("/log")).text();

    expect(html).not.toContain("Apri spettacolo");
  });

  it("ignores lines of the event file that are not events", async () => {
    const { instance } = await createWebApp(harness);
    const store = createStore(harness.dataDir);
    await store.appendLine("events.jsonl", "not json");
    await store.appendLine("events.jsonl", JSON.stringify({ t: "yesterday", kind: "error" }));
    await addEvents([{ t: harness.now(), huntId: null, kind: "round", key: null, detail: "ok" }]);

    const html = await (await instance.request("/log")).text();

    expect([...html.matchAll(/<li class="grid/g)]).toHaveLength(1);
  });
});
