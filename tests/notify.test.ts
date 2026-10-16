import { describe, expect, it } from "vitest";
import {
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_TEXT_LIMIT,
  callbackData,
  composeDigest,
  composeNoNews,
  composeRound,
  parseCallbackData,
  selectPhotoKeys,
} from "../src/notify.js";
import type { ComposeContext, DigestEntry } from "../src/notify.js";
import type { Hunt, HuntEvent, OutgoingMessage, SeatSummary, ShowingSnapshot } from "../src/model.js";
import type { SeatGroup } from "../src/types.js";

describe("limits", () => {
  it("match the Telegram API", () => {
    expect(TELEGRAM_TEXT_LIMIT).toBe(4096);
    expect(TELEGRAM_CAPTION_LIMIT).toBe(1024);
  });
});

describe("callbackData", () => {
  it("builds prefixed ids", () => {
    expect(callbackData("refresh", "abcd1234")).toBe("a:abcd1234");
    expect(callbackData("mute", "abcd1234")).toBe("m:abcd1234");
    expect(callbackData("bought", "abcd1234")).toBe("b:abcd1234");
  });
  it("round-trips", () => {
    expect(parseCallbackData("a:abcd1234")).toEqual({ action: "refresh", huntId: "abcd1234" });
    expect(parseCallbackData("m:0z9y8x7w")).toEqual({ action: "mute", huntId: "0z9y8x7w" });
    expect(parseCallbackData("b:abcd1234")).toEqual({ action: "bought", huntId: "abcd1234" });
  });
  it("rejects invalid input", () => {
    expect(parseCallbackData("x:abcd1234")).toBeNull();
    expect(parseCallbackData("a:abcd123")).toBeNull();
    expect(parseCallbackData("a:abcd12345")).toBeNull();
    expect(parseCallbackData("a:ABCD1234")).toBeNull();
    expect(parseCallbackData("abcd1234")).toBeNull();
    expect(parseCallbackData("")).toBeNull();
  });
});

function group(row: string, from: number, to: number, score = 1): SeatGroup {
  const seatIds: string[] = [];
  for (let n = from; n <= to; n++) seatIds.push(`${row}/${n}`);
  return { rowLabel: row, seatIds, score };
}

function seats(overrides: Partial<SeatSummary> = {}): SeatSummary {
  return { free: 40, sellable: 100, freeInZone: 8, sellableInZone: 30, ok: true, best: [group("H", 9, 11, 5)], ...overrides };
}

function showing(overrides: Partial<ShowingSnapshot> = {}): ShowingSnapshot {
  return {
    key: "k1",
    localId: 11,
    eventId: 5,
    performanceId: 900,
    theatreSlug: "torino",
    movieSlug: "dune",
    movieTitle: "Dune",
    format: "IMAX",
    formatGroup: "imax",
    language: null,
    day: "2026-12-15",
    startsAt: "2026-12-15T20:30:00",
    time: "20:30",
    room: "Sala 3",
    cartUrl: "https://cart.example/1",
    screenId: 1,
    screenName: "Sala 3",
    priceFrom: null,
    seats: seats(),
    ...overrides,
  };
}

function hunt(overrides: Partial<Hunt> = {}): Hunt {
  return {
    id: "abcd1234",
    name: "Dune IMAX",
    enabled: true,
    archivedAt: null,
    theatres: ["torino"],
    movie: { kind: "slug", slugs: ["dune"] },
    formats: [],
    window: { kind: "next", days: 30 },
    timeFrom: null,
    timeTo: null,
    weekdays: null,
    languages: null,
    zone: { kind: "absolute", rows: ["H"], seatFrom: null, seatTo: null },
    hallZones: {},
    together: 2,
    intervalMinutes: null,
    lastSeatsThreshold: 4,
    notify: { newShowings: true, seatsFreed: true, lastSeats: true, cancelled: true, moved: true, movieAppeared: true, digest: true },
    extraChatIds: [],
    ...overrides,
  };
}

