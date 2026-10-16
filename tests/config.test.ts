import * as realFs from "node:fs/promises";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  createHunt,
  DEFAULT_SETTINGS,
  defaultConfig,
  effectiveTelegram,
  exportConfig,
  huntInterval,
  importConfig,
  loadConfig,
  migrateConfig,
  newHuntId,
  parseConfig,
  saveConfig,
} from "../src/config.js";
import type { AbsoluteZone, Config, Hunt } from "../src/model.js";
import { createStore, type StoreFs } from "../src/store.js";
import { fakeBotToken } from "./support/tokens.js";

const TOKEN = fakeBotToken(123456789, "a");
const OTHER_TOKEN = fakeBotToken(987654321, "b");

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

function sampleHunt(random: () => number = sequence([0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6])): Hunt {
  return createHunt(
    { name: "Dune", theatres: ["roma-parco-de-medici"], movie: { kind: "slug", slugs: ["dune-3"] } },
    DEFAULT_SETTINGS,
    random,
  );
}

describe("defaults", () => {
  it("exposes the default settings", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      telegram: { token: null, chatId: null },
      publicUrl: null,
      defaultIntervalMinutes: 5,
      quietHours: null,
      digest: { enabled: true, time: "20:00" },
      albumSize: 3,
      defaultLastSeatsThreshold: 10,
      sellableTypes: ["STANDARD"],
      defaultZone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
    });
  });

  it("builds an empty default config with a fresh copy of the settings", () => {
    const config = defaultConfig();
    expect(config).toEqual({ schemaVersion: 1, settings: DEFAULT_SETTINGS, hunts: [] });
    config.settings.sellableTypes.push("X");
    expect(DEFAULT_SETTINGS.sellableTypes).toEqual(["STANDARD"]);
    expect(defaultConfig().settings.sellableTypes).toEqual(["STANDARD"]);
  });
});

