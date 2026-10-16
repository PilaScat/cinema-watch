import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/model.js";
import { createApp } from "../src/web/app.js";
import { createStore } from "../src/store.js";
import { fixture } from "./support/fake-world.js";
import { createHarness, PRIMARY_CHAT, type Harness } from "./support/harness.js";
import { occupancyWithTaken } from "./support/web.js";

const publicDir = fileURLToPath(new URL("../src/web/public/", import.meta.url));
const assetsDir = fileURLToPath(new URL("../assets/", import.meta.url));
const ORIGIN = "http://localhost";
const PERFORMANCE = "5116-575978";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

async function app(mutate?: (config: Config) => void) {
  const config = await harness.seed(mutate);
  const watcher = await harness.watcher();
  const instance = await createApp({ watcher, version: "v2026.10.1", dataDir: harness.dataDir, env: {}, now: () => harness.now(), publicDir, assetsDir });
  return { instance, watcher, config, huntId: config.hunts[0]?.id ?? "" };
}

function post(entries: Array<[string, string]> = [], headers: Record<string, string> = { origin: ORIGIN }) {
  return { method: "POST", body: new URLSearchParams(entries), headers: { "content-type": "application/x-www-form-urlencoded", ...headers } };
}

function huntForm(overrides: Record<string, string | string[]> = {}): Array<[string, string]> {
  const base: Record<string, string | string[]> = {
    name: "Dune IMAX Verona",
    theatre: ["uci-cinemas-verona"],
    movieKind: "slug",
    movieSlugs: "dune-parte-tre",
    format: ["IMAX"],
    windowKind: "fixed",
    windowFrom: "2026-12-15",
    windowTo: "2026-12-16",
    windowDays: "30",
    together: "3",
    threshold: "10",
    notify: ["newShowings", "seatsFreed"],
    enabled: "1",
    ...overrides,
  };
  return Object.entries(base).flatMap(([key, value]): Array<[string, string]> => (Array.isArray(value) ? value.map((item): [string, string] => [key, item]) : [[key, value]]));
}

function zoneForm(overrides: Record<string, string> = {}): Array<[string, string]> {
  return Object.entries({ performance: PERFORMANCE, rows: "F, G", seatFrom: "5", seatTo: "16", ...overrides });
}

async function changeSeatMap() {
  const screen = fixture("webtic/screen-5116-2.json") as { Data: { Screen: { Seats: Array<{ SeatId: string; Row: number; Column: number; SeatType: string; SectorId: string }> } } };
  const seats = screen.Data.Screen.Seats.filter((seat) => seat.SeatId !== "A/1").map((seat) => ({
    id: seat.SeatId,
    rowLabel: seat.SeatId.split("/")[0],
    number: Number(seat.SeatId.split("/")[1]),
    row: seat.Row,
    column: seat.Column,
    sector: seat.SectorId,
    type: seat.SeatType,
  }));
  await createStore(harness.dataDir).writeJson("screens/5116-2.json", { localId: 5116, screenId: 2, seats, fetchedAt: harness.now() });
  harness.world.setOccupancy(5116, 575978, occupancyWithTaken(fixture("webtic/occupancy-5116-575978.json"), "A/1"));
}

describe("hall zone to confirm again", () => {
  it("marks the zone of a changed seat map and clears it once the zone is saved again", async () => {
    const { instance, watcher, huntId } = await app((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.hallZones = { "5116-2": { kind: "absolute", rows: ["F", "G"], seatFrom: 5, seatTo: 16 } };
    });
    await changeSeatMap();
    await watcher.tick();

    const flagged = await (await instance.request(`/hunts/${huntId}`)).text();
    const saved = await instance.request(`/hunts/${huntId}/zone`, post(zoneForm()));
    const after = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(flagged).toContain("Pianta cambiata: zona da riconfermare");
    expect(saved.status).toBe(303);
    expect(after).not.toContain("Pianta cambiata: zona da riconfermare");
  });

  it("forgets the request when the zone is removed", async () => {
    const { instance, watcher, huntId } = await app((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.hallZones = { "5116-2": { kind: "absolute", rows: ["F", "G"], seatFrom: 5, seatTo: 16 } };
    });
    await changeSeatMap();
    await watcher.tick();
    const flagged = watcher.state().hunts[huntId]?.hallsToReconfirm;

    await instance.request(`/hunts/${huntId}/zones/5116-2/delete`, post());

    expect(flagged).toEqual(["5116-2"]);

    expect(watcher.state().hunts[huntId]?.hallsToReconfirm).toEqual([]);
  });
});