function context(overrides: Partial<ComposeContext> = {}): ComposeContext {
  return {
    hunt: hunt(),
    chats: { primary: "100", extra: [] },
    publicUrl: null,
    openAsButton: true,
    albumSize: 3,
    theatreNames: { torino: "Torino Lingotto" },
    ...overrides,
  };
}

function created(key: string, extra: Partial<ShowingSnapshot> = {}): HuntEvent {
  return { kind: "newShowing", showing: showing({ key, ...extra }) };
}

describe("selectPhotoKeys", () => {
  it("returns nothing without events", () => {
    expect(selectPhotoKeys([], 3)).toEqual([]);
  });
  it("puts seatsFreed first, then freeInZone, then best score, then start time", () => {
    const events: HuntEvent[] = [
      created("late-low", { startsAt: "2026-12-16T20:00:00", seats: seats({ freeInZone: 2 }) }),
      created("early-low", { startsAt: "2026-12-15T20:00:00", seats: seats({ freeInZone: 2 }) }),
      created("high-score", { seats: seats({ freeInZone: 2, best: [group("H", 1, 2, 9)] }) }),
      created("most", { seats: seats({ freeInZone: 20 }) }),
      { kind: "seatsFreed", showing: showing({ key: "freed", seats: seats({ freeInZone: 1 }) }), groups: [group("H", 9, 10)] },
    ];
    expect(selectPhotoKeys(events, 10)).toEqual(["freed", "most", "high-score", "early-low", "late-low"]);
  });
  it("limits to album size", () => {
    const events = [created("a"), created("b", { startsAt: "2026-12-15T21:00:00" }), created("c", { startsAt: "2026-12-15T22:00:00" })];
    expect(selectPhotoKeys(events, 2)).toEqual(["a", "b"]);
  });
  it("keeps keys unique", () => {
    const events: HuntEvent[] = [
      created("a"),
      { kind: "seatsFreed", showing: showing({ key: "a" }), groups: [] },
      created("a"),
    ];
    expect(selectPhotoKeys(events, 5)).toEqual(["a"]);
  });
  it("ignores showings without seat data, cancelled, appeared and empty last seats", () => {
    const events: HuntEvent[] = [
      created("no-seats", { seats: null }),
      { kind: "cancelled", showing: showing({ key: "gone" }) },
      { kind: "movieAppeared", movie: { slug: "x", title: "X", poster: null }, theatreSlug: "torino" },
      { kind: "lastSeats", showing: showing({ key: "empty" }), freeInZone: 0 },
      { kind: "lastSeats", showing: showing({ key: "few" }), freeInZone: 2 },
    ];
    expect(selectPhotoKeys(events, 5)).toEqual(["few"]);
  });
  it("uses the destination of a moved showing", () => {
    const events: HuntEvent[] = [{ kind: "moved", from: showing({ key: "old" }), to: showing({ key: "new" }) }];
    expect(selectPhotoKeys(events, 5)).toEqual(["new"]);
  });
  it("treats a showing without best groups as lowest score", () => {
    const events = [created("none", { seats: seats({ best: [] }) }), created("some")];
    expect(selectPhotoKeys(events, 5)).toEqual(["some", "none"]);
  });
});

function texts(messages: OutgoingMessage[]): Array<Extract<OutgoingMessage, { kind: "text" }>> {
  return messages.filter((message): message is Extract<OutgoingMessage, { kind: "text" }> => message.kind === "text");
}

function firstText(messages: OutgoingMessage[]): string {
  return texts(messages)[0]?.text ?? "";
}

function normalize(value: string): string {
  return value.replace(/\p{Zs}/gu, " ");
}

const REFRESH_ROW = [
  { text: "Aggiorna ora", callbackData: "a:abcd1234" },
  { text: "Silenzia 24 h", callbackData: "m:abcd1234" },
  { text: "Acquistato", callbackData: "b:abcd1234" },
];

