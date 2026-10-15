import { createTtlCache } from "./cache.js";
import { ConfigError, effectiveTelegram, huntInterval, loadConfig, saveConfig } from "./config.js";
import { copy } from "./copy.js";
import { addDays, romeNow, romeToday, timeInRange } from "./dates.js";
import { escapeHtml, formatDay } from "./format.js";
import { createEventLog, type EventEntry } from "./events.js";
import { createFileHallStore } from "./hall-store.js";
import { createHistory, type HistoryPoint } from "./history.js";
import { renderHallSvg } from "./hall-svg.js";
import { createHttpClient } from "./http.js";
import { createLogger, redact, type Logger } from "./log.js";
import type { Config, Hunt, HuntEvent, HuntState, OutgoingMessage, State } from "./model.js";
import { composeDigest, composeRound, type DigestEntry } from "./notify.js";
import { svgToPng, TELEGRAM_PHOTO_WIDTH } from "./png.js";
import { diffRound } from "./round.js";
import { observeHunt, type HuntObservation, type RunnerCaches } from "./runner.js";
import { huntStateOf, loadState, saveState } from "./state.js";
import { createStore } from "./store.js";
import { createTelegram, type Telegram } from "./telegram.js";
import type { Occupancy, PerformanceInfo, Showing } from "./types.js";
import { createUciClient, UCI_API_BASE } from "./uci.js";
import { createWebticClient, WEBTIC_API_BASE } from "./webtic.js";

const MINUTE = 60_000;
const CACHE_TTL_MS = MINUTE;
const PERFORMANCE_TTL_MS = 24 * 60 * MINUTE;
const MANUAL_REFRESH_MS = 30_000;
const RETENTION_DAYS = 30;
const DRY_RUN_CHAT = "dry-run";
const VERSION_CHECK_MS = 24 * 60 * MINUTE;
const RELEASES_URL = "https://api.github.com/repos/PilaScat/cinema-watch/releases/latest";

export interface WatcherOptions {
  dataDir: string;
  version: string;
  fetch?: typeof fetch;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  logSink?: (line: string) => void;
  outbox?: (messages: OutgoingMessage[], photos: Map<string, Uint8Array>) => Promise<void>;
}

export interface RunReport {
  huntId: string;
  events: number;
  error: string | null;
  skipped: boolean;
}

interface Delivery {
  delivered: boolean;
  errors: string[];
}

export interface Watcher {
  tick(): Promise<void>;
  runNow(huntId?: string): Promise<RunReport[]>;
  mute(huntId: string, durationMs: number): Promise<void>;
  resume(huntId: string): Promise<void>;
  markBought(huntId: string): Promise<void>;
  confirmMovie(huntId: string, slug: string): Promise<void>;
  close(): Promise<void>;
  summaries(huntIds?: string[]): DigestEntry[];
  primaryChat(): string | null;
  history(key: string): Promise<HistoryPoint[]>;
  events(limit?: number): Promise<EventEntry[]>;
  config(): Config;
  state(): State;
  telegram: Telegram;
  logger: Logger;
}

function hostOf(url: string): string {
  return new URL(url).hostname;
}

function eventAllowed(event: HuntEvent, hunt: Hunt): boolean {
  const flags = hunt.notify;
  switch (event.kind) {
    case "newShowing":
      return flags.newShowings;
    case "seatsFreed":
      return flags.seatsFreed;
    case "lastSeats":
      return flags.lastSeats;
    case "cancelled":
      return flags.cancelled;
    case "moved":
      return flags.moved;
    case "movieAppeared":
      return flags.movieAppeared;
  }
}

function photoKeys(messages: OutgoingMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.kind === "photo") return [message.showingKey];
    if (message.kind === "album") return message.items.map((item) => item.showingKey);
    return [];
  });
}