describe("newHuntId", () => {
  it("builds 8 chars from the injected random", () => {
    const random = sequence([0, 1 / 36 + 0.001, 2 / 36 + 0.001, 10 / 36 + 0.001, 25 / 36 + 0.001, 26 / 36 + 0.001, 35 / 36 + 0.001, 9 / 36 + 0.001]);
    expect(newHuntId(random)).toBe("abckz09j");
  });

  it("uses Math.random by default and stays in the alphabet", () => {
    for (let i = 0; i < 50; i += 1) expect(newHuntId()).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("createHunt", () => {
  it("applies the defaults from the settings", () => {
    const settings = { ...DEFAULT_SETTINGS, defaultLastSeatsThreshold: 7, defaultZone: { kind: "relative", rowsFromPercent: 10, rowsToPercent: 90, centerPercent: 50 } as const };
    const hunt = createHunt(
      { name: "Dune", theatres: ["a-b"], movie: { kind: "slug", slugs: ["dune"] } },
      settings,
      sequence([0]),
    );
    expect(hunt).toEqual({
      id: "aaaaaaaa",
      name: "Dune",
      enabled: true,
      archivedAt: null,
      theatres: ["a-b"],
      movie: { kind: "slug", slugs: ["dune"] },
      formats: [],
      window: { kind: "next", days: 30 },
      timeFrom: null,
      timeTo: null,
      weekdays: null,
      languages: null,
      zone: { kind: "relative", rowsFromPercent: 10, rowsToPercent: 90, centerPercent: 50 },
      hallZones: {},
      together: 2,
      intervalMinutes: null,
      lastSeatsThreshold: 7,
      notify: {
        newShowings: true,
        seatsFreed: true,
        lastSeats: true,
        cancelled: true,
        moved: true,
        movieAppeared: true,
        digest: true,
      },
      extraChatIds: [],
    });
    expect(hunt.zone).not.toBe(settings.defaultZone);
  });

  it("lets the input override the defaults", () => {
    const hunt = createHunt(
      {
        name: "X",
        theatres: ["a"],
        movie: { kind: "title", words: ["dune"], confirmedSlugs: [] },
        enabled: false,
        together: 4,
        intervalMinutes: 15,
        weekdays: [6, 7],
        zone: { kind: "absolute", rows: ["F"], seatFrom: null, seatTo: null },
      },
      DEFAULT_SETTINGS,
      sequence([0.5]),
    );
    expect(hunt).toMatchObject({
      id: "ssssssss",
      enabled: false,
      together: 4,
      intervalMinutes: 15,
      weekdays: [6, 7],
      zone: { kind: "absolute", rows: ["F"], seatFrom: null, seatTo: null },
      lastSeatsThreshold: 10,
    });
  });
});

describe("huntInterval", () => {
  it("uses the hunt value, else the default", () => {
    const settings = { ...DEFAULT_SETTINGS, defaultIntervalMinutes: 9 };
    expect(huntInterval({ ...sampleHunt(), intervalMinutes: 15 }, settings)).toBe(15);
    expect(huntInterval({ ...sampleHunt(), intervalMinutes: null }, settings)).toBe(9);
  });
});

describe("effectiveTelegram", () => {
  function configWith(telegram: { token: string | null; chatId: string | null }): Config {
    const config = defaultConfig();
    config.settings.telegram = telegram;
    return config;
  }

  it("prefers the values saved in the UI", () => {
    expect(
      effectiveTelegram(configWith({ token: TOKEN, chatId: "-100123" }), {
        TELEGRAM_TOKEN: OTHER_TOKEN,
        TELEGRAM_CHAT_ID: "999",
      }),
    ).toEqual({ token: TOKEN, chatId: "-100123" });
  });

  it("falls back to the environment only for empty fields", () => {
    expect(
      effectiveTelegram(configWith({ token: TOKEN, chatId: null }), {
        TELEGRAM_TOKEN: OTHER_TOKEN,
        TELEGRAM_CHAT_ID: "999",
      }),
    ).toEqual({ token: TOKEN, chatId: "999" });
    expect(
      effectiveTelegram(configWith({ token: null, chatId: null }), { TELEGRAM_TOKEN: OTHER_TOKEN }),
    ).toEqual({ token: OTHER_TOKEN, chatId: null });
  });

  it("treats blank values as missing and returns nulls when nothing is set", () => {
    expect(
      effectiveTelegram(configWith({ token: "", chatId: " " }), { TELEGRAM_TOKEN: "  ", TELEGRAM_CHAT_ID: "" }),
    ).toEqual({ token: null, chatId: null });
  });
});

function fullConfig(): Config {
  const config = defaultConfig();
  config.settings = {
    telegram: { token: TOKEN, chatId: "-100123" },
    publicUrl: "https://cinema.example.com:8080/app",
    defaultIntervalMinutes: 10,
    quietHours: { from: "23:00", to: "07:30" },
    digest: { enabled: false, time: "09:15" },
    albumSize: 5,
    defaultLastSeatsThreshold: 20,
    sellableTypes: ["STANDARD", "PREMIUM"],
    defaultZone: { kind: "absolute", rows: ["E", "F"], seatFrom: 3, seatTo: null },
  };
  config.hunts = [
    {
      ...sampleHunt(),
      window: { kind: "fixed", from: "2026-11-01", to: "2026-11-30" },
      timeFrom: "18:00",
      timeTo: "23:59",
      weekdays: [5, 6, 7],
      languages: ["it"],
      formats: ["IMAX"],
      hallZones: { "5116-12": { kind: "absolute", rows: ["H"], seatFrom: 2, seatTo: 9 } },
      extraChatIds: ["-100456", "@my_channel"],
      intervalMinutes: 1440,
      lastSeatsThreshold: 0,
      archivedAt: "2026-10-01T10:00:00.000Z",
    },
    {
      ...sampleHunt(sequence([0.8])),
      movie: { kind: "title", words: ["dune", "parte"], confirmedSlugs: ["dune-3"] },
      zone: { kind: "relative", rowsFromPercent: 0, rowsToPercent: 100, centerPercent: 1 },
      window: { kind: "next", days: 60 },
    },
  ];
  return config;
}

type Mutator = (config: Config) => void;

function parseMutated(mutate: Mutator): string[] {
  const config = structuredClone(fullConfig());
  mutate(config);
  const result = parseConfig(config);
  return result.ok ? [] : result.errors;
}

function hunt(config: Config, index = 0): Hunt {
  const found = config.hunts[index];
  if (found === undefined) throw new Error("missing hunt");
  return found;
}

function loose(value: object): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("parseConfig valid", () => {
  it("accepts the default config", () => {
    const config = defaultConfig();
    expect(parseConfig(config)).toEqual({ ok: true, config });
  });

  it("accepts a fully populated config at the boundaries and returns it unchanged", () => {
    const config = fullConfig();
    expect(parseConfig(structuredClone(config))).toEqual({ ok: true, config });
  });
});

describe("parseConfig invalid", () => {
  const absoluteZone: AbsoluteZone = { kind: "absolute", rows: ["A"], seatFrom: null, seatTo: null };
  const relative = (rowsFromPercent: number, rowsToPercent: number, centerPercent: number) =>
    ({ kind: "relative", rowsFromPercent, rowsToPercent, centerPercent }) as const;

  const cases: Array<[string, string, Mutator]> = [
    ["id uppercase", "hunts[0].id", (c) => void (hunt(c).id = "ABCDEFGH")],
    ["id short", "hunts[0].id", (c) => void (hunt(c).id = "abc")],
    ["duplicate ids", "hunts[1].id", (c) => void (hunt(c, 1).id = hunt(c, 0).id)],
    ["empty name", "hunts[0].name", (c) => void (hunt(c).name = "")],
    ["long name", "hunts[0].name", (c) => void (hunt(c).name = "x".repeat(81))],
    ["no theatres", "hunts[0].theatres", (c) => void (hunt(c).theatres = [])],
    ["bad theatre slug", "hunts[0].theatres[1]", (c) => void (hunt(c).theatres = ["ok", "Bad Slug"])],
    ["no movie slugs", "hunts[0].movie.slugs", (c) => void (hunt(c).movie = { kind: "slug", slugs: [] })],
    ["bad movie slug", "hunts[0].movie.slugs[0]", (c) => void (hunt(c).movie = { kind: "slug", slugs: ["A_B"] })],
    ["no title words", "hunts[1].movie.words", (c) => void (hunt(c, 1).movie = { kind: "title", words: [], confirmedSlugs: [] })],
    ["blank title word", "hunts[1].movie.words[0]", (c) => void (hunt(c, 1).movie = { kind: "title", words: [" "], confirmedSlugs: [] })],
    ["bad confirmed slug", "hunts[1].movie.confirmedSlugs[0]", (c) => void (hunt(c, 1).movie = { kind: "title", words: ["a"], confirmedSlugs: ["No Good"] })],
    ["unknown movie kind", "hunts[0].movie.kind", (c) => void (hunt(c).movie = { kind: "other" } as never)],
    ["fixed day impossible", "hunts[0].window.from", (c) => void (hunt(c).window = { kind: "fixed", from: "2026-02-30", to: "2026-03-01" })],
    ["fixed day format", "hunts[0].window.to", (c) => void (hunt(c).window = { kind: "fixed", from: "2026-02-01", to: "2026-2-1" })],
    ["fixed from after to", "hunts[0].window.to", (c) => void (hunt(c).window = { kind: "fixed", from: "2026-03-02", to: "2026-03-01" })],
    ["next days zero", "hunts[1].window.days", (c) => void (hunt(c, 1).window = { kind: "next", days: 0 })],
    ["next days 61", "hunts[1].window.days", (c) => void (hunt(c, 1).window = { kind: "next", days: 61 })],
    ["next days fractional", "hunts[1].window.days", (c) => void (hunt(c, 1).window = { kind: "next", days: 1.5 })],
    ["timeFrom 25:00", "hunts[0].timeFrom", (c) => void (hunt(c).timeFrom = "25:00")],
    ["timeTo no zero pad", "hunts[0].timeTo", (c) => void (hunt(c).timeTo = "9:00")],
    ["empty weekdays", "hunts[0].weekdays", (c) => void (hunt(c).weekdays = [])],
    ["weekday 0", "hunts[0].weekdays[0]", (c) => void (hunt(c).weekdays = [0])],
    ["weekday 8", "hunts[0].weekdays[0]", (c) => void (hunt(c).weekdays = [8])],
    ["duplicate weekdays", "hunts[0].weekdays", (c) => void (hunt(c).weekdays = [1, 1])],
    ["relative from after to", "hunts[1].zone", (c) => void (hunt(c, 1).zone = relative(60, 50, 50))],
    ["relative above 100", "hunts[1].zone.rowsToPercent", (c) => void (hunt(c, 1).zone = relative(0, 101, 50))],
    ["relative negative", "hunts[1].zone.rowsFromPercent", (c) => void (hunt(c, 1).zone = relative(-1, 50, 50))],
    ["center zero", "hunts[1].zone.centerPercent", (c) => void (hunt(c, 1).zone = relative(0, 50, 0))],
    ["absolute no rows", "hunts[0].zone.rows", (c) => void (hunt(c).zone = { ...absoluteZone, rows: [] })],
    ["absolute seats inverted", "hunts[0].zone", (c) => void (hunt(c).zone = { ...absoluteZone, seatFrom: 5, seatTo: 3 })],
    ["absolute seat zero", "hunts[0].zone.seatFrom", (c) => void (hunt(c).zone = { ...absoluteZone, seatFrom: 0 })],
    ["hallZones bad key", "hunts[0].hallZones", (c) => void (hunt(c).hallZones = { abc: absoluteZone })],
    ["hallZones relative value", "hunts[0].hallZones.1-2.kind", (c) => void (hunt(c).hallZones = { "1-2": relative(0, 1, 1) as never })],
    ["together 0", "hunts[0].together", (c) => void (hunt(c).together = 0)],
    ["together 11", "hunts[0].together", (c) => void (hunt(c).together = 11)],
    ["interval 0", "hunts[0].intervalMinutes", (c) => void (hunt(c).intervalMinutes = 0)],
    ["interval 1441", "hunts[0].intervalMinutes", (c) => void (hunt(c).intervalMinutes = 1441)],
    ["threshold -1", "hunts[0].lastSeatsThreshold", (c) => void (hunt(c).lastSeatsThreshold = -1)],
    ["threshold 501", "hunts[0].lastSeatsThreshold", (c) => void (hunt(c).lastSeatsThreshold = 501)],
    ["chat id text", "hunts[0].extraChatIds[0]", (c) => void (hunt(c).extraChatIds = ["abc"])],
    ["chat handle short", "hunts[0].extraChatIds[0]", (c) => void (hunt(c).extraChatIds = ["@abc"])],
    ["notify flag not boolean", "hunts[0].notify.digest", (c) => void (hunt(c).notify.digest = "yes" as never)],
    ["archivedAt number", "hunts[0].archivedAt", (c) => void (hunt(c).archivedAt = 5 as never)],
    ["token malformed", "settings.telegram.token", (c) => void (c.settings.telegram.token = "abc")],
    ["chat id malformed", "settings.telegram.chatId", (c) => void (c.settings.telegram.chatId = "chat")],
    ["publicUrl ftp", "settings.publicUrl", (c) => void (c.settings.publicUrl = "ftp://x.com")],
    ["publicUrl credentials", "settings.publicUrl", (c) => void (c.settings.publicUrl = "https://u:p@x.com")],
    ["publicUrl garbage", "settings.publicUrl", (c) => void (c.settings.publicUrl = "not a url")],
    ["default interval 0", "settings.defaultIntervalMinutes", (c) => void (c.settings.defaultIntervalMinutes = 0)],
    ["default interval 1441", "settings.defaultIntervalMinutes", (c) => void (c.settings.defaultIntervalMinutes = 1441)],
    ["quiet hours bad", "settings.quietHours.to", (c) => void (c.settings.quietHours = { from: "22:00", to: "7am" })],
    ["digest time bad", "settings.digest.time", (c) => void (c.settings.digest.time = "24:00")],
    ["album 0", "settings.albumSize", (c) => void (c.settings.albumSize = 0)],
    ["album 11", "settings.albumSize", (c) => void (c.settings.albumSize = 11)],
    ["threshold default 501", "settings.defaultLastSeatsThreshold", (c) => void (c.settings.defaultLastSeatsThreshold = 501)],
    ["no sellable types", "settings.sellableTypes", (c) => void (c.settings.sellableTypes = [])],
    ["default zone invalid", "settings.defaultZone.centerPercent", (c) => void (c.settings.defaultZone = relative(0, 1, 101))],
    ["unknown root key", "extra", (c) => void (loose(c)["extra"] = 1)],
    ["unknown settings key", "settings.extra", (c) => void (loose(c.settings)["extra"] = 1)],
    ["unknown hunt key", "hunts[0].extra", (c) => void (loose(hunt(c))["extra"] = 1)],
    ["unknown zone key", "hunts[0].zone.extra", (c) => void (loose(hunt(c).zone)["extra"] = 1)],
  ];

  it.each(cases)("%s reports %s", (_name, path, mutate) => {
    const errors = parseMutated(mutate);
    expect(errors.some((error) => error.startsWith(`${path}:`))).toBe(true);
  });

  it("writes short Italian messages", () => {
    expect(parseMutated((c) => void (hunt(c).name = ""))).toEqual(["hunts[0].name: da 1 a 80 caratteri"]);
    expect(parseMutated((c) => void (loose(c.settings)["extra"] = 1))).toEqual(["settings.extra: chiave sconosciuta"]);
    expect(parseMutated((c) => void (hunt(c).together = "2" as never))).toEqual(["hunts[0].together: tipo non valido"]);
  });

  it("collects several errors at once", () => {
    const errors = parseMutated((c) => {
      hunt(c).name = "";
      c.settings.albumSize = 0;
    });
    expect(errors).toHaveLength(2);
  });

  it("rejects non objects with a root error", () => {
    expect(parseConfig(null)).toEqual({ ok: false, errors: ["(radice): tipo non valido"] });
    expect(parseConfig("x")).toMatchObject({ ok: false });
  });
});

describe("migration and versions", () => {
  it("treats a missing schemaVersion as version 1", () => {
    const input = { settings: DEFAULT_SETTINGS, hunts: [] };
    expect(migrateConfig(input)).toEqual({ schemaVersion: 1, settings: DEFAULT_SETTINGS, hunts: [] });
    expect(input).not.toHaveProperty("schemaVersion");
  });

  it("leaves current versions and non objects alone", () => {
    const config = defaultConfig();
    expect(migrateConfig(config)).toEqual(config);
    expect(migrateConfig(null)).toBeNull();
    expect(migrateConfig([1])).toEqual([1]);
  });

  it("parses a config saved without schemaVersion", () => {
    const result = parseConfig({ settings: DEFAULT_SETTINGS, hunts: [] });
    expect(result).toEqual({ ok: true, config: defaultConfig() });
  });

  it("rejects a version newer than the app", () => {
    expect(parseConfig({ ...defaultConfig(), schemaVersion: 2 })).toEqual({
      ok: false,
      errors: ["schemaVersion: versione più recente dell'app"],
    });
  });

  it("rejects a non numeric version as a type error", () => {
    expect(parseConfig({ ...defaultConfig(), schemaVersion: "1" })).toEqual({
      ok: false,
      errors: ["schemaVersion: valore non ammesso"],
    });
  });
});

describe("exportConfig and importConfig", () => {
  const LF = String.fromCharCode(10);

  function withToken(token: string | null): Config {
    const config = fullConfig();
    config.settings.telegram.token = token;
    return config;
  }

  it("exports indented json without the token by default choice", () => {
    const config = withToken(TOKEN);
    const text = exportConfig(config, { includeToken: false });
    expect(text.split(LF)[1]).toBe('  "schemaVersion": 1,');
    expect(text).not.toContain(TOKEN);
    const parsed = JSON.parse(text) as Config;
    expect(parsed.settings.telegram).toEqual({ token: null, chatId: "-100123" });
    expect(parsed.hunts).toEqual(config.hunts);
    expect(config.settings.telegram.token).toBe(TOKEN);
  });

  it("exports the token when asked", () => {
    const text = exportConfig(withToken(TOKEN), { includeToken: true });
    expect((JSON.parse(text) as Config).settings.telegram.token).toBe(TOKEN);
  });

  it("imports an export and keeps the current token when the file has none", () => {
    const current = withToken(OTHER_TOKEN);
    const text = exportConfig(withToken(TOKEN), { includeToken: false });
    const result = importConfig(current, text);
    expect(result).toEqual({ ok: true, config: withToken(OTHER_TOKEN) });
  });

  it("keeps the current token when the token key is absent", () => {
    const raw = JSON.parse(exportConfig(fullConfig(), { includeToken: false })) as Config;
    delete (raw.settings.telegram as { token?: string | null }).token;
    const result = importConfig(withToken(OTHER_TOKEN), JSON.stringify(raw));
    expect(result.ok && result.config.settings.telegram.token).toBe(OTHER_TOKEN);
  });

  it("takes the imported token when present", () => {
    const result = importConfig(withToken(OTHER_TOKEN), exportConfig(withToken(TOKEN), { includeToken: true }));
    expect(result.ok && result.config.settings.telegram.token).toBe(TOKEN);
  });

  it("rejects unknown keys", () => {
    const raw = JSON.parse(exportConfig(fullConfig(), { includeToken: true })) as Record<string, unknown>;
    raw["surprise"] = true;
    expect(importConfig(defaultConfig(), JSON.stringify(raw))).toEqual({
      ok: false,
      errors: ["surprise: chiave sconosciuta"],
    });
  });

  it("rejects invalid json", () => {
    expect(importConfig(defaultConfig(), "{nope")).toEqual({ ok: false, errors: ["JSON non valido"] });
  });

  it("rejects files over 1 MB", () => {
    const padding = " ".repeat(1024 * 1024);
    const result = importConfig(defaultConfig(), exportConfig(defaultConfig(), { includeToken: true }) + padding);
    expect(result).toEqual({ ok: false, errors: ["file oltre 1 MB"] });
  });

  it("accepts a file of exactly 1 MB", () => {
    const text = exportConfig(defaultConfig(), { includeToken: true });
    const padded = text + " ".repeat(1024 * 1024 - Buffer.byteLength(text));
    expect(importConfig(defaultConfig(), padded).ok).toBe(true);
  });

  it("rejects duplicate ids and a future version", () => {
    const config = fullConfig();
    hunt(config, 1).id = hunt(config, 0).id;
    expect(importConfig(defaultConfig(), JSON.stringify(config))).toEqual({
      ok: false,
      errors: ["hunts[1].id: id ripetuto"],
    });
    const future = { ...defaultConfig(), schemaVersion: 9 };
    expect(importConfig(defaultConfig(), JSON.stringify(future)).ok).toBe(false);
  });

  it("rejects a non object document", () => {
    expect(importConfig(defaultConfig(), "[1]")).toMatchObject({ ok: false });
    expect(importConfig(defaultConfig(), "null")).toMatchObject({ ok: false });
  });
});

describe("loadConfig and saveConfig", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cw-config-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates and saves the default config in an empty folder", async () => {
    const config = await loadConfig(createStore(dir));
    expect(config).toEqual(defaultConfig());
    expect(JSON.parse(await readFile(join(dir, "config.json"), "utf8"))).toEqual(defaultConfig());
  });

  it.skipIf(process.platform === "win32")("saves the config with mode 0600", async () => {
    await saveConfig(createStore(dir), defaultConfig());
    expect((await stat(join(dir, "config.json"))).mode & 0o777).toBe(0o600);
  });

  it("round-trips a saved config", async () => {
    const store = createStore(dir);
    await saveConfig(store, fullConfig());
    expect(await loadConfig(store)).toEqual(fullConfig());
  });

  it("loads a file written before schemaVersion existed", async () => {
    await writeFile(join(dir, "config.json"), JSON.stringify({ settings: DEFAULT_SETTINGS, hunts: [] }));
    expect(await loadConfig(createStore(dir))).toEqual(defaultConfig());
  });

  it("backs up a corrupt file under the hash of its content and throws a clear ConfigError", async () => {
    await writeFile(join(dir, "config.json"), "{broken");
    const failure = loadConfig(createStore(dir));
    await expect(failure).rejects.toBeInstanceOf(ConfigError);
    await expect(failure).rejects.toThrow("config.json.bak-be302461cda2");
    await expect(failure).rejects.toThrow("non è JSON valido");
    expect((await readdir(dir)).sort()).toEqual(["config.json", "config.json.bak-be302461cda2"]);
    expect(await readFile(join(dir, "config.json.bak-be302461cda2"), "utf8")).toBe("{broken");
  });

  it("backs up an invalid file and reports the field errors", async () => {
    const config = defaultConfig();
    config.settings.albumSize = 0;
    await writeFile(join(dir, "config.json"), JSON.stringify(config));
    const failure = loadConfig(createStore(dir));
    await expect(failure).rejects.toThrow("settings.albumSize: intero da 1 a 10");
    expect((await readdir(dir)).filter((name) => /^config\.json\.bak-[0-9a-f]{12}$/.test(name))).toHaveLength(1);
  });

  it("keeps a single copy when the same broken file is loaded again and again", async () => {
    await writeFile(join(dir, "config.json"), "x");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(loadConfig(createStore(dir))).rejects.toBeInstanceOf(ConfigError);
    }
    expect((await readdir(dir)).filter((name) => name.startsWith("config.json.bak-"))).toHaveLength(1);
  });

  it("passes unexpected store failures through", async () => {
    const fs = { ...realFs, readFile: () => Promise.reject(new Error("disk boom")) } as unknown as StoreFs;
    await expect(loadConfig(createStore(dir, { fs }))).rejects.toMatchObject({ name: "StoreError", kind: "io" });
  });

  it("names its errors", () => {
    expect(new ConfigError("x").name).toBe("ConfigError");
  });
});
