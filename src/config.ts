import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CONFIG_SCHEMA_VERSION, type Config, type Hunt, type Settings } from "./model.js";
import { copy } from "./copy.js";
import { LOCALES, type Copy } from "./i18n/index.js";
import { StoreError, type createStore } from "./store.js";
import { HALL_KEY, HUNT_ID, isT18Host, SLUG } from "./keys.js";

export const DEFAULT_SETTINGS: Settings = {
  telegram: { token: null, chatId: null },
  publicUrl: null,
  defaultIntervalMinutes: 5,
  quietHours: null,
  digest: { enabled: true, time: "20:00" },
  albumSize: 3,
  defaultLastSeatsThreshold: 10,
  sellableTypes: ["STANDARD"],
  defaultZone: { kind: "relative", rowsFromPercent: 40, rowsToPercent: 85, centerPercent: 60 },
  home: null,
  radiusKm: null,
  t18Hosts: [],
  language: "en",
  wallet: null,
};

export function defaultConfig(): Config {
  return { schemaVersion: CONFIG_SCHEMA_VERSION, settings: structuredClone(DEFAULT_SETTINGS), hunts: [] };
}

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function newHuntId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 8; i += 1) id += ID_ALPHABET.charAt(Math.floor(random() * ID_ALPHABET.length));
  return id;
}

export type HuntInput = Partial<Omit<Hunt, "id">> & Pick<Hunt, "name" | "theatres" | "movie">;

export function createHunt(input: HuntInput, settings: Settings, random: () => number = Math.random): Hunt {
  return {
    id: newHuntId(random),
    enabled: true,
    archivedAt: null,
    formats: [],
    window: { kind: "next", days: 30 },
    timeFrom: null,
    timeTo: null,
    weekdays: null,
    dayTimes: {},
    languages: null,
    zone: structuredClone(settings.defaultZone),
    hallZones: {},
    together: 2,
    intervalMinutes: null,
    lastSeatsThreshold: settings.defaultLastSeatsThreshold,
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
    ...input,
  };
}

export function huntInterval(hunt: Hunt, settings: Settings): number {
  return hunt.intervalMinutes ?? settings.defaultIntervalMinutes;
}

function filled(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export function effectiveTelegram(
  config: Config,
  env: NodeJS.ProcessEnv,
): { token: string | null; chatId: string | null } {
  const { token, chatId } = config.settings.telegram;
  return {
    token: filled(token) ?? filled(env["TELEGRAM_TOKEN"]),
    chatId: filled(chatId) ?? filled(env["TELEGRAM_CHAT_ID"]),
  };
}

export type TelegramSource = "config" | "env" | null;

function sourceOf(saved: string | null, fromEnv: string | undefined): TelegramSource {
  if (filled(saved) !== null) return "config";
  return filled(fromEnv) === null ? null : "env";
}

export function telegramSource(config: Config, env: NodeJS.ProcessEnv): { token: TelegramSource; chatId: TelegramSource } {
  const { token, chatId } = config.settings.telegram;
  return { token: sourceOf(token, env["TELEGRAM_TOKEN"]), chatId: sourceOf(chatId, env["TELEGRAM_CHAT_ID"]) };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_FORMAT = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const ISSUER_ID = /^\d{6,30}$/;
const SERVICE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIVATE_KEY = /^-----BEGIN PRIVATE KEY-----[A-Za-z0-9+/=\s]+-----END PRIVATE KEY-----\s*$/;
const MAX_KEY_LENGTH = 5000;
const CHAT_ID = /^(-?\d+|@[A-Za-z0-9_]{5,})$/;

function isRealDay(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

type Validation = Copy["validation"];

export interface ConfigIssue {
  path: string | null;
  message: string;
}

const SAY_SEPARATOR = "|";

function say(name: keyof Validation, ...args: number[]): string {
  return [name, ...args].join(SAY_SEPARATOR);
}

function intIn(min: number, max: number) {
  const message = say("integerFrom", min, max);
  return z.number().int(message).min(min, message).max(max, message);
}

const seatNumber = z.number().int(say("integerFromOne")).min(1, say("integerFromOne"));
const slug = z.string().regex(SLUG, say("slugFormat"));
const time = z.string().regex(TIME, say("timeFormat"));
const chatId = z.string().regex(CHAT_ID, say("chatIdFormat"));
const percent = intIn(0, 100);

const relativeZone = z
  .strictObject({
    kind: z.literal("relative"),
    rowsFromPercent: percent,
    rowsToPercent: percent,
    centerPercent: intIn(1, 100),
  })
  .refine((zone) => zone.rowsFromPercent <= zone.rowsToPercent, say("rowsStartAfterEnd"));

const absoluteZone = z
  .strictObject({
    kind: z.literal("absolute"),
    rows: z.array(z.string().min(1, say("emptyLabel"))).min(1, say("atLeastOneRow")),
    seatFrom: seatNumber.nullable(),
    seatTo: seatNumber.nullable(),
  })
  .refine(
    (zone) => zone.seatFrom === null || zone.seatTo === null || zone.seatFrom <= zone.seatTo,
    say("firstSeatAfterLast"),
  );

const zone = z.discriminatedUnion("kind", [relativeZone, absoluteZone]);

const movie = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("slug"), slugs: z.array(slug).min(1, say("atLeastOneMovie")) }),
  z.strictObject({
    kind: z.literal("title"),
    words: z
      .array(z.string().refine((word) => word.trim() !== "", say("emptyWord")))
      .min(1, say("atLeastOneWord")),
    confirmedSlugs: z.array(slug),
  }),
]);

