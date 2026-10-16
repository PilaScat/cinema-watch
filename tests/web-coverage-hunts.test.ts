import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config, Hunt } from "../src/model.js";
import { fixture } from "./support/fake-world.js";
import { createHarness, duneHunt, type Harness } from "./support/harness.js";
import { createWebApp, huntForm, occupancyWithout, PERFORMANCE, post, rewriteJson, UCI_HOST, WEBTIC_HOST } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function replaceHunt(overrides: Partial<Hunt>) {
  return (config: Config) => {
    config.hunts.length = 0;
    config.hunts.push(duneHunt(config, overrides));
  };
}

function withSecondHunt(config: Config) {
  config.hunts.push({ ...duneHunt(config, { name: "Seconda caccia" }), id: "bbbbbbbb" });
}

describe("hunt form variants", () => {
  it("adds an open-window hunt with no formats, no days, no alerts and a blank interval", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request(
      "/hunts",
      post(huntForm({ name: "Aperta", windowKind: "next", windowDays: "14", format: [], notify: [], enabled: [], interval: "", timeFrom: "18:30", timeTo: "22:00" })),
    );
    const added = watcher.config().hunts.find((hunt) => hunt.name === "Aperta");

    expect(response.status).toBe(303);
    expect(added?.window).toEqual({ kind: "next", days: 14 });
    expect(added?.formats).toEqual([]);
    expect(added?.weekdays).toBeNull();
    expect(added?.languages).toBeNull();
    expect(added?.intervalMinutes).toBeNull();
    expect(added?.enabled).toBe(false);
    expect(added?.timeFrom).toBe("18:30");
    expect(added?.timeTo).toBe("22:00");
    expect(added?.notify).toEqual({ newShowings: false, seatsFreed: false, lastSeats: false, cancelled: false, moved: false, movieAppeared: false, digest: false });
  });

  it("treats a missing window kind as an open window", async () => {
    const { instance, watcher } = await createWebApp(harness);
    const entries = huntForm({ name: "Senza tipo", windowDays: "10" }).filter(([key]) => key !== "windowKind");

    const response = await instance.request("/hunts", post(entries));

    expect(response.status).toBe(303);
    expect(watcher.config().hunts.find((hunt) => hunt.name === "Senza tipo")?.window).toEqual({ kind: "next", days: 10 });
  });

  it("turns on every alert that is ticked", async () => {
    const { instance, watcher } = await createWebApp(harness);

    await instance.request("/hunts", post(huntForm({ name: "Tutti gli avvisi", notify: ["newShowings", "seatsFreed", "lastSeats", "cancelled", "moved", "movieAppeared", "digest"] })));

    expect(watcher.config().hunts.find((hunt) => hunt.name === "Tutti gli avvisi")?.notify).toEqual({
      newShowings: true,
      seatsFreed: true,
      lastSeats: true,
      cancelled: true,
      moved: true,
      movieAppeared: true,
      digest: true,
    });
  });

  it("keeps the confirmed slugs when a title hunt is saved again", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness, { mutate: replaceHunt({ movie: { kind: "title", words: ["dune"], confirmedSlugs: ["dune-parte-tre"] } }) });

    const response = await instance.request(`/hunts/${huntId}`, post(huntForm({ movieKind: "title", movieWords: "dune parte" })));

    expect(response.status).toBe(303);
    expect(watcher.config().hunts[0]?.movie).toEqual({ kind: "title", words: ["dune", "parte"], confirmedSlugs: ["dune-parte-tre"] });
  });

  it("starts with no confirmed slugs when a slug hunt is switched to a title hunt", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);

    await instance.request(`/hunts/${huntId}`, post(huntForm({ movieKind: "title", movieWords: "dune" })));

    expect(watcher.config().hunts[0]?.movie).toEqual({ kind: "title", words: ["dune"], confirmedSlugs: [] });
  });

  it("edits one hunt and leaves the other untouched", async () => {
    const { instance, watcher, huntId, config } = await createWebApp(harness, { mutate: withSecondHunt });

    await instance.request(`/hunts/${huntId}`, post(huntForm({ name: "Prima rinominata" })));

    expect(watcher.config().hunts.map((hunt) => hunt.name)).toEqual(["Prima rinominata", "Seconda caccia"]);
    expect(watcher.config().hunts[1]).toEqual(config.hunts[1]);
  });

  it("deletes one hunt and keeps the other", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness, { mutate: withSecondHunt });

    await instance.request(`/hunts/${huntId}/delete`, post());

    expect(watcher.config().hunts.map((hunt) => hunt.name)).toEqual(["Seconda caccia"]);
  });

  it("prefills an edit page with every saved value", async () => {
    const { instance, huntId } = await createWebApp(harness, {
      mutate: replaceHunt({
        window: { kind: "next", days: 14 },
        timeFrom: "18:30",
        timeTo: "22:00",
        weekdays: [5, 6],
        languages: ["ITA", "ENG"],
        intervalMinutes: 7,
        extraChatIds: ["-1001234", "@canale_test"],
        formats: ["IMAX", "Dolby Cinema"],
        zone: { kind: "relative", rowsFromPercent: 30, rowsToPercent: 70, centerPercent: 50 },
      }),
    });

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toMatch(/name="windowKind" value="next" checked/);
    expect(html).toMatch(/name="windowDays"[^>]*value="14"/);
    expect(html).toMatch(/name="timeFrom"[^>]*value="18:30"/);
    expect(html).toMatch(/name="timeTo"[^>]*value="22:00"/);
    expect(html).toMatch(/name="weekday" value="5" checked/);
    expect(html).toMatch(/name="weekday" value="6" checked/);
    expect(html).not.toMatch(/name="weekday" value="1" checked/);
    expect(html).toMatch(/name="languages"[^>]*value="ITA, ENG"/);
    expect(html).toMatch(/name="interval"[^>]*value="7"/);
    expect(html).toContain("-1001234\n@canale_test");
    expect(html).toMatch(/name="format" value="Dolby Cinema" checked/);
    expect(html).toMatch(/name="zoneFrom"[^>]*value="30"/);
    expect(html).toMatch(/name="zoneTo"[^>]*value="70"/);
    expect(html).toMatch(/name="zoneCenter"[^>]*value="50"/);
    expect(html).not.toContain("Zona fissa");
  });

  it("describes a fixed zone with open seat bounds", async () => {
    const { instance, huntId } = await createWebApp(harness, { mutate: replaceHunt({ zone: { kind: "absolute", rows: ["F", "G"], seatFrom: null, seatTo: null } }) });

    expect(await (await instance.request(`/hunts/${huntId}`)).text()).toContain("Zona fissa: file F, G, posti …-…");
  });

  it("describes a title hunt with an empty slug field", async () => {
    const { instance, huntId } = await createWebApp(harness, { mutate: replaceHunt({ movie: { kind: "title", words: ["dune", "parte"], confirmedSlugs: [] } }) });

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toMatch(/name="movieKind" value="title" checked/);
    expect(html).toMatch(/name="movieWords"[^>]*value="dune parte"/);
    expect(html).toMatch(/name="movieSlugs"[^>]*value=""/);
  });
});