describe("composeRound basics", () => {
  it("returns nothing without events", () => {
    expect(composeRound([], context())).toEqual([]);
  });

  it("writes to each chat once even when an extra chat repeats another", () => {
    const messages = composeRound([created("k1")], context({ chats: { primary: "100", extra: ["100", "-200", "-200"] } }));
    expect(messages.map((message) => `${message.kind}:${message.chatId}`)).toEqual([
      "photo:100",
      "text:100",
      "photo:-200",
      "text:-200",
    ]);
  });

  it("sends photo and text for one new showing", () => {
    const messages = composeRound([created("k1")], context());
    expect(messages).toEqual([
      {
        kind: "photo",
        chatId: "100",
        showingKey: "k1",
        caption: "<b>Dune</b>\nmar 15/12 20:30 · Sala 3 · IMAX\n40 liberi, 8 nella zona buona",
      },
      {
        kind: "text",
        chatId: "100",
        text: "🎬 <b>Dune IMAX</b>\n\n<b>Nuovi spettacoli</b>\nmar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · 40 liberi, 8 nella zona buona",
        keyboard: [[{ text: "Acquista", url: "https://cart.example/1" }], REFRESH_ROW],
      },
    ]);
  });

  it("adds the price when known", () => {
    const text = normalize(firstText(composeRound([created("k1", { priceFrom: 14.9 })], context())));
    expect(text).toContain("40 liberi, 8 nella zona buona · da 14,90 €");
  });

  it("escapes HTML in best groups", () => {
    const event: HuntEvent = { kind: "seatsFreed", showing: showing(), groups: [group("<A", 1, 3)] };
    expect(firstText(composeRound([event], context()))).toContain("\nMigliori: &lt;A 1-3");
  });

  it("lists freed seats with the best groups", () => {
    const event: HuntEvent = {
      kind: "seatsFreed",
      showing: showing(),
      groups: [group("H", 9, 11), group("G", 8, 10)],
    };
    expect(firstText(composeRound([event], context()))).toBe(
      "🎬 <b>Dune IMAX</b>\n\n<b>Posti liberati</b>\nmar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · 40 liberi, 8 nella zona buona\nMigliori: H 9-11, G 8-10",
    );
  });

  it("omits the best line when no groups are given", () => {
    const text = firstText(composeRound([{ kind: "seatsFreed", showing: showing(), groups: [] }], context()));
    expect(text).toBe(
      "🎬 <b>Dune IMAX</b>\n\n<b>Posti liberati</b>\nmar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · 40 liberi, 8 nella zona buona",
    );
  });

  it("orders sections and formats every event kind", () => {
    const events: HuntEvent[] = [
      { kind: "movieAppeared", movie: { slug: "tenet", title: "Tenet", poster: null }, theatreSlug: "torino" },
      { kind: "cancelled", showing: showing({ key: "c", time: "18:00", startsAt: "2026-12-15T18:00:00" }) },
      { kind: "moved", from: showing({ key: "m1" }), to: showing({ key: "m2", day: "2026-12-16", time: "21:00", startsAt: "2026-12-16T21:00:00" }) },
      { kind: "lastSeats", showing: showing({ key: "l" }), freeInZone: 2 },
      created("n2", { day: "2026-12-16", time: "19:00", startsAt: "2026-12-16T19:00:00" }),
      created("n1", { time: "22:00", startsAt: "2026-12-15T22:00:00" }),
      { kind: "seatsFreed", showing: showing({ key: "f" }), groups: [group("H", 9, 10)] },
    ];
    expect(firstText(composeRound(events, context({ albumSize: 1 })))).toBe(
      [
        "🎬 <b>Dune IMAX</b>",
        "",
        "<b>Posti liberati</b>",
        "mar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · 40 liberi, 8 nella zona buona",
        "Migliori: H 9-10",
        "",
        "<b>Nuovi spettacoli</b>",
        "mar 15/12 22:00 · Torino Lingotto · Sala 3 · IMAX · 40 liberi, 8 nella zona buona",
        "mer 16/12 19:00 · Torino Lingotto · Sala 3 · IMAX · 40 liberi, 8 nella zona buona",
        "",
        "<b>Ultimi posti</b>",
        "mar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · 2 liberi nella zona buona",
        "",
        "<b>Spostati</b>",
        "mar 15/12 20:30 → mer 16/12 21:00 · Torino Lingotto · Sala 3",
        "",
        "<b>Annullati</b>",
        "mar 15/12 18:00 · Torino Lingotto · Sala 3 · IMAX",
        "",
        "<b>Film comparsi</b>",
        "Tenet a Torino Lingotto: da confermare nella pagina della caccia",
      ].join("\n"),
    );
  });

  it("says when the last seats in the zone are gone", () => {
    const text = firstText(composeRound([{ kind: "lastSeats", showing: showing(), freeInZone: 0 }], context()));
    expect(text).toContain("mar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · zona buona esaurita");
  });

  it("falls back to the slug for an unknown theatre", () => {
    const text = firstText(composeRound([created("k1")], context({ theatreNames: {} })));
    expect(text).toContain("mar 15/12 20:30 · torino · Sala 3");
  });
});

