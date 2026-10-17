import { createTtlCache } from "./cache.js";
import {
  ConfigError,
  effectiveTelegram,
  exportConfig,
  importConfig,
  loadConfig,
  parseConfig,
  saveConfig,
  telegramSource,
  type ParseResult,
  type TelegramSource,
} from "./config.js";
import { copy } from "./copy.js";
import { romeNow, romeToday } from "./dates.js";
import { escapeHtml } from "./format.js";
import { createEventLog, type EventEntry } from "./events.js";
import { createFileHallStore } from "./hall-store.js";
import { createHistory, type HistoryPoint } from "./history.js";
import { createHttpClient } from "./http.js";
import { HUNT_ID, showingKey } from "./keys.js";
import { createLogger, redact, type Logger } from "./log.js";
import { expiredHistoryKeys, prunedState, releaseTag, versionCheckDue } from "./maintenance.js";
import type { Config, Hunt, HuntEvent, HuntState, OutgoingMessage, SentResult, State } from "./model.js";
import { composeDigest, composeRound, type DigestEntry } from "./notify.js";
import { photoKeys, renderPhotos } from "./photos.js";
import { diffRound, snapshotOf } from "./round.js";
import { roundEntries } from "./round-log.js";
import { observeHunt, zoneFor, type HuntObservation, type RunnerCaches, type SeatDetail } from "./runner.js";
import { analyzeSeats } from "./seats.js";
import { huntStateOf, loadState, saveState } from "./state.js";
import { createStore } from "./store.js";
import { createTelegram, type Telegram } from "./telegram.js";
import type { CatalogMovie, IsoDay, MovieTheatre, Occupancy, PerformanceInfo, Showing, Theatre } from "./types.js";
import { createUciClient, UCI_API_BASE } from "./uci.js";
import {
  deliveryOf,
  digestDue,
  digestEntries,
  errorWarningDue,
  eventAllowed,
  finishedHuntIds,
  hallsToReconfirm,
  isActive,
  isDue,
  isMuted,
  isQuiet,
  nextRunAt,
  refreshedRecently,
  urlButtonsAccepted,
  type Delivery,
} from "./watcher-rules.js";
import { createWebticClient, WEBTIC_API_BASE } from "./webtic.js";

const MINUTE = 60_000;
const CACHE_TTL_MS = MINUTE;
const PERFORMANCE_TTL_MS = 24 * 60 * MINUTE;
const DRY_RUN_CHAT = "dry-run";
const PROGRAMMING_TTL_MS = 10 * MINUTE;
const CATALOG_TTL_MS = 60 * MINUTE;
const DEFAULT_TOGETHER = 2;
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

export interface HallView extends SeatDetail {
  performance: PerformanceInfo;
}

export interface WatcherServices {
  theatres(): Promise<Theatre[]>;
  programming(theatreSlug: string): Promise<Map<IsoDay, Showing[]>>;
  movieTheatres(movieSlug: string): Promise<MovieTheatre[]>;
  movies(): Promise<CatalogMovie[]>;
  hall(localId: number, performanceId: number, huntId?: string): Promise<HallView>;
}