describe("hunt form errors", () => {
  it("shows a window error next to the days field of an open window", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request("/hunts", post(huntForm({ name: "Giorni", windowKind: "next", windowDays: "0" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(watcher.config().hunts).toHaveLength(1);
    expect(html).toContain("intero da 1 a 60");
    expect(html.indexOf("intero da 1 a 60")).toBeGreaterThan(html.indexOf('name="windowDays"'));
  });

  it("shows an error next to the first day of a fixed window", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts", post(huntForm({ windowFrom: "", windowTo: "2026-12-10" })))).text();

    expect(html).toContain("giorno non valido");
    expect(html.indexOf("giorno non valido")).toBeGreaterThan(html.indexOf('name="windowFrom"'));
  });

  it("shows an error next to the last day of a fixed window", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts", post(huntForm({ windowFrom: "2026-12-10", windowTo: "" })))).text();

    expect(html.indexOf("giorno non valido")).toBeGreaterThan(html.indexOf('name="windowTo"'));
  });

  it("shows slug errors next to the slug field, and title errors next to the title field", async () => {
    const { instance } = await createWebApp(harness);

    const slug = await (await instance.request("/hunts", post(huntForm({ movieSlugs: "Dune Parte!" })))).text();
    const title = await (await instance.request("/hunts", post(huntForm({ movieKind: "title", movieWords: "" })))).text();

    expect(slug).toContain("solo minuscole, cifre e trattini");
    expect(slug.indexOf("solo minuscole")).toBeGreaterThan(slug.indexOf('name="movieSlugs"'));
    expect(slug.indexOf("solo minuscole")).toBeLessThan(slug.indexOf('name="movieWords"'));
    expect(title).toContain("almeno una parola");
    expect(title.indexOf("almeno una parola")).toBeGreaterThan(title.indexOf('name="movieWords"'));
  });

  it("shows errors for a blank name, bad times, repeated weekdays, a bad interval and bad chats", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const response = await instance.request(
      "/hunts",
      post(huntForm({ name: "", timeFrom: "7pm", weekday: ["3", "3"], interval: "0", threshold: "-1", extraChats: "not a chat\n@ok_one" })),
    );
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(watcher.config().hunts).toHaveLength(1);
    expect(html).toContain("da 1 a 80 caratteri");
    expect(html).toContain("formato HH:MM");
    expect(html).toContain("giorni ripetuti");
    expect(html).toContain("intero da 1 a 1440");
    expect(html).toContain("intero da 0 a 500");
    expect(html).toContain("numero o @nome");
    expect(html.indexOf("numero o @nome")).toBeGreaterThan(html.indexOf('name="extraChats"'));
    expect(html).toMatch(/name="timeFrom"[^>]*value="7pm"/);
    expect(html).toContain("not a chat\n@ok_one");
  });

  it("shows an error next to the zone when its percentages are invalid", async () => {
    const { instance } = await createWebApp(harness);

    const inverted = await (await instance.request("/hunts", post(huntForm({ zoneFrom: "80", zoneTo: "20", zoneCenter: "50" })))).text();
    const partial = await (await instance.request("/hunts", post(huntForm({ zoneFrom: "30" })))).text();

    expect(inverted).toContain("le file iniziano dopo che finiscono");
    expect(inverted.indexOf("le file iniziano")).toBeGreaterThan(inverted.indexOf('name="zoneCenter"'));
    expect(inverted).toMatch(/name="zoneFrom"[^>]*value="80"/);
    expect(partial).toContain("tipo non valido");
  });

  it("reports an error that belongs to no field above the form", async () => {
    const { instance, watcher } = await createWebApp(harness);
    watcher.saveConfig = () => Promise.resolve({ ok: false, errors: ["settings.albumSize: intero da 1 a 10", "hunts[1].hallZones: chiavi nel formato cinema-sala", "errore senza percorso"] });

    const response = await instance.request("/hunts", post(huntForm()));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("settings.albumSize: intero da 1 a 10");
    expect(html).toContain("hunts[1].hallZones: chiavi nel formato cinema-sala");
    expect(html).toContain("errore senza percorso");
    expect(html.indexOf("errore senza percorso")).toBeLessThan(html.indexOf('name="name"'));
  });

  it("keeps the typed values of an existing hunt when saving is refused", async () => {
    const { instance, huntId, watcher } = await createWebApp(harness, { mutate: withSecondHunt });

    const response = await instance.request(`/hunts/${huntId}`, post(huntForm({ name: "Cambiata", together: "11" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("intero da 1 a 10");
    expect(html).toMatch(/name="name"[^>]*value="Cambiata"/);
    expect(html).toContain(`action="/hunts/${huntId}"`);
    expect(watcher.config().hunts[0]?.name).toBe("Dune IMAX Verona");
  });
});

describe("hunt form when the cinemas cannot be read", () => {
  it("asks for the cinema slugs as text and saves them", async () => {
    const { instance, watcher } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);

    const page = await (await instance.request("/hunts/new")).text();
    const response = await instance.request("/hunts", post(huntForm({ name: "A mano", theatre: [], theatreText: "uci-cinemas-verona, uci-cinemas-milano" })));

    expect(page).toContain('name="theatreText"');
    expect(page).not.toContain('name="theatre"');
    expect(response.status).toBe(303);
    expect(watcher.config().hunts.find((hunt) => hunt.name === "A mano")?.theatres).toEqual(["uci-cinemas-verona", "uci-cinemas-milano"]);
  });

  it("shows the error next to the text field and keeps what was typed", async () => {
    const { instance } = await createWebApp(harness);
    harness.world.failHost(UCI_HOST, 500);

    const response = await instance.request("/hunts", post(huntForm({ theatre: [], theatreText: "uci-cinemas-verona, Bad Slug" })));
    const html = await response.text();

    expect(response.status).toBe(400);
    expect(html).toContain("solo minuscole, cifre e trattini");
    expect(html.indexOf("solo minuscole")).toBeGreaterThan(html.indexOf('name="theatreText"'));
    expect(html).toMatch(/name="theatreText"[^>]*value="uci-cinemas-verona, Bad Slug"/);
  });

  it("groups cinemas without a region under other regions", async () => {
    rewriteJson(harness, (url) => url.pathname.endsWith("/theatres"), (json) => ({ data: (json as { data: Array<{ slug: string }> }).data.map((theatre) => (theatre.slug === "uci-cinemas-verona" ? { ...theatre, region: null } : theatre)) }));
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/hunts/new")).text();

    expect(html).toContain("Altre regioni");
  });
});

describe("hunt status cards", () => {
  it("says the seats were not read for showings found while Webtic was down, and offers no hall to pick", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);
    harness.world.failHost(WEBTIC_HOST, 500);
    await watcher.tick();

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toContain("Posti non letti");
    expect(html).toContain("Nessuna zona ritoccata.");
    expect(html).not.toContain("Fissa la zona su questa sala");
  });

  it("counts the free seats in the zone, singular and plural", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);
    await watcher.tick();
    const base = fixture("webtic/occupancy-5116-575978.json");

    harness.world.setOccupancy(5116, 575978, occupancyWithout(base, ["H/9"]));
    harness.advance(6 * 60_000);
    await watcher.tick();
    const one = await (await instance.request(`/hunts/${huntId}`)).text();

    harness.world.setOccupancy(5116, 575978, occupancyWithout(base, ["H/9", "H/10", "H/11"]));
    harness.advance(6 * 60_000);
    await watcher.tick();
    const three = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(one).toContain("1 libero nella zona");
    expect(three).toContain("3 liberi nella zona");
  });

  it("shows a stored zone with its room, and a stored zone with unbounded seats", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness, {
      mutate: replaceHunt({
        hallZones: {
          "5116-2": { kind: "absolute", rows: ["F"], seatFrom: null, seatTo: null },
          "5116-9": { kind: "absolute", rows: ["A", "B"], seatFrom: 3, seatTo: null },
        },
      }),
    });
    await watcher.tick();

    const html = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(html).toContain("file F<");
    expect(html).toContain("file A, B, posti 3-…");
    expect(html).toContain("5116-9");
    expect(html).toContain(`/hunts/${huntId}/zones/5116-9/delete`);
  });

  it("removes only the zone of one hunt and ignores a zone that is not there", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness, {
      mutate: (config) => {
        replaceHunt({ hallZones: { "5116-2": { kind: "absolute", rows: ["F"], seatFrom: 5, seatTo: 8 } } })(config);
        config.hunts.push({ ...duneHunt(config, { name: "Seconda caccia", hallZones: { "5116-2": { kind: "absolute", rows: ["G"], seatFrom: null, seatTo: null } } }), id: "bbbbbbbb" });
      },
    });

    const missing = await instance.request(`/hunts/${huntId}/zones/5116-77/delete`, post());
    const removed = await instance.request(`/hunts/${huntId}/zones/5116-2/delete`, post());

    expect(missing.status).toBe(303);
    expect(removed.status).toBe(303);
    expect(watcher.config().hunts[0]?.hallZones).toEqual({});
    expect(watcher.config().hunts[1]?.hallZones).toEqual({ "5116-2": { kind: "absolute", rows: ["G"], seatFrom: null, seatTo: null } });
  });
});