describe("composeRound photos and keyboards", () => {
  it("sends an album then text when several showings qualify", () => {
    const times = ["20:00", "20:30", "21:00", "21:30", "22:00"];
    const events = times.map((time, index) =>
      created(`k${index}`, {
        localId: 20 + index,
        cartUrl: `https://cart.example/${index}`,
        time,
        startsAt: `2026-12-15T${time}:00`,
      }),
    );
    const messages = composeRound(events, context({ albumSize: 3 }));
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      kind: "album",
      chatId: "100",
      items: [
        { showingKey: "k0", caption: "<b>Dune</b>\nmar 15/12 20:00 · Sala 3 · IMAX\n40 liberi, 8 nella zona buona" },
        { showingKey: "k1", caption: "<b>Dune</b>\nmar 15/12 20:30 · Sala 3 · IMAX\n40 liberi, 8 nella zona buona" },
        { showingKey: "k2", caption: "<b>Dune</b>\nmar 15/12 21:00 · Sala 3 · IMAX\n40 liberi, 8 nella zona buona" },
      ],
    });
    const text = texts(messages)[0];
    expect(text?.text.split("\n").filter((line) => line.startsWith("mar 15/12"))).toHaveLength(5);
    expect(text?.keyboard).toEqual([
      [
        { text: "Acquista 20:00", url: "https://cart.example/0" },
        { text: "Acquista 20:30", url: "https://cart.example/1" },
        { text: "Acquista 21:00", url: "https://cart.example/2" },
      ],
      REFRESH_ROW,
    ]);
  });

  it("reduces the last row in extra chats", () => {
    const messages = composeRound([created("k1")], context({ chats: { primary: "100", extra: ["200", "300"] } }));
    expect(messages.map((message) => `${message.kind}:${message.chatId}`)).toEqual([
      "photo:100",
      "text:100",
      "photo:200",
      "text:200",
      "photo:300",
      "text:300",
    ]);
    expect(texts(messages)[1]?.keyboard).toEqual([
      [{ text: "Acquista", url: "https://cart.example/1" }],
      [{ text: "Aggiorna ora", callbackData: "a:abcd1234" }],
    ]);
  });

  it("skips photos and the buy row when the seat map is missing", () => {
    const messages = composeRound([created("k1", { seats: null })], context());
    expect(messages).toEqual([
      {
        kind: "text",
        chatId: "100",
        text: "🎬 <b>Dune IMAX</b>\n\n<b>Nuovi spettacoli</b>\nmar 15/12 20:30 · Torino Lingotto · Sala 3 · IMAX · pianta non disponibile",
        keyboard: [REFRESH_ROW],
      },
    ]);
  });

  it("sends only text with a reduced keyboard when films just appeared", () => {
    const event: HuntEvent = { kind: "movieAppeared", movie: { slug: "tenet", title: "Tenet", poster: null }, theatreSlug: "torino" };
    expect(composeRound([event], context())).toEqual([
      {
        kind: "text",
        chatId: "100",
        text: "🎬 <b>Dune IMAX</b>\n\n<b>Film comparsi</b>\nTenet a Torino Lingotto: da confermare nella pagina della caccia",
        keyboard: [[{ text: "Aggiorna ora", callbackData: "a:abcd1234" }]],
      },
    ]);
  });

  it("escapes HTML in names and titles", () => {
    const messages = composeRound(
      [created("k1", { movieTitle: "<script>&" })],
      context({ hunt: hunt({ name: "<script>&" }), theatreNames: { torino: "A&B" } }),
    );
    expect(messages[0]).toMatchObject({ kind: "photo", caption: expect.stringContaining("<b>&lt;script&gt;&amp;</b>\n") });
    expect(firstText(messages)).toContain("🎬 <b>&lt;script&gt;&amp;</b>");
    expect(firstText(messages)).toContain("· A&amp;B ·");
  });

  it("truncates long titles to fit the caption limit without cutting entities", () => {
    const messages = composeRound([created("k1", { movieTitle: "&".repeat(2000) })], context());
    const photo = messages[0];
    const caption = photo?.kind === "photo" ? photo.caption : "";
    expect(caption.length).toBeLessThanOrEqual(1024);
    expect(caption).toMatch(/^<b>(&amp;)+<\/b>\nmar 15\/12 20:30 · Sala 3 · IMAX\n40 liberi, 8 nella zona buona$/);
  });

  it("keeps callback data within 64 bytes", () => {
    const buttons = texts(composeRound([created("k1")], context())).flatMap((message) => message.keyboard?.flat() ?? []);
    const withData = buttons.filter((button) => button.callbackData !== undefined);
    expect(withData).toHaveLength(3);
    for (const button of withData) expect(Buffer.byteLength(button.callbackData ?? "")).toBeLessThanOrEqual(64);
  });
});