describe("hunt form", () => {
  it("prefills a new hunt from the query", async () => {
    const { instance } = await app();

    const response = await instance.request("/hunts/new?theatre=uci-cinemas-verona&movie=dune-parte-tre&format=IMAX&from=2026-12-15&to=2026-12-16");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toMatch(/name="theatre" value="uci-cinemas-verona" checked/);
    expect(html).toMatch(/name="format" value="IMAX" checked/);
    expect(html).toMatch(/<option value="dune-parte-tre" selected/);
    expect(html).toMatch(/name="windowFrom"[^>]*value="2026-12-15"/);
    expect(html).toMatch(/name="windowKind" value="fixed" checked/);
    expect(html).toContain("Aggiungi caccia");
  });

  it("adds a valid hunt and goes back to the list", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/hunts", post(huntForm({ name: "Altra caccia", format: ["IMAX", "XL"], weekday: ["5", "6"], languages: "ITA, ENG", extraChats: "-1001234\n@canale_test" })));
    const added = watcher.config().hunts.find((hunt) => hunt.name === "Altra caccia");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(watcher.config().hunts).toHaveLength(2);
    expect(added?.theatres).toEqual(["uci-cinemas-verona"]);
    expect(added?.movie).toEqual({ kind: "slug", slugs: ["dune-parte-tre"] });
    expect(added?.formats).toEqual(["IMAX", "XL"]);
    expect(added?.window).toEqual({ kind: "fixed", from: "2026-12-15", to: "2026-12-16" });
    expect(added?.weekdays).toEqual([5, 6]);
    expect(added?.languages).toEqual(["ITA", "ENG"]);
    expect(added?.together).toBe(3);
    expect(added?.zone).toEqual(watcher.config().settings.defaultZone);
    expect(added?.notify).toMatchObject({ newShowings: true, seatsFreed: true, lastSeats: false, digest: false });
    expect(added?.extraChatIds).toEqual(["-1001234", "@canale_test"]);
  });

  it("adds a hunt by title and a relative zone", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/hunts", post(huntForm({ name: "Per titolo", movieKind: "title", movieWords: "dune parte", zoneFrom: "30", zoneTo: "70", zoneCenter: "50", interval: "7" })));
    const added = watcher.config().hunts.find((hunt) => hunt.name === "Per titolo");

    expect(response.status).toBe(303);
    expect(added?.movie).toEqual({ kind: "title", words: ["dune", "parte"], confirmedSlugs: [] });
    expect(added?.zone).toEqual({ kind: "relative", rowsFromPercent: 30, rowsToPercent: 70, centerPercent: 50 });
    expect(added?.intervalMinutes).toBe(7);
  });

  it("shows each error next to its field and keeps the typed values", async () => {
    const { instance, watcher } = await app();

    const response = await instance.request("/hunts", post(huntForm({ name: "Sbagliata", theatre: [], windowFrom: "2026-12-20", windowTo: "2026-12-10", together: "0" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(watcher.config().hunts).toHaveLength(1);
    expect(html).toContain("almeno un cinema");
    expect(html).toContain("precede l&#39;inizio");
    expect(html).toContain("intero da 1 a 10");
    expect(html).toMatch(/name="name"[^>]*value="Sbagliata"/);
    expect(html).toMatch(/name="windowFrom"[^>]*value="2026-12-20"/);
    expect(html.indexOf("precede")).toBeGreaterThan(html.indexOf('name="windowTo"'));
  });

  it("renames a hunt and keeps its fixed zone", async () => {
    const { instance, watcher, huntId, config } = await app();

    const page = await instance.request(`/hunts/${huntId}`);
    const response = await instance.request(`/hunts/${huntId}`, post(huntForm({ name: "Dune rinominata" })));
    const hunt = watcher.config().hunts[0];

    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Zona fissa: file F, G, H, J, K, L, posti 5-16");
    expect(response.status).toBe(303);
    expect(hunt?.name).toBe("Dune rinominata");
    expect(hunt?.id).toBe(huntId);
    expect(hunt?.zone).toEqual(config.hunts[0]?.zone);
  });

  it("deletes a hunt", async () => {
    const { instance, watcher, huntId } = await app();

    const response = await instance.request(`/hunts/${huntId}/delete`, post());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(watcher.config().hunts).toEqual([]);
  });

  it("archives a hunt marked as bought from its page, asking to confirm first", async () => {
    const { instance, watcher, huntId } = await app();

    const page = await (await instance.request(`/hunts/${huntId}`)).text();
    const response = await instance.request(`/hunts/${huntId}/bought`, post());

    expect(page).toMatch(new RegExp(`<form[^>]*action="/hunts/${huntId}/bought"[\\s\\S]*?data-confirm="Conferma e archivia"[\\s\\S]*?Acquistato`));
    expect(response.status).toBe(303);
    expect(watcher.config().hunts[0]?.archivedAt).not.toBeNull();
  });

  it("lists the followed showings with their link to the hall", async () => {
    const { instance, watcher, huntId } = await app();
    await watcher.tick();

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toContain(`/performances/5116/575978?hunt=${huntId}&amp;movie=dune-parte-tre&amp;theatre=uci-cinemas-verona`);
    expect(html).toContain("Fissa la zona su questa sala");
  });

  it("confirms a movie found by title", async () => {
    const { instance, watcher, huntId } = await app((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.movie = { kind: "title", words: ["dune"], confirmedSlugs: [] };
    });
    await watcher.tick();

    const page = await (await instance.request(`/hunts/${huntId}`)).text();
    const response = await instance.request(`/hunts/${huntId}/confirm`, post([["slug", "dune-parte-tre"]]));
    const movie = watcher.config().hunts[0]?.movie;
    const after = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(watcher.state().hunts[huntId]?.pendingMovieSlugs).toEqual([]);
    expect(page).toContain("Film da confermare");
    expect(page).toContain("dune-parte-tre");
    expect(response.status).toBe(303);
    expect(movie).toEqual({ kind: "title", words: ["dune"], confirmedSlugs: ["dune-parte-tre"] });
    expect(after).not.toContain("Film da confermare");
  });

  it("sends the current situation on Telegram", async () => {
    const { instance, watcher, huntId } = await app();
    await watcher.tick();
    harness.world.telegram.length = 0;

    const response = await instance.request(`/hunts/${huntId}/send`, post());
    const page = await (await instance.request(response.headers.get("location") ?? "")).text();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/hunts/${huntId}?sent=ok`);
    expect(page).toContain("Situazione inviata su Telegram.");
    expect(harness.world.telegram.map((call) => `${call.method}:${call.chatId}`)).toEqual([`sendPhoto:${PRIMARY_CHAT}`, `sendMessage:${PRIMARY_CHAT}`]);
  });

  it("says when sending on Telegram did not work", async () => {
    const { instance, huntId } = await app();
    harness.world.failHost("api.telegram.org", 500);

    const response = await instance.request(`/hunts/${huntId}/send`, post());
    const page = await (await instance.request(response.headers.get("location") ?? "")).text();

    expect(response.headers.get("location")).toBe(`/hunts/${huntId}?sent=fail`);
    expect(page).toContain("Invio su Telegram non riuscito.");
  });

  it("titles the form for a new hunt with the verb of the vocabulary", async () => {
    const { instance } = await app();

    const html = await (await instance.request("/hunts/new")).text();

    expect(html).toContain("<title>Aggiungi caccia");
    expect(html).not.toContain("Nuova caccia");
  });
});

describe("hall zone", () => {
  it("shows the hall in both themes with clickable seats", async () => {
    const { instance, huntId } = await app();

    const response = await instance.request(`/hunts/${huntId}/zone?performance=${PERFORMANCE}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('data-seat="F/12"');
    expect(html).toContain("hall-svg dark:hidden");
    expect(html).toContain("hall-svg hidden dark:block");
    expect(html).toContain('src="/assets/hall-picker.js"');
    expect(html).toMatch(/name="rows"[^>]*value="F, G, H, J, K, L"/);
    expect(html).toContain("Dune: Parte Tre");
    expect(html).not.toContain("Parte Tre Sala Imax");
  });

  it("saves the zone of that hall and removes it again", async () => {
    const { instance, watcher, huntId } = await app();

    const saved = await instance.request(`/hunts/${huntId}/zone`, post(zoneForm()));
    const zones = watcher.config().hunts[0]?.hallZones;
    const page = await (await instance.request(`/hunts/${huntId}`)).text();
    const removed = await instance.request(`/hunts/${huntId}/zones/5116-2/delete`, post());

    expect(saved.status).toBe(303);
    expect(zones).toEqual({ "5116-2": { kind: "absolute", rows: ["F", "G"], seatFrom: 5, seatTo: 16 } });
    expect(page).toContain("5116-2");
    expect(removed.status).toBe(303);
    expect(watcher.config().hunts[0]?.hallZones).toEqual({});
  });

  it("refuses an inverted range and empty rows, keeping the typed values", async () => {
    const { instance, watcher, huntId } = await app();

    const inverted = await instance.request(`/hunts/${huntId}/zone`, post(zoneForm({ seatFrom: "16", seatTo: "5" })));
    const empty = await instance.request(`/hunts/${huntId}/zone`, post(zoneForm({ rows: "" })));
    const invertedHtml = await inverted.text();
    const emptyHtml = await empty.text();

    expect(inverted.status).toBe(400);
    expect(invertedHtml).toContain("il primo posto viene dopo l&#39;ultimo");
    expect(invertedHtml).toMatch(/name="seatFrom"[^>]*value="16"/);
    expect(empty.status).toBe(400);
    expect(emptyHtml).toContain("almeno una fila");
    expect(watcher.config().hunts[0]?.hallZones).toEqual({});
  });

  it("answers 404 for a malformed performance", async () => {
    const { instance, huntId } = await app();

    expect((await instance.request(`/hunts/${huntId}/zone?performance=abc`)).status).toBe(404);
    expect((await instance.request(`/hunts/${huntId}/zones/abc/delete`, post())).status).toBe(404);
  });
});

describe("hunt pages in general", () => {
  it("serves every page with a nonce on each script and no inline style", async () => {
    const { instance, huntId } = await app();

    for (const path of ["/hunts/new", `/hunts/${huntId}`, `/hunts/${huntId}/zone?performance=${PERFORMANCE}`]) {
      const response = await instance.request(path);
      const html = await response.text();
      const nonce = /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1] ?? "";
      expect(response.status).toBe(200);
      expect(html).not.toContain("style=");
      expect(nonce).not.toBe("");
      expect([...html.matchAll(/<script\b[^>]*>/g)].every(([tag]) => tag.includes(`nonce="${nonce}"`))).toBe(true);
    }
  });

  it("refuses posts without the right origin", async () => {
    const { instance, huntId, watcher } = await app();

    const paths = ["/hunts", `/hunts/${huntId}`, `/hunts/${huntId}/delete`, `/hunts/${huntId}/send`, `/hunts/${huntId}/zone`];
    const statuses = await Promise.all(paths.map(async (path) => (await instance.request(path, post(huntForm(), {}))).status));

    expect(statuses).toEqual([403, 403, 403, 403, 403]);
    expect(watcher.config().hunts).toHaveLength(1);
  });

  it("answers 404 for an unknown hunt", async () => {
    const { instance } = await app();

    expect((await instance.request("/hunts/zzzzzzzz")).status).toBe(404);
    expect((await instance.request("/hunts/zzzzzzzz", post(huntForm()))).status).toBe(404);
  });
});