describe("hunt routes with an unknown hunt", () => {
  it("answers 404 for every hunt route", async () => {
    const { instance } = await createWebApp(harness);

    const checks = await Promise.all([
      instance.request("/hunts/zzzzzzzz/delete", post()),
      instance.request("/hunts/zzzzzzzz/confirm", post({ slug: "dune-parte-tre" })),
      instance.request("/hunts/zzzzzzzz/send", post()),
      instance.request("/hunts/zzzzzzzz/zones/5116-2/delete", post()),
      instance.request(`/hunts/zzzzzzzz/zone?performance=${PERFORMANCE}`),
      instance.request("/hunts/zzzzzzzz/zone", post({ performance: PERFORMANCE, rows: "F", seatFrom: "1", seatTo: "2" })),
    ]);

    expect(checks.map((response) => response.status)).toEqual([404, 404, 404, 404, 404, 404]);
  });

  it("answers 404 for a malformed hunt id before looking it up", async () => {
    const { instance } = await createWebApp(harness);

    expect((await instance.request("/hunts/ABCDEFGH")).status).toBe(404);
    expect((await instance.request("/hunts/abc")).status).toBe(404);
  });

  it("ignores a confirmation with an invalid slug", async () => {
    const { instance, huntId, watcher } = await createWebApp(harness, { mutate: replaceHunt({ movie: { kind: "title", words: ["dune"], confirmedSlugs: [] } }) });

    const response = await instance.request(`/hunts/${huntId}/confirm`, post({ slug: "Not A Slug!" }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/hunts/${huntId}`);
    expect(watcher.config().hunts[0]?.movie).toEqual({ kind: "title", words: ["dune"], confirmedSlugs: [] });
  });
});

describe("hall zone page", () => {
  it("answers 404 without a performance and for a malformed zone key", async () => {
    const { instance, huntId } = await createWebApp(harness);

    expect((await instance.request(`/hunts/${huntId}/zone`)).status).toBe(404);
    expect((await instance.request(`/hunts/${huntId}/zone`, post({ rows: "F" }))).status).toBe(404);
    expect((await instance.request(`/hunts/${huntId}/zones/5116/delete`, post())).status).toBe(404);
  });

  it("says the hall is unavailable when Webtic is down, on page and on save", async () => {
    const { instance, huntId, watcher } = await createWebApp(harness);
    harness.world.failHost(WEBTIC_HOST, 500);

    const page = await instance.request(`/hunts/${huntId}/zone?performance=${PERFORMANCE}`);
    const saved = await instance.request(`/hunts/${huntId}/zone`, post({ performance: PERFORMANCE, rows: "F", seatFrom: "5", seatTo: "16" }));

    expect(page.status).toBe(500);
    expect(await page.text()).toContain("Pianta non disponibile.");
    expect(saved.status).toBe(500);
    expect(await saved.text()).toContain("Pianta non disponibile.");
    expect(watcher.config().hunts[0]?.hallZones).toEqual({});
  });

  it("starts from empty fields when the hunt has a relative zone and no zone for the hall", async () => {
    const { instance, huntId } = await createWebApp(harness, { mutate: replaceHunt({ zone: { kind: "relative", rowsFromPercent: 30, rowsToPercent: 70, centerPercent: 50 } }) });

    const html = await (await instance.request(`/hunts/${huntId}/zone?performance=${PERFORMANCE}`)).text();

    expect(html).toMatch(/name="rows"[^>]*value=""/);
    expect(html).toMatch(/name="seatFrom"[^>]*value=""/);
    expect(html).toMatch(/name="seatTo"[^>]*value=""/);
  });

  it("shows the saved zone of that hall, with open bounds left empty", async () => {
    const { instance, huntId } = await createWebApp(harness, { mutate: replaceHunt({ hallZones: { "5116-2": { kind: "absolute", rows: ["H"], seatFrom: 6, seatTo: null } } }) });

    const html = await (await instance.request(`/hunts/${huntId}/zone?performance=${PERFORMANCE}`)).text();

    expect(html).toMatch(/name="rows"[^>]*value="H"/);
    expect(html).toMatch(/name="seatFrom"[^>]*value="6"/);
    expect(html).toMatch(/name="seatTo"[^>]*value=""/);
  });

  it("saves a zone with open bounds and keeps the zones of other hunts", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness, { mutate: withSecondHunt });

    const response = await instance.request(`/hunts/${huntId}/zone`, post({ performance: PERFORMANCE, rows: "H, J", seatFrom: "", seatTo: "" }));

    expect(response.status).toBe(303);
    expect(watcher.config().hunts[0]?.hallZones).toEqual({ "5116-2": { kind: "absolute", rows: ["H", "J"], seatFrom: null, seatTo: null } });
    expect(watcher.config().hunts[1]?.hallZones).toEqual({});
  });

  it("shows an error next to the seat fields for values that are not seats", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);

    const zero = await instance.request(`/hunts/${huntId}/zone`, post({ performance: PERFORMANCE, rows: "F", seatFrom: "0", seatTo: "9" }));
    const text = await instance.request(`/hunts/${huntId}/zone`, post({ performance: PERFORMANCE, rows: "F", seatFrom: "3", seatTo: "abc" }));
    const zeroHtml = await zero.text();
    const textHtml = await text.text();

    expect(zero.status).toBe(400);
    expect(zeroHtml).toContain("intero da 1");
    expect(zeroHtml.indexOf("intero da 1")).toBeGreaterThan(zeroHtml.indexOf('name="seatFrom"'));
    expect(text.status).toBe(400);
    expect(textHtml).toContain("tipo non valido");
    expect(textHtml.indexOf("tipo non valido")).toBeGreaterThan(textHtml.indexOf('name="seatTo"'));
    expect(watcher.config().hunts[0]?.hallZones).toEqual({});
  });

  it("reports a zone error that belongs to no field above the page", async () => {
    const { instance, huntId, watcher } = await createWebApp(harness);
    watcher.saveConfig = () => Promise.resolve({ ok: false, errors: ["settings.albumSize: intero da 1 a 10"] });

    const response = await instance.request(`/hunts/${huntId}/zone`, post({ performance: PERFORMANCE, rows: "F", seatFrom: "5", seatTo: "9" }));

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("settings.albumSize: intero da 1 a 10");
  });
});