describe("composeRound hall link", () => {
  it("adds Apri sala as a button, tolerating a trailing slash", () => {
    const text = texts(composeRound([created("k1")], context({ publicUrl: "https://cw.example/" })))[0];
    expect(text?.keyboard).toEqual([
      [{ text: "Acquista", url: "https://cart.example/1" }],
      [{ text: "Apri sala", url: "https://cw.example/performances/11/900" }],
      REFRESH_ROW,
    ]);
    expect(text?.text).not.toContain("Apri sala");
  });

  it("adds Apri sala to the text when not a button", () => {
    const text = texts(composeRound([created("k1")], context({ publicUrl: "https://cw.example", openAsButton: false })))[0];
    expect(text?.text.endsWith("40 liberi, 8 nella zona buona\n\nApri sala: https://cw.example/performances/11/900")).toBe(true);
    expect(text?.keyboard).toEqual([[{ text: "Acquista", url: "https://cart.example/1" }], REFRESH_ROW]);
  });

  it("adds no hall link without a public URL", () => {
    expect(firstText(composeRound([created("k1")], context({ openAsButton: false })))).not.toContain("Apri sala");
  });
});

describe("composeRound size limit", () => {
  const many = Array.from({ length: 64 }, (_, index) => {
    const minutes = 10 * 60 + index * 10;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return created(`k${index}`, {
      localId: 1000 + index,
      performanceId: 5000 + index,
      time,
      startsAt: `2026-12-15T${time}:00`,
      seats: seats({ freeInZone: 100 - index }),
    });
  });

  it("truncates at a whole line and counts the omitted showings", () => {
    const messages = composeRound(many, context({ publicUrl: "https://cw.example", openAsButton: false, albumSize: 3 }));
    const text = firstText(messages);
    expect(text.length).toBeLessThanOrEqual(4096);
    const lines = text.split("\n");
    const shown = lines.filter((line) => line.startsWith("mar 15/12")).length;
    const omitted = Number(/^e altri (\d+)$/m.exec(text)?.[1]);
    expect(shown).toBeGreaterThan(0);
    expect(omitted).toBeGreaterThan(0);
    expect(shown + omitted).toBe(64);
    expect(lines.slice(-3)).toEqual([
      "Apri sala: https://cw.example/performances/1000/5000",
      "Apri sala: https://cw.example/performances/1001/5001",
      "Apri sala: https://cw.example/performances/1002/5002",
    ]);
    expect(lines[lines.length - 4]).toBe("");
    expect(lines[lines.length - 5]).toBe(`e altri ${omitted}`);
  });
});