const window = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("fixed"),
      from: z.string().refine(isRealDay, say("invalidDay")),
      to: z.string().refine(isRealDay, say("invalidDay")),
    })
    .refine((value) => !isRealDay(value.from) || !isRealDay(value.to) || value.from <= value.to, {
      path: ["to"],
      message: say("precedesStart"),
    }),
  z.strictObject({ kind: z.literal("next"), days: intIn(1, 60) }),
]);

const dayTime = z
  .strictObject({ from: time.nullable(), to: time.nullable() })
  .refine((range) => range.from !== null || range.to !== null, say("emptyDayTime"));

const MAX_THEATRES = 100;
const MAX_EXTRA_CHATS = 20;

const huntSchema = z.strictObject({
  id: z.string().regex(HUNT_ID, say("idFormat")),
  name: z.string().min(1, say("nameLength")).max(80, say("nameLength")),
  enabled: z.boolean(),
  archivedAt: z.string().nullable(),
  theatres: z.array(slug).min(1, say("atLeastOneTheatre")).max(MAX_THEATRES, say("tooManyTheatres", MAX_THEATRES)),
  movie,
  formats: z.array(z.string()),
  window,
  timeFrom: time.nullable(),
  timeTo: time.nullable(),
  weekdays: z
    .array(intIn(1, 7))
    .min(1, say("atLeastOneDay"))
    .refine((days) => new Set(days).size === days.length, say("repeatedDays"))
    .nullable(),
  dayTimes: z.partialRecord(z.enum(["1", "2", "3", "4", "5", "6", "7"]), dayTime),
  languages: z.array(z.string()).nullable(),
  zone,
  hallZones: z
    .record(z.string(), absoluteZone)
    .refine((zones) => Object.keys(zones).every((key) => HALL_KEY.test(key)), say("hallKeyFormat")),
  together: intIn(1, 10),
  intervalMinutes: intIn(1, 1440).nullable(),
  lastSeatsThreshold: intIn(0, 500),
  notify: z.strictObject({
    newShowings: z.boolean(),
    seatsFreed: z.boolean(),
    lastSeats: z.boolean(),
    cancelled: z.boolean(),
    moved: z.boolean(),
    movieAppeared: z.boolean(),
    digest: z.boolean(),
  }),
  extraChatIds: z.array(chatId).max(MAX_EXTRA_CHATS, say("tooManyChats", MAX_EXTRA_CHATS)),
}).superRefine((hunt, ctx) => {
  for (const day of Object.keys(hunt.dayTimes)) {
    if (hunt.weekdays !== null && !hunt.weekdays.includes(Number(day))) {
      ctx.addIssue({ code: "custom", path: ["dayTimes", day], message: say("dayTimeOutsideDays") });
    }
  }
});

