import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { CONFIG_SCHEMA_VERSION, type Config, type Hunt, type Settings } from "./model.js";
import { StoreError, type createStore } from "./store.js";

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

const SLUG = /^[a-z0-9-]+$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TOKEN_FORMAT = /^\d{6,}:[A-Za-z0-9_-]{30,}$/;
const CHAT_ID = /^(-?\d+|@[A-Za-z0-9_]{5,})$/;
const ID_FORMAT = /^[a-z0-9]{8}$/;
const HALL_KEY = /^\d+-\d+$/;

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

function intIn(min: number, max: number) {
  const message = `intero da ${min} a ${max}`;
  return z.number().int(message).min(min, message).max(max, message);
}

const seatNumber = z.number().int("intero da 1").min(1, "intero da 1");
const slug = z.string().regex(SLUG, "solo minuscole, cifre e trattini");
const time = z.string().regex(TIME, "formato HH:MM");
const chatId = z.string().regex(CHAT_ID, "numero o @nome");
const percent = intIn(0, 100);

const relativeZone = z
  .strictObject({
    kind: z.literal("relative"),
    rowsFromPercent: percent,
    rowsToPercent: percent,
    centerPercent: intIn(1, 100),
  })
  .refine((zone) => zone.rowsFromPercent <= zone.rowsToPercent, "le file iniziano dopo che finiscono");

const absoluteZone = z
  .strictObject({
    kind: z.literal("absolute"),
    rows: z.array(z.string().min(1, "etichetta vuota")).min(1, "almeno una fila"),
    seatFrom: seatNumber.nullable(),
    seatTo: seatNumber.nullable(),
  })
  .refine(
    (zone) => zone.seatFrom === null || zone.seatTo === null || zone.seatFrom <= zone.seatTo,
    "il primo posto viene dopo l'ultimo",
  );

const zone = z.discriminatedUnion("kind", [relativeZone, absoluteZone]);

const movie = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("slug"), slugs: z.array(slug).min(1, "almeno un film") }),
  z.strictObject({
    kind: z.literal("title"),
    words: z
      .array(z.string().refine((word) => word.trim() !== "", "parola vuota"))
      .min(1, "almeno una parola"),
    confirmedSlugs: z.array(slug),
  }),
]);

const window = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("fixed"),
      from: z.string().refine(isRealDay, "giorno non valido (AAAA-MM-GG)"),
      to: z.string().refine(isRealDay, "giorno non valido (AAAA-MM-GG)"),
    })
    .refine((value) => !isRealDay(value.from) || !isRealDay(value.to) || value.from <= value.to, {
      path: ["to"],
      message: "precede l'inizio",
    }),
  z.strictObject({ kind: z.literal("next"), days: intIn(1, 60) }),
]);

const huntSchema = z.strictObject({
  id: z.string().regex(ID_FORMAT, "8 caratteri tra minuscole e cifre"),
  name: z.string().min(1, "da 1 a 80 caratteri").max(80, "da 1 a 80 caratteri"),
  enabled: z.boolean(),
  archivedAt: z.string().nullable(),
  theatres: z.array(slug).min(1, "almeno un cinema"),
  movie,
  formats: z.array(z.string()),
  window,
  timeFrom: time.nullable(),
  timeTo: time.nullable(),
  weekdays: z
    .array(intIn(1, 7))
    .min(1, "almeno un giorno")
    .refine((days) => new Set(days).size === days.length, "giorni ripetuti")
    .nullable(),
  languages: z.array(z.string()).nullable(),
  zone,
  hallZones: z
    .record(z.string(), absoluteZone)
    .refine((zones) => Object.keys(zones).every((key) => HALL_KEY.test(key)), "chiavi nel formato cinema-sala"),
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
  extraChatIds: z.array(chatId),
});