function digestEntries(): DigestEntry[] {
  return [
    {
      hunt: hunt({ name: "Dune IMAX" }),
      showings: [showing(), showing({ key: "k2", seats: seats({ ok: false }) }), showing({ key: "k3", seats: null })],
      mutedUntil: null,
    },
    { hunt: hunt({ id: "bbbb2222", name: "Tenet" }), showings: [], mutedUntil: null },
  ];
}

describe("telegram style", () => {
  it("starts every text with one emoji and never uses exclamation marks", () => {
    const events: HuntEvent[] = [
      created("a"),
      { kind: "seatsFreed", showing: showing({ key: "b" }), groups: [group("H", 1, 2)] },
      { kind: "cancelled", showing: showing({ key: "c" }) },
      { kind: "movieAppeared", movie: { slug: "t", title: "T", poster: null }, theatreSlug: "torino" },
    ];
    const messages = texts(composeRound(events, context({ publicUrl: "https://cw.example" })));
    const all = [
      ...messages.map((message) => message.text),
      ...composeDigest(digestEntries()),
      ...composeNoNews(digestEntries()),
    ];
    expect(all).toHaveLength(3);
    for (const text of all) {
      expect(text).toMatch(/^\p{Extended_Pictographic}/u);
      expect(text.match(/\p{Extended_Pictographic}/gu)).toHaveLength(1);
      expect(text).not.toContain("!");
    }
  });
});