export async function createWatcher(options: WatcherOptions): Promise<Watcher> {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const env = options.env ?? process.env;
  const store = createStore(options.dataDir);
  const dryRun = options.outbox !== undefined;
  let config = await loadConfig(store);
  let state = await loadState(store, now);
  let queue: Promise<unknown> = Promise.resolve();
  const knownUnknownTypes = new Set<string>();
  const telegramSettings = () => effectiveTelegram(config, env);
  const logger = createLogger({
    secrets: () => [telegramSettings().token ?? ""],
    now,
    ...(options.logSink ? { sink: options.logSink } : {}),
  });
  const http = createHttpClient({
    allowedHosts: [hostOf(UCI_API_BASE), hostOf(WEBTIC_API_BASE), "api.github.com"],
    userAgent: `cinema-watch/${options.version} (+https://github.com/PilaScat/cinema-watch)`,
    now,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const telegram = createTelegram({
    token: () => telegramSettings().token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    clock: { now, sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))) },
  });
  const clock = { now };
  const caches: RunnerCaches = {
    programming: createTtlCache<Showing[]>({ ttlMs: CACHE_TTL_MS, maxEntries: 500, clock }),
    occupancy: createTtlCache<Occupancy>({ ttlMs: CACHE_TTL_MS, maxEntries: 500, clock }),
    performance: createTtlCache<PerformanceInfo>({ ttlMs: PERFORMANCE_TTL_MS, maxEntries: 2000, clock }),
  };
  const uci = createUciClient(http);
  const webtic = createWebticClient(http, { hallStore: createFileHallStore(store), now });
  const theatreNames = createTtlCache<Record<string, string>>({ ttlMs: PERFORMANCE_TTL_MS, clock });
  const history = createHistory(store);
  const eventLog = createEventLog(store);

  function exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job);
    queue = run.catch(() => undefined);
    return run;
  }

  async function persistState(): Promise<void> {
    if (!dryRun) await saveState(store, state);
  }

  async function names(): Promise<Record<string, string>> {
    try {
      return await theatreNames.getOrLoad("all", async () =>
        Object.fromEntries((await uci.theatres()).map((theatre) => [theatre.slug, theatre.name])),
      );
    } catch {
      return {};
    }
  }

  function renderPhotos(keys: string[], observation: HuntObservation, theatres: Record<string, string>): Map<string, Uint8Array> {
    const photos = new Map<string, Uint8Array>();
    for (const key of keys) {
      const detail = observation.details.get(key);
      const observed = observation.round.showings.find((item) => item.showing.key === key);
      if (!detail || !observed) continue;
      const { showing } = observed;
      const svg = renderHallSvg(detail.hall, detail.occupancy, detail.analysis, detail.rule, {
        title: showing.movie.title,
        subtitle: copy.hall.subtitle(theatres[showing.theatreSlug] ?? showing.theatreSlug, showing.room, formatDay(showing.day), showing.time),
        labels: copy.hall.labels,
        theme: "dark",
      });
      photos.set(key, svgToPng(svg, { width: TELEGRAM_PHOTO_WIDTH }));
    }
    return photos;
  }

  function chatFor(): string | null {
    return telegramSettings().chatId ?? (dryRun ? DRY_RUN_CHAT : null);
  }

  async function send(messages: OutgoingMessage[], photos: Map<string, Uint8Array>): Promise<Delivery> {
    if (options.outbox) {
      await options.outbox(messages, photos);
      return { delivered: true, errors: [] };
    }
    const results = await telegram.deliver(messages, photos);
    const errors = results.flatMap((result) => (result.ok ? [] : [result.error ?? copy.errors.telegramUnknown]));
    return { delivered: errors.length === 0, errors };
  }

  async function notify(hunt: Hunt, events: HuntEvent[], observation: HuntObservation): Promise<Delivery> {
    if (events.length === 0) return { delivered: true, errors: [] };
    const chatId = chatFor();
    if (chatId === null) return { delivered: false, errors: [] };
    const theatres = await names();
    const publicUrl = config.settings.publicUrl;
    const messages = composeRound(events, {
      hunt,
      chats: { primary: chatId, extra: hunt.extraChatIds },
      publicUrl,
      openAsButton: publicUrl?.startsWith("https://") === true,
      albumSize: config.settings.albumSize,
      theatreNames: theatres,
    });
    return send(messages, renderPhotos(photoKeys(messages), observation, theatres));
  }

  function eventKey(event: HuntEvent): string | null {
    if (event.kind === "moved") return event.to.key;
    if (event.kind === "movieAppeared") return null;
    return event.showing.key;
  }

  function eventDetail(event: HuntEvent): string | null {
    if (event.kind === "movieAppeared") return event.movie.title;
    if (event.kind === "moved") return `${event.from.day} ${event.from.time} → ${event.to.day} ${event.to.time}`;
    return `${event.showing.day} ${event.showing.time}`;
  }

  async function log(entries: EventEntry[]): Promise<void> {
    if (!dryRun) await eventLog.add(entries);
  }

  async function recordRound(hunt: Hunt, observation: HuntObservation, events: HuntEvent[], at: number, delivery: Delivery): Promise<void> {
    if (dryRun) return;
    const historyDays = { ...state.historyDays };
    for (const { showing, analysis } of observation.round.showings) {
      if (!analysis) continue;
      await history.append(showing.key, { t: at, free: analysis.free, freeGood: analysis.freeInZone });
      historyDays[showing.key] = showing.day;
    }
    state = { ...state, historyDays };
    const newTypes = observation.unknownSeatTypes.filter((type) => !knownUnknownTypes.has(type));
    newTypes.forEach((type) => knownUnknownTypes.add(type));
    const secrets = [telegramSettings().token ?? ""];
    await log([
      {
        t: at,
        huntId: hunt.id,
        kind: observation.errors.length > 0 ? "error" : "round",
        key: null,
        detail: observation.errors[0] ?? `${observation.round.showings.length}`,
      },
      ...events.map((event) => ({ t: at, huntId: hunt.id, kind: event.kind, key: eventKey(event), detail: eventDetail(event) })),
      ...observation.hallChanged.map((key) => ({ t: at, huntId: hunt.id, kind: "hallChanged", key, detail: null })),
      ...newTypes.map((type) => ({ t: at, huntId: hunt.id, kind: "unknownSeatType", key: null, detail: type })),
      ...delivery.errors.map((error) => ({ t: at, huntId: hunt.id, kind: "telegramError", key: null, detail: redact(error, secrets) })),
    ]);
  }

  async function warnOnErrors(hunt: Hunt, previous: HuntState, errors: string[], at: number): Promise<string | null> {
    const today = romeToday(new Date(at));
    const chatId = chatFor();
    if (errors.length === 0 || previous.errorNotifiedDay === today || chatId === null) return previous.errorNotifiedDay;
    logger.warn("hunt errors", { hunt: hunt.id, errors });
    const detail = errors.length > 1 ? `${errors[0] ?? ""} (+${errors.length - 1})` : (errors[0] ?? "");
    const text = copy.errors.huntFailed(escapeHtml(hunt.name), escapeHtml(redact(detail, [telegramSettings().token ?? ""])));
    const result = await send([{ kind: "text", chatId, text, keyboard: null }], new Map());
    return result.delivered ? today : previous.errorNotifiedDay;
  }

  function nextRunFrom(hunt: Hunt, at: number): number {
    const interval = huntInterval(hunt, config.settings) * MINUTE;
    return at + Math.round(interval * (1 + random() * 0.1));
  }

  async function failRound(hunt: Hunt, previous: HuntState, at: number, error: unknown): Promise<RunReport> {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("round", { hunt: hunt.id, error: message });
    setHuntState(hunt.id, {
      ...previous,
      nextRunAt: nextRunFrom(hunt, at),
      lastRun: { at, ok: false, error: message, showings: 0 },
    });
    await persistState();
    try {
      await log([{ t: at, huntId: hunt.id, kind: "error", key: null, detail: message }]);
    } catch (logError) {
      logger.error("event log", { error: logError instanceof Error ? logError.message : String(logError) });
    }
    return { huntId: hunt.id, events: 0, error: message, skipped: false };
  }

  async function runHunt(hunt: Hunt, fresh: boolean): Promise<RunReport> {
    const at = now();
    const previous = huntStateOf(state, hunt.id);
    try {
      const observation = await observeHunt({ uci, webtic, caches }, hunt, config.settings, new Date(at), { fresh });
      const { state: next, events } = diffRound(previous, observation.round, hunt);
      const muted = previous.mutedUntil !== null && previous.mutedUntil > at;
      const allowed = muted ? [] : events.filter((event) => eventAllowed(event, hunt));
      const delivery = await notify(hunt, allowed, observation);
      await recordRound(hunt, observation, events, at, delivery);
      const errorNotifiedDay = await warnOnErrors(hunt, previous, observation.errors, at);
      const base = delivery.delivered ? next : previous;
      const lastError = observation.errors[0] ?? delivery.errors[0] ?? null;
      setHuntState(hunt.id, {
        ...base,
        errorNotifiedDay,
        nextRunAt: nextRunFrom(hunt, at),
        lastRun: { at, ok: lastError === null, error: lastError, showings: observation.round.showings.length },
      });
      await persistState();
      return { huntId: hunt.id, events: delivery.delivered ? allowed.length : 0, error: lastError, skipped: false };
    } catch (error) {
      return failRound(hunt, previous, at, error);
    }
  }

  function due(hunt: Hunt): boolean {
    if (!active(hunt)) return false;
    const nextRunAt = huntStateOf(state, hunt.id).nextRunAt;
    return nextRunAt === null || nextRunAt <= now();
  }

  function quiet(): boolean {
    const hours = config.settings.quietHours;
    if (hours === null) return false;
    return timeInRange(romeNow(new Date(now())).time, hours.from, hours.to);
  }

  function manuallyRefreshedRecently(hunt: Hunt): boolean {
    const last = huntStateOf(state, hunt.id).manualRunAt;
    return last !== null && now() - last < MANUAL_REFRESH_MS;
  }

  function setHuntState(huntId: string, hunt: HuntState): void {
    state = { ...state, hunts: { ...state.hunts, [huntId]: hunt } };
  }

  function active(hunt: Hunt): boolean {
    return hunt.enabled && hunt.archivedAt === null;
  }

  async function reloadConfig(): Promise<void> {
    try {
      config = await loadConfig(store);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      logger.error("config", { error: error.message });
    }
  }

  async function writeConfig(next: Config): Promise<void> {
    config = next;
    await saveConfig(store, config);
  }

  async function archive(huntIds: string[]): Promise<void> {
    if (huntIds.length === 0) return;
    const archivedAt = new Date(now()).toISOString();
    await writeConfig({
      ...config,
      hunts: config.hunts.map((hunt) => (huntIds.includes(hunt.id) && hunt.archivedAt === null ? { ...hunt, archivedAt } : hunt)),
    });
  }

  async function archiveFinished(): Promise<void> {
    const today = romeToday(new Date(now()));
    await archive(config.hunts.filter((hunt) => active(hunt) && hunt.window.kind === "fixed" && hunt.window.to < today).map((hunt) => hunt.id));
  }

  async function prune(): Promise<void> {
    const rome = romeNow(new Date(now()));
    const nowLocal = `${rome.day}T${rome.time}`;
    const cutoff = addDays(rome.day, -RETENTION_DAYS);
    const expired = Object.entries(state.historyDays).filter(([, day]) => day < cutoff);
    for (const [key] of expired) await history.remove(key);
    const configured = new Set(config.hunts.map((hunt) => hunt.id));
    const hunts = Object.fromEntries(
      Object.entries(state.hunts)
        .filter(([id]) => configured.has(id))
        .map(([id, hunt]) => [
          id,
          { ...hunt, showings: Object.fromEntries(Object.entries(hunt.showings).filter(([, showing]) => showing.startsAt.slice(0, 16) > nowLocal)) },
        ]),
    );
    const historyDays = Object.fromEntries(Object.entries(state.historyDays).filter(([, day]) => day >= cutoff));
    const next = { ...state, hunts, historyDays };
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    await persistState();
  }

  async function checkVersion(): Promise<void> {
    const last = state.lastVersionCheckAt;
    if (last !== null && now() - last < VERSION_CHECK_MS) return;
    let latestVersion = state.latestVersion;
    try {
      const release = await http.getJson(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } });
      const tag = (release as { tag_name?: unknown }).tag_name;
      if (typeof tag === "string") latestVersion = tag;
    } catch (error) {
      logger.warn("version check", { error: error instanceof Error ? error.message : String(error) });
    }
    state = { ...state, lastVersionCheckAt: now(), latestVersion };
    await persistState();
  }

  function digestEntries(onlyDigest = true): DigestEntry[] {
    return config.hunts
      .filter((hunt) => active(hunt) && (!onlyDigest || hunt.notify.digest))
      .map((hunt) => {
        const huntState = huntStateOf(state, hunt.id);
        return { hunt, showings: Object.values(huntState.showings), mutedUntil: huntState.mutedUntil };
      });
  }

  async function sendDigestIfDue(): Promise<void> {
    const digest = config.settings.digest;
    const rome = romeNow(new Date(now()));
    const chatId = telegramSettings().chatId;
    if (!digest.enabled || chatId === null || rome.time < digest.time || state.lastDigestDate === rome.day) return;
    const messages: OutgoingMessage[] = composeDigest(digestEntries()).map((text) => ({ kind: "text", chatId, text, keyboard: null }));
    const delivery = await send(messages, new Map());
    if (!delivery.delivered) {
      logger.warn("digest", { errors: delivery.errors });
      return;
    }
    state = { ...state, lastDigestDate: rome.day };
    await persistState();
  }

  async function tickNow(): Promise<void> {
    await reloadConfig();
    await archiveFinished();
    await prune();
    if (quiet()) return;
    await checkVersion();
    for (const hunt of config.hunts) {
      if (due(hunt)) await runHunt(hunt, false);
    }
    await sendDigestIfDue();
  }

  async function runNowLocked(huntId?: string): Promise<RunReport[]> {
    await reloadConfig();
    const targets = config.hunts.filter((hunt) => active(hunt) && (huntId === undefined || hunt.id === huntId));
    const reports: RunReport[] = [];
    for (const hunt of targets) {
      if (manuallyRefreshedRecently(hunt)) {
        reports.push({ huntId: hunt.id, events: 0, error: null, skipped: true });
        continue;
      }
      const report = await runHunt(hunt, true);
      setHuntState(hunt.id, { ...huntStateOf(state, hunt.id), manualRunAt: now() });
      await persistState();
      reports.push(report);
    }
    return reports;
  }

  async function confirmMovieLocked(huntId: string, slug: string): Promise<void> {
    await writeConfig({
      ...config,
      hunts: config.hunts.map((hunt) =>
        hunt.id === huntId && hunt.movie.kind === "title" && !hunt.movie.confirmedSlugs.includes(slug)
          ? { ...hunt, movie: { ...hunt.movie, confirmedSlugs: [...hunt.movie.confirmedSlugs, slug] } }
          : hunt,
      ),
    });
    const huntState = huntStateOf(state, huntId);
    setHuntState(huntId, { ...huntState, pendingMovieSlugs: huntState.pendingMovieSlugs.filter((pending) => pending !== slug) });
    await persistState();
  }

  async function setMute(huntId: string, mutedUntil: number | null): Promise<void> {
    setHuntState(huntId, { ...huntStateOf(state, huntId), mutedUntil });
    await persistState();
  }

  return {
    tick: () => exclusive(tickNow),
    runNow: (huntId?: string) => exclusive(() => runNowLocked(huntId)),
    mute: (huntId: string, durationMs: number) => exclusive(() => setMute(huntId, now() + durationMs)),
    resume: (huntId: string) => exclusive(() => setMute(huntId, null)),
    markBought: (huntId: string) => exclusive(() => archive([huntId])),
    confirmMovie: (huntId: string, slug: string) => exclusive(() => confirmMovieLocked(huntId, slug)),
    close: () => exclusive(() => Promise.resolve()),
    summaries: (huntIds?: string[]) =>
      digestEntries(false).filter((entry) => huntIds === undefined || huntIds.includes(entry.hunt.id)),
    primaryChat: () => telegramSettings().chatId,
    history: (key: string) => history.read(key),
    events: (limit?: number) => eventLog.list(limit),
    config: () => config,
    state: () => state,
    telegram,
    logger,
  };
}