const settingsSchema = z.strictObject({
  telegram: z.strictObject({
    token: z.string().regex(TOKEN_FORMAT, say("tokenFormat")).nullable(),
    chatId: chatId.nullable(),
  }),
  publicUrl: z.string().refine(isPublicUrl, say("publicUrlFormat")).nullable(),
  defaultIntervalMinutes: intIn(1, 1440),
  quietHours: z.strictObject({ from: time, to: time }).nullable(),
  digest: z.strictObject({ enabled: z.boolean(), time }),
  albumSize: intIn(1, 10),
  defaultLastSeatsThreshold: intIn(0, 500),
  sellableTypes: z.array(z.string().min(1, say("emptyType"))).min(1, say("atLeastOneType")),
  defaultZone: zone,
  home: z
    .strictObject({
      lat: z.number({ error: say("latitude") }).min(-90, say("latitude")).max(90, say("latitude")),
      lon: z.number({ error: say("longitude") }).min(-180, say("longitude")).max(180, say("longitude")),
    })
    .nullable(),
  radiusKm: intIn(1, 1000).nullable(),
  t18Hosts: z.array(z.string().refine(isT18Host, say("t18HostFormat"))),
  language: z.enum(LOCALES),
  wallet: z
    .strictObject({
      issuerId: z.string().regex(ISSUER_ID, say("walletIssuerId")),
      clientEmail: z.string().regex(SERVICE_EMAIL, say("walletEmail")).max(200, say("walletEmail")),
      privateKey: z.string().regex(PRIVATE_KEY, say("walletKey")).max(MAX_KEY_LENGTH, say("walletKey")),
    })
    .nullable(),
});

const configSchema = z
  .strictObject({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    settings: settingsSchema,
    hunts: z.array(huntSchema),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>();
    config.hunts.forEach((item, index) => {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: "custom", path: ["hunts", index, "id"], message: say("repeatedId") });
      }
      seen.add(item.id);
    });
  });

function defaultMessage(issue: { code: string }): string {
  switch (issue.code) {
    case "invalid_type":
      return say("invalidType");
    case "unrecognized_keys":
      return say("unknownKey");
    default:
      return say("valueNotAllowed");
  }
}

function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let result = "";
  for (const part of path) {
    if (typeof part === "number") result += `[${part}]`;
    else result += result === "" ? String(part) : `.${String(part)}`;
  }
  return result;
}

export type ParseResult = { ok: true; config: Config } | { ok: false; issues: ConfigIssue[] };