describe("composeDigest", () => {
  it("lists one line per hunt", () => {
    expect(composeDigest(digestEntries())).toEqual([
      "🗓 Riepilogo delle cacce\n\n<b>Dune IMAX</b>: 3 spettacoli, 1 con posti vicini nella zona buona\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11\n<b>Tenet</b>: nessuno spettacolo",
    ]);
  });

  it("adds under each hunt the showing with the best seats and its price", () => {
    const entries: DigestEntry[] = [
      {
        hunt: hunt({ name: "Dune IMAX" }),
        showings: [
          showing({ key: "a", seats: seats({ best: [group("C", 1, 2, 2)] }) }),
          showing({ key: "b", day: "2026-12-16", startsAt: "2026-12-16T21:00:00", time: "21:00", priceFrom: 14.9, seats: seats({ best: [group("H", 9, 11, 5)] }) }),
          showing({ key: "c", seats: seats({ ok: false, best: [group("A", 1, 3, 9)] }) }),
        ],
        mutedUntil: null,
      },
      { hunt: hunt({ id: "bbbb2222", name: "Senza posti" }), showings: [showing({ seats: seats({ ok: false }) })], mutedUntil: null },
    ];
    expect(composeDigest(entries)).toEqual([
      "🗓 Riepilogo delle cacce\n\n<b>Dune IMAX</b>: 3 spettacoli, 2 con posti vicini nella zona buona\nmer 16/12 21:00 · Sala 3 · Migliori: H 9-11 · da 14,90 €\n<b>Senza posti</b>: 1 spettacolo, 0 con posti vicini nella zona buona",
    ]);
    expect(composeNoNews(entries)[0]).toContain("\nmer 16/12 21:00 · Sala 3 · Migliori: H 9-11 · da 14,90 €\n");
  });

  it("uses the singular for one showing", () => {
    const entries = [{ hunt: hunt({ name: "Solo" }), showings: [showing()], mutedUntil: null }];
    expect(composeDigest(entries)).toEqual([
      "🗓 Riepilogo delle cacce\n\n<b>Solo</b>: 1 spettacolo, 1 con posti vicini nella zona buona\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11",
    ]);
  });

  it("marks muted hunts with the Rome time", () => {
    const entries = [
      { hunt: hunt({ name: "Dune IMAX" }), showings: [showing()], mutedUntil: Date.UTC(2026, 11, 15, 19, 30) },
      { hunt: hunt({ name: "Tenet" }), showings: [], mutedUntil: Date.UTC(2026, 11, 15, 8, 5) },
    ];
    expect(composeDigest(entries)).toEqual([
      "🗓 Riepilogo delle cacce\n\n<b>Dune IMAX</b>: 1 spettacolo, 1 con posti vicini nella zona buona · silenziata fino alle 20:30\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11\n<b>Tenet</b>: nessuno spettacolo · silenziata fino alle 09:05",
    ]);
  });

  it("escapes hunt names", () => {
    const entries = [{ hunt: hunt({ name: "A<B>&" }), showings: [], mutedUntil: null }];
    expect(composeDigest(entries)).toEqual(["🗓 Riepilogo delle cacce\n\n<b>A&lt;B&gt;&amp;</b>: nessuno spettacolo"]);
  });

  it("returns nothing without hunts", () => {
    expect(composeDigest([])).toEqual([]);
    expect(composeNoNews([])).toEqual([]);
  });

  it("splits at whole lines above the Telegram limit", () => {
    const entries: DigestEntry[] = Array.from({ length: 200 }, (_, index) => ({
      hunt: hunt({ id: "abcd1234", name: `Caccia numero ${String(index).padStart(3, "0")} con un nome lungo` }),
      showings: [],
      mutedUntil: null,
    }));
    const chunks = composeDigest(entries);
    expect(chunks.length).toBeGreaterThan(1);
    const lines: string[] = [];
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
      expect(chunk.startsWith("🗓 Riepilogo delle cacce\n\n")).toBe(true);
      lines.push(...chunk.split("\n").slice(2));
    }
    expect(lines).toHaveLength(200);
    expect(lines[0]).toBe("<b>Caccia numero 000 con un nome lungo</b>: nessuno spettacolo");
    expect(lines[199]).toBe("<b>Caccia numero 199 con un nome lungo</b>: nessuno spettacolo");
  });
});

describe("composeNoNews", () => {
  it("opens with the no-news header then lists the hunts with free seats in the zone", () => {
    expect(composeNoNews(digestEntries())).toEqual([
      "🔄 Nessuna novità\n\n<b>Dune IMAX</b>: 3 spettacoli, 16 liberi nella zona buona\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11\n<b>Tenet</b>: nessuno spettacolo",
    ]);
  });

  it("sums the zone seats and uses the singular", () => {
    const entries: DigestEntry[] = [
      {
        hunt: hunt({ name: "Solo" }),
        showings: [showing({ seats: seats({ freeInZone: 5 }) }), showing({ key: "k2", seats: seats({ freeInZone: 4 }) })],
        mutedUntil: null,
      },
      { hunt: hunt({ id: "bbbb2222", name: "Uno" }), showings: [showing({ seats: seats({ freeInZone: 0 }) })], mutedUntil: null },
    ];
    expect(composeNoNews(entries)).toEqual([
      "🔄 Nessuna novità\n\n<b>Solo</b>: 2 spettacoli, 9 liberi nella zona buona\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11\n<b>Uno</b>: 1 spettacolo, 0 liberi nella zona buona\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11",
    ]);
  });

  it("marks muted hunts with the Rome time", () => {
    const entries: DigestEntry[] = [
      { hunt: hunt({ name: "Dune IMAX" }), showings: [showing()], mutedUntil: Date.UTC(2026, 11, 15, 19, 30) },
    ];
    expect(composeNoNews(entries)).toEqual([
      "🔄 Nessuna novità\n\n<b>Dune IMAX</b>: 1 spettacolo, 8 liberi nella zona buona · silenziata fino alle 20:30\nmar 15/12 20:30 · Sala 3 · Migliori: H 9-11",
    ]);
  });
});
