import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, duneHunt, type Harness } from "./support/harness.js";
import { createWebApp, post, UCI_HOST } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

describe("home page badges and sections", () => {
  it("shows the active badge with run times, the cinema name and the actions", async () => {
    const { instance, huntId, watcher } = await createWebApp(harness);
    await watcher.tick();

    const html = await (await instance.request("/")).text();

    expect(html).toContain("Attiva");
    expect(html).toContain("UCI Cinemas Verona");
    expect(html).toContain("Prossimo giro alle");
    expect(html).toContain("Ultimo giro alle");
    expect(html).toContain(`action="/hunts/${huntId}/mute"`);
    expect(html).toContain(`action="/hunts/${huntId}/refresh"`);
    expect(html).toContain('action="/hunts/refresh"');
  });

  it("shows a muted badge and a resume button after muting", async () => {
    const { instance, huntId } = await createWebApp(harness);
    await instance.request(`/hunts/${huntId}/mute`, post());

    const html = await (await instance.request("/")).text();

    expect(html).toContain("Silenziata fino alle");
    expect(html).toContain(`action="/hunts/${huntId}/resume"`);
    expect(html).not.toContain(`action="/hunts/${huntId}/mute"`);
  });

  it("shows a paused badge, without refresh or mute buttons, for a disabled hunt", async () => {
    const { instance, huntId } = await createWebApp(harness, {
      mutate: (config) => {
        const hunt = config.hunts[0];
        if (hunt) hunt.enabled = false;
      },
    });

    const html = await (await instance.request("/")).text();

    expect(html).toContain("In pausa");
    expect(html).not.toContain(`action="/hunts/${huntId}/refresh"`);
    expect(html).not.toContain(`action="/hunts/${huntId}/mute"`);
  });

  it("moves a bought hunt into the archived section", async () => {
    const { instance, huntId, watcher } = await createWebApp(harness);

    const bought = await instance.request(`/hunts/${huntId}/bought`, post());
    const html = await (await instance.request("/")).text();

    expect(bought.status).toBe(303);
    expect(watcher.config().hunts[0]?.archivedAt).not.toBeNull();
    expect(html).toContain("<details");
    expect(html).toContain("Archiviate");
    expect(html).toContain("Archiviata");
    expect(html).toContain("Dune IMAX Verona");
    expect(html).toContain("Nessuna caccia.");
    expect(html).not.toContain('action="/hunts/refresh"');
  });

  it("shows a failed badge when the last run could not reach the cinema", async () => {
    const { instance, watcher } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);
    await watcher.tick();

    const html = await (await instance.request("/")).text();

    expect(html).toContain("Ultimo giro non riuscito");
  });

  it("falls back to theatre slugs when the cinema list cannot be read", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);

    const html = await (await instance.request("/")).text();

    expect(html).toContain("uci-cinemas-verona");
    expect(html).not.toContain("UCI Cinemas Verona");
  });

  it("says all formats and only today for an open one-day window", async () => {
    const { instance } = await createWebApp(harness, {
      mutate: (config) => {
        config.hunts.length = 0;
        config.hunts.push(duneHunt(config, { formats: [], window: { kind: "next", days: 1 } }));
      },
    });

    const html = await (await instance.request("/")).text();

    expect(html).toContain("tutti i formati");
    expect(html).toContain("solo oggi");
  });

  it("says how many days an open window covers", async () => {
    const { instance } = await createWebApp(harness, {
      mutate: (config) => {
        config.hunts.length = 0;
        config.hunts.push(duneHunt(config, { window: { kind: "next", days: 14 } }));
      },
    });

    expect(await (await instance.request("/")).text()).toContain("prossimi 14 giorni");
  });

  it("says how many movies wait for confirmation on a title hunt", async () => {
    const { instance, watcher } = await createWebApp(harness, {
      mutate: (config) => {
        config.hunts.length = 0;
        config.hunts.push(duneHunt(config, { movie: { kind: "title", words: ["dune"], confirmedSlugs: [] } }));
      },
    });
    await watcher.tick();

    const html = await (await instance.request("/")).text();

    expect(html).toContain("1 film da confermare");
  });
});

describe("home actions", () => {
  it("refreshes every hunt and goes back", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);

    const response = await instance.request("/hunts/refresh", post());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(watcher.state().hunts[huntId]?.lastRun?.ok).toBe(true);
  });

  it("refreshes one hunt and goes back to the page it came from", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);

    const response = await instance.request(`/hunts/${huntId}/refresh`, post([], { origin: "http://localhost", referer: "http://localhost/hunts/new?x=1" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/hunts/new?x=1");
    expect(watcher.state().hunts[huntId]?.lastRun?.ok).toBe(true);
  });

  it("ignores a referer from another site", async () => {
    const { instance, huntId } = await createWebApp(harness);

    const response = await instance.request(`/hunts/${huntId}/resume`, post([], { origin: "http://localhost", referer: "https://evil.example/steal" }));

    expect(response.headers.get("location")).toBe("/");
  });

  it("ignores an unreadable referer", async () => {
    const { instance, huntId } = await createWebApp(harness);

    const response = await instance.request(`/hunts/${huntId}/resume`, post([], { origin: "http://localhost", referer: "not a url" }));

    expect(response.headers.get("location")).toBe("/");
  });

  it("answers 404 for unknown and malformed ids on every action", async () => {
    const { instance } = await createWebApp(harness);

    const statuses = await Promise.all(
      ["refresh", "mute", "resume", "bought"].flatMap((action) => ["zzzzzzzz", "ABC", "a1"].map(async (id) => (await instance.request(`/hunts/${id}/${action}`, post())).status)),
    );

    expect(statuses).toEqual(new Array(12).fill(404));
  });
});
