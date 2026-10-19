import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../src/store.js";
import { createApp } from "../src/web/app.js";
import { createHarness, type Harness } from "./support/harness.js";
import { scriptTags } from "./support/web.js";

const publicDir = fileURLToPath(new URL("../src/web/public/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function app(options: { tick?: boolean } = {}) {
  const config = await harness.seed();
  const watcher = await harness.watcher();
  if (options.tick !== false) await watcher.tick();
  const instance = await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: {}, now: () => harness.now(), publicDir, assetsDir });
  return { instance, watcher, huntId: config.hunts[0]?.id ?? "" };
}

describe("log page", () => {
  it("lists the events with Italian labels and a link to the showing", async () => {
    const { instance, huntId } = await app();

    const response = await instance.request("/log");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("Nuovo spettacolo");
    expect(html).toContain("Giro");
    expect(html).toContain("Dune IMAX Verona");
    expect(html).toContain(`/showings/5116-575978?hunt=${huntId}`);
    expect(html).not.toContain("Nessun evento.");
  });

  it("filters by kind and by hunt", async () => {
    const { instance, huntId } = await app();

    const byKind = await (await instance.request("/log?kind=newShowing")).text();
    const byHunt = await (await instance.request(`/log?hunt=${huntId}`)).text();
    const otherHunt = await (await instance.request("/log?hunt=zzzzzzzz")).text();
    const rows = (html: string) => [...html.matchAll(/<li class="grid/g)].length;

    expect(byKind).toContain("Nuovo spettacolo");
    expect(byKind).not.toMatch(/<span class="[^"]*">Giro<\/span>/);
    expect(rows(byKind)).toBeGreaterThan(0);
    expect(rows(byKind)).toBeLessThan(rows(byHunt));
    expect(otherHunt).toContain("Nessun evento.");
  });

  it("shows the empty state before any round", async () => {
    const { instance } = await app({ tick: false });

    const html = await (await instance.request("/log")).text();

    expect(html).toContain("Nessun evento.");
  });

  it("keeps the raw kind when it has no label, and escapes the detail", async () => {
    const { instance } = await app({ tick: false });
    const store = createStore(harness.dataDir);
    await store.appendLine("events.jsonl", JSON.stringify({ t: harness.now(), huntId: null, kind: "strange", key: null, detail: "<b>x</b>" }));

    const html = await (await instance.request("/log")).text();

    expect(html).toContain("strange");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("has a nonce on each script and no inline style", async () => {
    const { instance } = await app();

    const response = await instance.request("/log");
    const html = await response.text();
    const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1] ?? "";

    expect(html).not.toContain("style=");
    expect(scriptTags(html).every((tag) => tag.includes(`nonce="${nonce}"`))).toBe(true);
  });
});
