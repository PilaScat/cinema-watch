import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHunt } from "../src/config.js";
import { createHarness, PRIMARY_CHAT, type Harness } from "./support/harness.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function refuseUrlButtons(host: string) {
  const original = harness.world.fetch;
  harness.world.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as { reply_markup?: unknown }) : {};
    if (url.includes("api.telegram.org") && JSON.stringify(body.reply_markup ?? null).includes(host)) {
      return Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: wrong HTTP URL" }), { status: 400 }));
    }
    return original(input, init);
  };
}

describe("watcher services for the web UI", () => {
  it("saves a valid configuration and refuses an invalid one with the field errors", async () => {
    const config = await harness.seed();
    const watcher = await harness.watcher();
    const renamed = structuredClone(config);
    const hunt = renamed.hunts[0];
    if (hunt) hunt.name = "Dune a Verona";
    const broken = structuredClone(config);
    broken.settings.albumSize = 0;

    const saved = await watcher.saveConfig(renamed);
    const refused = await watcher.saveConfig(broken);

    expect(saved).toEqual({ ok: true, config: renamed });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? [] : refused.errors).toContain("settings.albumSize: intero da 1 a 10");
    expect(watcher.config().hunts[0]?.name).toBe("Dune a Verona");
  });

  it("exports without the token and imports keeping the current one", async () => {
    const config = await harness.seed();
    const watcher = await harness.watcher();
    const exported = watcher.exportConfig(false);
    const changed = JSON.parse(exported) as typeof config;
    changed.settings.albumSize = 5;

    const imported = await watcher.importConfig(JSON.stringify(changed));

    expect(JSON.parse(exported).settings.telegram.token).toBeNull();
    expect(imported.ok).toBe(true);
    expect(watcher.config().settings.albumSize).toBe(5);
    expect(watcher.config().settings.telegram.token).toBe(config.settings.telegram.token);
  });

  it("sends a test message to the configured chat", async () => {
    await harness.seed();
    const watcher = await harness.watcher();

    const result = await watcher.sendTest();

    expect(result.ok).toBe(true);
    expect(harness.world.telegram.map((call) => [call.method, call.chatId])).toEqual([["sendMessage", PRIMARY_CHAT]]);
    expect(harness.world.telegram[0]?.text).toContain("Prova di cinema-watch");
  });

  it("checks with the test message that Telegram accepts the public URL as a button", async () => {
    await harness.seed((config) => {
      config.settings.publicUrl = "https://cw.example";
    });
    const watcher = await harness.watcher();

    const result = await watcher.sendTest();

    expect(result.ok).toBe(true);
    expect(JSON.stringify(harness.world.telegram[0]?.replyMarkup)).toContain("https://cw.example");
    expect(watcher.state().publicUrlCheck).toEqual({ url: "https://cw.example", accepted: true });
  });

  it("puts the hall links in the text after Telegram refuses the public URL as a button", async () => {
    await harness.seed((config) => {
      config.settings.publicUrl = "https://cw.example";
    });
    refuseUrlButtons("cw.example");
    const watcher = await harness.watcher();

    const result = await watcher.sendTest();
    await watcher.tick();
    const summary = harness.world.telegram.find((call) => call.method === "sendMessage" && call.text?.includes("Dune IMAX Verona"));

    expect(result.ok).toBe(true);
    expect(harness.world.telegram[0]?.text).toContain("https://cw.example");
    expect(watcher.state().publicUrlCheck).toEqual({ url: "https://cw.example", accepted: false });
    expect(summary?.text).toContain("Apri sala: https://cw.example/performances/5116/575978");
    expect(JSON.stringify(summary?.replyMarkup)).not.toContain("cw.example");
  });

  it("lists the cinemas and reads the whole programming of one", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-15", { data: [] });

    const theatres = await watcher.services.theatres();
    const again = await watcher.services.theatres();

    expect(theatres.find((theatre) => theatre.slug === "uci-cinemas-verona")?.name).toBe("UCI Cinemas Verona");
    expect(again).toBe(theatres);
    expect(harness.world.requests.filter((request) => request.endsWith("/api/theatres"))).toHaveLength(1);
  });

  it("shows the hall of a showing with the good zone of a hunt, or the default one", async () => {
    const config = await harness.seed();
    const watcher = await harness.watcher();

    const withHunt = await watcher.services.hall(5116, 575978, config.hunts[0]?.id);
    const withDefault = await watcher.services.hall(5116, 575978);

    expect(withHunt.performance.screenName).toBe("SALA 1 IMAX");
    expect(withHunt.analysis.free).toBe(44);
    expect(withHunt.analysis.freeInZone).toBe(0);
    expect(withDefault.rule.zone).toEqual(config.settings.defaultZone);
  });

  it("sends the current situation of a hunt on request without touching its state", async () => {
    const config = await harness.seed();
    const huntId = config.hunts[0]?.id ?? "";
    const watcher = await harness.watcher();
    await watcher.tick();
    harness.world.telegram.length = 0;
    const before = JSON.stringify(watcher.state());

    const result = await watcher.sendSnapshot(huntId);

    expect(result).toBe(true);
    expect(harness.world.telegram.map((call) => call.method)).toEqual(["sendPhoto", "sendMessage"]);
    expect(JSON.stringify(watcher.state())).toBe(before);
  });

  it("adds a hunt through saveConfig and runs it on the next round", async () => {
    const config = await harness.seed((draft) => {
      draft.hunts = [];
    });
    const watcher = await harness.watcher();
    const next = structuredClone(config);
    next.hunts.push(
      createHunt(
        { name: "Dune", theatres: ["uci-cinemas-verona"], movie: { kind: "slug", slugs: ["dune-parte-tre"] }, formats: ["IMAX"], window: { kind: "fixed", from: "2026-12-15", to: "2026-12-16" } },
        next.settings,
        () => 0.3,
      ),
    );

    await watcher.saveConfig(next);
    await watcher.tick();

    expect(harness.world.telegram.map((call) => call.method)).toEqual(["sendPhoto", "sendMessage"]);
  });
});