export function issueLines(issues: ConfigIssue[], validation: Validation): string[] {
  return issues.map((issue) => {
    const [name = "", ...args] = issue.message.split(SAY_SEPARATOR);
    const entry: unknown = Reflect.get(validation, name);
    const text = typeof entry === "function" ? String(Reflect.apply(entry, validation, args.map(Number))) : typeof entry === "string" ? entry : issue.message;
    return issue.path === null ? text : `${issue.path === "" ? validation.root : issue.path}: ${text}`;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toVersion2(json: Record<string, unknown>): Record<string, unknown> {
  const settings = json["settings"];
  return { ...json, schemaVersion: 2, settings: isRecord(settings) ? { home: null, radiusKm: null, ...settings } : settings };
}

function toVersion4(json: Record<string, unknown>): Record<string, unknown> {
  const hunts = json["hunts"];
  return { ...json, schemaVersion: 4, hunts: Array.isArray(hunts) ? hunts.map((hunt: unknown) => (isRecord(hunt) ? { dayTimes: {}, ...hunt } : hunt)) : hunts };
}

function toVersion3(json: Record<string, unknown>): Record<string, unknown> {
  const settings = json["settings"];
  return { ...json, schemaVersion: 3, settings: isRecord(settings) ? { t18Hosts: [], ...settings } : settings };
}

function toVersion5(json: Record<string, unknown>): Record<string, unknown> {
  const settings = json["settings"];
  return { ...json, schemaVersion: 5, settings: isRecord(settings) ? { language: "it", wallet: null, ...settings } : settings };
}

export function migrateConfig(json: unknown): unknown {
  if (!isRecord(json)) return json;
  const versioned = json["schemaVersion"] === undefined ? { ...json, schemaVersion: 1 } : json;
  const second = versioned["schemaVersion"] === 1 ? toVersion2(versioned) : versioned;
  const third = second["schemaVersion"] === 2 ? toVersion3(second) : second;
  const fourth = third["schemaVersion"] === 3 ? toVersion4(third) : third;
  return fourth["schemaVersion"] === 4 ? toVersion5(fourth) : fourth;
}

export function parseConfig(json: unknown): ParseResult {
  const migrated = migrateConfig(json);
  if (
    isRecord(migrated) &&
    typeof migrated["schemaVersion"] === "number" &&
    migrated["schemaVersion"] > CONFIG_SCHEMA_VERSION
  ) {
    return { ok: false, issues: [{ path: "schemaVersion", message: say("newerSchema") }] };
  }
  const result = configSchema.safeParse(migrated, { error: defaultMessage });
  if (result.success) return { ok: true, config: result.data };
  const issues: ConfigIssue[] = [];
  for (const issue of result.error.issues) {
    const base = formatPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) issues.push({ path: base === "" ? key : `${base}.${key}`, message: say("unknownKey") });
    } else {
      issues.push({ path: base, message: issue.message });
    }
  }
  return { ok: false, issues };
}

export function exportConfig(config: Config, options: { includeToken: boolean }): string {
  const clone = structuredClone(config);
  if (!options.includeToken) {
    clone.settings.telegram.token = null;
    clone.settings.wallet = null;
  }
  return JSON.stringify(clone, null, 2);
}

const IMPORT_LIMIT_BYTES = 1024 * 1024;

export function importConfig(current: Config, text: string): ParseResult {
  if (Buffer.byteLength(text, "utf8") > IMPORT_LIMIT_BYTES) return { ok: false, issues: [{ path: null, message: say("fileTooLarge") }] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: null, message: say("invalidJson") }] };
  }
  if (isRecord(raw) && isRecord(raw["settings"]) && isRecord(raw["settings"]["telegram"])) {
    const telegram = raw["settings"]["telegram"];
    if (telegram["token"] === undefined || telegram["token"] === null) {
      telegram["token"] = current.settings.telegram.token;
    }
  }
  if (isRecord(raw) && isRecord(raw["settings"]) && (raw["settings"]["wallet"] === undefined || raw["settings"]["wallet"] === null)) {
    raw["settings"]["wallet"] = current.settings.wallet;
  }
  return parseConfig(raw);
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

type Store = ReturnType<typeof createStore>;

const CONFIG_FILE = "config.json";

export async function saveConfig(store: Store, config: Config): Promise<void> {
  await store.writeJson(CONFIG_FILE, config, { private: true });
}

async function contentHash(store: Store): Promise<string> {
  try {
    return createHash("sha256").update(await readFile(store.path(CONFIG_FILE))).digest("hex").slice(0, 12);
  } catch {
    return copy.storage.unreadable;
  }
}

async function rejectConfig(store: Store, detail: string): Promise<never> {
  const backupName = await store.backup(CONFIG_FILE, await contentHash(store));
  throw new ConfigError(copy.storage.configRejected(detail, backupName ?? copy.storage.backupNotDone, CONFIG_FILE));
}

export async function loadConfig(store: Store, options: { createIfMissing: boolean } = { createIfMissing: true }): Promise<Config> {
  let raw: unknown;
  try {
    raw = await store.readJson(CONFIG_FILE);
  } catch (error) {
    if (error instanceof StoreError && error.kind === "corrupt") return rejectConfig(store, error.message);
    throw error;
  }
  if (raw === null) {
    if (!options.createIfMissing) throw new ConfigError(copy.storage.configMissing(CONFIG_FILE));
    const config = defaultConfig();
    await saveConfig(store, config);
    return config;
  }
  const result = parseConfig(raw);
  if (result.ok) return result.config;
  return rejectConfig(store, copy.storage.configInvalid(CONFIG_FILE, issueLines(result.issues, copy.validation).join("; ")));
}