const settingsSchema = z.strictObject({
  telegram: z.strictObject({
    token: z.string().regex(TOKEN_FORMAT, "formato del token non valido").nullable(),
    chatId: chatId.nullable(),
  }),
  publicUrl: z.string().refine(isPublicUrl, "URL http o https senza credenziali").nullable(),
  defaultIntervalMinutes: intIn(1, 1440),
  quietHours: z.strictObject({ from: time, to: time }).nullable(),
  digest: z.strictObject({ enabled: z.boolean(), time }),
  albumSize: intIn(1, 10),
  defaultLastSeatsThreshold: intIn(0, 500),
  sellableTypes: z.array(z.string().min(1, "tipo vuoto")).min(1, "almeno un tipo"),
  defaultZone: zone,
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
        ctx.addIssue({ code: "custom", path: ["hunts", index, "id"], message: "id ripetuto" });
      }
      seen.add(item.id);
    });
  });

function italianMessage(issue: { code: string }): string {
  switch (issue.code) {
    case "invalid_type":
      return "tipo non valido";
    case "unrecognized_keys":
      return "chiave sconosciuta";
    default:
      return "valore non ammesso";
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

export type ParseResult = { ok: true; config: Config } | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateConfig(json: unknown): unknown {
  if (!isRecord(json)) return json;
  if (json["schemaVersion"] === undefined) return { ...json, schemaVersion: 1 };
  return json;
}

export function parseConfig(json: unknown): ParseResult {
  const migrated = migrateConfig(json);
  if (
    isRecord(migrated) &&
    typeof migrated["schemaVersion"] === "number" &&
    migrated["schemaVersion"] > CONFIG_SCHEMA_VERSION
  ) {
    return { ok: false, errors: ["schemaVersion: versione più recente dell'app"] };
  }
  const result = configSchema.safeParse(migrated, { error: italianMessage });
  if (result.success) return { ok: true, config: result.data };
  const errors: string[] = [];
  for (const issue of result.error.issues) {
    const base = formatPath(issue.path);
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) errors.push(`${base === "" ? key : `${base}.${key}`}: chiave sconosciuta`);
    } else {
      errors.push(`${base === "" ? "(radice)" : base}: ${issue.message}`);
    }
  }
  return { ok: false, errors };
}

export function exportConfig(config: Config, options: { includeToken: boolean }): string {
  const copy = structuredClone(config);
  if (!options.includeToken) copy.settings.telegram.token = null;
  return JSON.stringify(copy, null, 2);
}

const IMPORT_LIMIT_BYTES = 1024 * 1024;

export function importConfig(current: Config, text: string): ParseResult {
  if (Buffer.byteLength(text, "utf8") > IMPORT_LIMIT_BYTES) return { ok: false, errors: ["file oltre 1 MB"] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON non valido"] };
  }
  if (isRecord(raw) && isRecord(raw["settings"]) && isRecord(raw["settings"]["telegram"])) {
    const telegram = raw["settings"]["telegram"];
    if (telegram["token"] === undefined || telegram["token"] === null) {
      telegram["token"] = current.settings.telegram.token;
    }
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
    return "illeggibile";
  }
}

async function rejectConfig(store: Store, detail: string): Promise<never> {
  const backupName = await store.backup(CONFIG_FILE, await contentHash(store));
  throw new ConfigError(
    `${detail}. Copia di sicurezza: ${backupName ?? "non riuscita"}. Correggi ${CONFIG_FILE} o eliminalo per ripartire dalle impostazioni predefinite.`,
  );
}

export async function loadConfig(store: Store): Promise<Config> {
  let raw: unknown;
  try {
    raw = await store.readJson(CONFIG_FILE);
  } catch (error) {
    if (error instanceof StoreError && error.kind === "corrupt") return rejectConfig(store, error.message);
    throw error;
  }
  if (raw === null) {
    const config = defaultConfig();
    await saveConfig(store, config);
    return config;
  }
  const result = parseConfig(raw);
  if (result.ok) return result.config;
  return rejectConfig(store, `${CONFIG_FILE} non è valido: ${result.errors.join("; ")}`);
}