export interface Watcher {
  tick(): Promise<void>;
  saveConfig(next: Config): Promise<ParseResult>;
  importConfig(text: string): Promise<ParseResult>;
  exportConfig(includeToken: boolean): string;
  sendTest(): Promise<SentResult>;
  sendSnapshot(huntId: string): Promise<boolean>;
  services: WatcherServices;
  runNow(huntId?: string): Promise<RunReport[]>;
  mute(huntId: string, durationMs: number): Promise<void>;
  resume(huntId: string): Promise<void>;
  markBought(huntId: string): Promise<void>;
  restore(huntId: string): Promise<void>;
  confirmMovie(huntId: string, slug: string): Promise<void>;
  confirmHallZone(huntId: string, hallKey: string): Promise<void>;
  close(): Promise<void>;
  summaries(huntIds?: string[]): DigestEntry[];
  primaryChat(): string | null;
  botToken(): string | null;
  telegramConfigured(): boolean;
  huntById(id: string): Hunt | null;
  telegramSource(): { token: TelegramSource; chatId: TelegramSource };
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const secrets = () => [telegramSettings().token ?? ""];
  const logger = createLogger({
    secrets,
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
  const theatreList = createTtlCache<Theatre[]>({ ttlMs: PERFORMANCE_TTL_MS, clock });
  const fullProgramming = createTtlCache<Map<IsoDay, Showing[]>>({ ttlMs: PROGRAMMING_TTL_MS, maxEntries: 3, clock });
  const catalog = createTtlCache<CatalogMovie[]>({ ttlMs: CATALOG_TTL_MS, clock });
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

  function setHuntState(huntId: string, hunt: HuntState): void {
    state = { ...state, hunts: { ...state.hunts, [huntId]: hunt } };
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

  function huntById(id: string): Hunt | null {
    if (!HUNT_ID.test(id)) return null;
    return config.hunts.find((hunt) => hunt.id === id) ?? null;
  }

  function theatres(): Promise<Theatre[]> {
    return theatreList.getOrLoad("all", () => uci.theatres());
  }

  async function theatreNames(): Promise<Record<string, string>> {
    try {
      return Object.fromEntries((await theatres()).map((theatre) => [theatre.slug, theatre.name]));
    } catch {
      return {};
    }
  }

  async function hallView(localId: number, performanceId: number, huntId?: string): Promise<HallView> {
    const key = showingKey(localId, performanceId);
    const performance = await caches.performance.getOrLoad(key, () => webtic.performance(localId, performanceId));
    const occupancy = await caches.occupancy.getOrLoad(key, () => webtic.occupancy(localId, performanceId));
    const { hall } = await webtic.hall(localId, performance.screenId, occupancy);
    const hunt = huntId === undefined ? null : huntById(huntId);
    const zone = hunt ? zoneFor(hunt, localId, performance.screenId) : config.settings.defaultZone;
    const rule = { zone, together: hunt?.together ?? DEFAULT_TOGETHER, sellableTypes: config.settings.sellableTypes };
    return { performance, hall, occupancy, rule, analysis: analyzeSeats(hall, occupancy, rule) };
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
    return deliveryOf(
      messages.map((message) => message.chatId),
      results,
      chatFor(),
      copy.errors.telegramUnknown,
    );
  }

  async function notify(hunt: Hunt, events: HuntEvent[], observation: HuntObservation): Promise<Delivery> {
    if (events.length === 0) return { delivered: true, errors: [] };
    const chatId = chatFor();
    if (chatId === null) return { delivered: false, errors: [] };
    const names = await theatreNames();
    const publicUrl = config.settings.publicUrl;
    const messages = composeRound(events, {
      hunt,
      chats: { primary: chatId, extra: hunt.extraChatIds },
      publicUrl,
      openAsButton: urlButtonsAccepted(publicUrl, state.publicUrlCheck),
      albumSize: config.settings.albumSize,
      theatreNames: names,
    });
    return send(messages, renderPhotos(photoKeys(messages), observation, names));
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
    const newSeatTypes = observation.unknownSeatTypes.filter((type) => !knownUnknownTypes.has(type));
    newSeatTypes.forEach((type) => knownUnknownTypes.add(type));
    await log(roundEntries({ hunt, observation, events, at, deliveryErrors: delivery.errors, newSeatTypes, secrets: secrets() }));
  }

  async function warnOnErrors(hunt: Hunt, previous: HuntState, errors: string[], at: number): Promise<string | null> {
    const chatId = chatFor();
    if (chatId === null || !errorWarningDue(previous, errors, at, chatId)) return previous.errorNotifiedDay;
    logger.warn("hunt errors", { hunt: hunt.id, errors });
    const detail = errors.length > 1 ? `${errors[0] ?? ""} (+${errors.length - 1})` : (errors[0] ?? "");
    const text = copy.errors.huntFailed(escapeHtml(hunt.name), escapeHtml(redact(detail, secrets())));
    const result = await send([{ kind: "text", chatId, text, keyboard: null }], new Map());
    return result.delivered ? romeToday(new Date(at)) : previous.errorNotifiedDay;
  }

  async function failRound(hunt: Hunt, previous: HuntState, at: number, error: unknown): Promise<RunReport> {
    const message = redact(errorText(error), secrets());
    logger.error("round", { hunt: hunt.id, error: message });
    setHuntState(hunt.id, {
      ...previous,
      nextRunAt: nextRunAt(hunt, config.settings, at, random()),
      lastRun: { at, ok: false, error: message, showings: 0 },
    });
    await persistState();
    try {
      await log([{ t: at, huntId: hunt.id, kind: "error", key: null, detail: message }]);
    } catch (logError) {
      logger.error("event log", { error: errorText(logError) });
    }
    return { huntId: hunt.id, events: 0, error: message, skipped: false };
  }

  async function runHunt(hunt: Hunt, fresh: boolean): Promise<RunReport> {
    const at = now();
    const previous = huntStateOf(state, hunt.id);
    try {
      const observation = await observeHunt({ uci, webtic, caches }, hunt, config.settings, new Date(at), { fresh });
      const { state: next, events } = diffRound(previous, observation.round, hunt);
      const allowed = isMuted(previous, at) ? [] : events.filter((event) => eventAllowed(event, hunt));
      const delivery = await notify(hunt, allowed, observation);
      await recordRound(hunt, observation, events, at, delivery);
      const errorNotifiedDay = await warnOnErrors(hunt, previous, observation.errors, at);
      const base = delivery.delivered ? next : previous;
      const firstError = observation.errors[0] ?? delivery.errors[0];
      const lastError = firstError === undefined ? null : redact(firstError, secrets());
      setHuntState(hunt.id, {
        ...base,
        errorNotifiedDay,
        hallsToReconfirm: hallsToReconfirm(hunt, previous, observation),
        nextRunAt: nextRunAt(hunt, config.settings, at, random()),
        lastRun: { at, ok: lastError === null, error: lastError, showings: observation.round.showings.length },
      });
      await persistState();
      return { huntId: hunt.id, events: delivery.delivered ? allowed.length : 0, error: lastError, skipped: false };
    } catch (error) {
      return failRound(hunt, previous, at, error);
    }
  }

  async function archive(huntIds: string[]): Promise<void> {
    if (huntIds.length === 0) return;
    const archivedAt = new Date(now()).toISOString();
    await writeConfig({
      ...config,
      hunts: config.hunts.map((hunt) => (huntIds.includes(hunt.id) && hunt.archivedAt === null ? { ...hunt, archivedAt } : hunt)),
    });
  }

  async function prune(): Promise<void> {
    const at = now();
    for (const key of expiredHistoryKeys(state, at)) await history.remove(key);
    const next = prunedState(state, config, at);
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    await persistState();
  }

  async function checkVersion(): Promise<void> {
    if (!versionCheckDue(state, now())) return;
    let latestVersion = state.latestVersion;
    try {
      const tag = releaseTag(await http.getJson(RELEASES_URL, { headers: { Accept: "application/vnd.github+json" } }));
      if (tag === null) logger.warn("version check", { error: "release without tag" });
      latestVersion = tag ?? latestVersion;
    } catch (error) {
      logger.warn("version check", { error: errorText(error) });
    }
    state = { ...state, lastVersionCheckAt: now(), latestVersion };
    await persistState();
  }

  async function sendDigestIfDue(): Promise<void> {
    const { chatId, token } = telegramSettings();
    const at = now();
    if (chatId === null || !digestDue(config, state, at, { chatId, canSend: token !== null || dryRun })) return;
    const day = romeNow(new Date(at)).day;
    const messages: OutgoingMessage[] = composeDigest(digestEntries(config, state, true)).map((text) => ({ kind: "text", chatId, text, keyboard: null }));
    const delivery = await send(messages, new Map());
    if (!delivery.delivered) {
      logger.warn("digest", { errors: delivery.errors });
      return;
    }
    state = { ...state, lastDigestDate: day };
    await persistState();
  }

  async function tickNow(): Promise<void> {
    await reloadConfig();
    await archive(finishedHuntIds(config, now()));
    await prune();
    if (isQuiet(config.settings, now())) return;
    await checkVersion();
    for (const hunt of config.hunts) {
      if (isDue(hunt, state, now())) await runHunt(hunt, false);
    }
    await sendDigestIfDue();
  }

  async function runNowLocked(huntId?: string): Promise<RunReport[]> {
    await reloadConfig();
    const targets = config.hunts.filter((hunt) => isActive(hunt) && (huntId === undefined || hunt.id === huntId));
    const reports: RunReport[] = [];
    for (const hunt of targets) {
      if (refreshedRecently(huntStateOf(state, hunt.id), now())) {
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

  async function saveValidated(next: unknown): Promise<ParseResult> {
    const result = parseConfig(next);
    if (result.ok) await writeConfig(result.config);
    return result;
  }

  async function importLocked(text: string): Promise<ParseResult> {
    const result = importConfig(config, text);
    if (result.ok) await writeConfig(result.config);
    return result;
  }

  async function rememberUrlCheck(url: string, accepted: boolean): Promise<void> {
    state = { ...state, publicUrlCheck: { url, accepted } };
    await persistState();
  }

  async function sendTestLocked(): Promise<SentResult> {
    const chatId = telegramSettings().chatId;
    if (chatId === null) return { ok: false, messageIds: [], error: copy.errors.telegramNotConfigured };
    const text = `${copy.telegram.test.header}\n${copy.telegram.test.body}`;
    const publicUrl = config.settings.publicUrl;
    if (publicUrl === null) return telegram.sendMessage(chatId, text);
    const openApp = copy.telegram.buttons.openApp;
    const withButton = await telegram.sendMessage(chatId, text, [[{ text: openApp, url: publicUrl }]], false);
    if (withButton.ok) {
      await rememberUrlCheck(publicUrl, true);
      return withButton;
    }
    const withLink = await telegram.sendMessage(chatId, `${text}\n\n${openApp}: ${escapeHtml(publicUrl)}`);
    if (withLink.ok) await rememberUrlCheck(publicUrl, false);
    return withLink;
  }

  async function sendSnapshotLocked(huntId: string): Promise<boolean> {
    const hunt = huntById(huntId);
    if (!hunt) return false;
    const observation = await observeHunt({ uci, webtic, caches }, hunt, config.settings, new Date(now()), { fresh: true });
    const events: HuntEvent[] = observation.round.showings.map((observed) => ({ kind: "newShowing", showing: snapshotOf(observed) }));
    return (await notify(hunt, events, observation)).delivered && events.length > 0;
  }

  async function confirmHallZoneLocked(huntId: string, hallKey: string): Promise<void> {
    const huntState = huntStateOf(state, huntId);
    if (!huntState.hallsToReconfirm.includes(hallKey)) return;
    setHuntState(huntId, { ...huntState, hallsToReconfirm: huntState.hallsToReconfirm.filter((key) => key !== hallKey) });
    await persistState();
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

  async function restoreLocked(huntId: string): Promise<void> {
    await writeConfig({ ...config, hunts: config.hunts.map((hunt) => (hunt.id === huntId ? { ...hunt, archivedAt: null } : hunt)) });
  }

  async function setMute(huntId: string, mutedUntil: number | null): Promise<void> {
    setHuntState(huntId, { ...huntStateOf(state, huntId), mutedUntil });
    await persistState();
  }

  return {
    tick: () => exclusive(tickNow),
    saveConfig: (next: Config) => exclusive(() => saveValidated(next)),
    importConfig: (text: string) => exclusive(() => importLocked(text)),
    exportConfig: (includeToken: boolean) => exportConfig(config, { includeToken }),
    sendTest: () => exclusive(sendTestLocked),
    sendSnapshot: (huntId: string) => exclusive(() => sendSnapshotLocked(huntId)),
    services: {
      theatres,
      programming: (theatreSlug: string) => fullProgramming.getOrLoad(theatreSlug, () => uci.programmingAll(theatreSlug)),
      movieTheatres: (movieSlug: string) => uci.movieTheatres(movieSlug),
      movies: () => catalog.getOrLoad("all", () => uci.catalog()),
      hall: hallView,
    },
    runNow: (huntId?: string) => exclusive(() => runNowLocked(huntId)),
    mute: (huntId: string, durationMs: number) => exclusive(() => setMute(huntId, now() + durationMs)),
    resume: (huntId: string) => exclusive(() => setMute(huntId, null)),
    markBought: (huntId: string) => exclusive(() => archive([huntId])),
    restore: (huntId: string) => exclusive(() => restoreLocked(huntId)),
    confirmMovie: (huntId: string, slug: string) => exclusive(() => confirmMovieLocked(huntId, slug)),
    confirmHallZone: (huntId: string, hallKey: string) => exclusive(() => confirmHallZoneLocked(huntId, hallKey)),
    close: () => exclusive(() => Promise.resolve()),
    summaries: (huntIds?: string[]) => digestEntries(config, state, false).filter((entry) => huntIds === undefined || huntIds.includes(entry.hunt.id)),
    primaryChat: () => telegramSettings().chatId,
    botToken: () => telegramSettings().token,
    telegramConfigured: () => {
      const { token, chatId } = telegramSettings();
      return token !== null && chatId !== null;
    },
    huntById,
    telegramSource: () => telegramSource(config, env),
    history: (key: string) => history.read(key),
    events: (limit?: number) => eventLog.list(limit),
    config: () => config,
    state: () => state,
    telegram,
    logger,
  };
}
