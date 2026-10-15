import { createTtlCache } from "./cache.js";
import { effectiveTelegram, huntInterval, loadConfig, saveConfig } from "./config.js";
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
import { svgToPng } from "./png.js";
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
}

export interface Watcher {
  tick(): Promise<void>;
  runNow(huntId?: string): Promise<RunReport[]>;
  mute(huntId: string, durationMs: number): Promise<void>;
  resume(huntId: string): Promise<void>;
  markBought(huntId: string): Promise<void>;
  confirmMovie(huntId: string, slug: string): Promise<void>;
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
  let config = await loadConfig(store, now);
  let state = await loadState(store, now);
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
      photos.set(key, svgToPng(svg));
    }
    return photos;
  }

  async function notify(hunt: Hunt, events: HuntEvent[], observation: HuntObservation): Promise<void> {
    const chatId = telegramSettings().chatId ?? (options.outbox ? DRY_RUN_CHAT : null);
    if (chatId === null || events.length === 0) return;
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
    const photos = renderPhotos(photoKeys(messages), observation, theatres);
    if (options.outbox) {
      await options.outbox(messages, photos);
      return;
    }
    const results = await telegram.deliver(messages, photos);
    for (const result of results) {
      if (!result.ok) logger.warn("telegram", { hunt: hunt.id, error: result.error });
    }
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

  async function recordRound(hunt: Hunt, observation: HuntObservation, events: HuntEvent[], at: number): Promise<void> {
    const historyDays = { ...state.historyDays };
    for (const { showing, analysis } of observation.round.showings) {
      if (!analysis) continue;
      await history.append(showing.key, { t: at, free: analysis.free, freeGood: analysis.freeInZone });
      historyDays[showing.key] = showing.day;
    }
    state = { ...state, historyDays };
    await eventLog.add([
      {
        t: at,
        huntId: hunt.id,
        kind: observation.errors.length > 0 ? "error" : "round",
        key: null,
        detail: observation.errors[0] ?? `${observation.round.showings.length}`,
      },
      ...events.map((event) => ({ t: at, huntId: hunt.id, kind: event.kind, key: eventKey(event), detail: eventDetail(event) })),
      ...observation.hallChanged.map((key) => ({ t: at, huntId: hunt.id, kind: "hallChanged", key, detail: null })),
    ]);
  }

  async function warnOnErrors(hunt: Hunt, previous: HuntState, errors: string[], at: number): Promise<string | null> {
    const today = romeToday(new Date(at));
    const chatId = telegramSettings().chatId;
    if (errors.length === 0 || previous.errorNotifiedDay === today || chatId === null) return previous.errorNotifiedDay;
    logger.warn("hunt errors", { hunt: hunt.id, errors });
    const detail = errors.length > 1 ? `${errors[0] ?? ""} (+${errors.length - 1})` : (errors[0] ?? "");
    const text = copy.errors.huntFailed(escapeHtml(hunt.name), escapeHtml(redact(detail, [telegramSettings().token ?? ""])));
    const result = await telegram.sendMessage(chatId, text);
    return result.ok ? today : previous.errorNotifiedDay;
  }

  async function runHunt(hunt: Hunt, fresh: boolean): Promise<RunReport> {
    const at = now();
    const previous = huntStateOf(state, hunt.id);
    const observation = await observeHunt({ uci, webtic, caches }, hunt, config.settings, new Date(at), { fresh });
    const { state: next, events } = diffRound(previous, observation.round, hunt);
    await recordRound(hunt, observation, events, at);
    const muted = previous.mutedUntil !== null && previous.mutedUntil > at;
    const allowed = muted ? [] : events.filter((event) => eventAllowed(event, hunt));
    await notify(hunt, allowed, observation);
    const errorNotifiedDay = await warnOnErrors(hunt, previous, observation.errors, at);
    const interval = huntInterval(hunt, config.settings) * MINUTE;
    const updated: HuntState = {
      ...next,
      errorNotifiedDay,
      nextRunAt: at + Math.round(interval * (1 + random() * 0.1)),
      lastRun: { at, ok: observation.errors.length === 0, error: observation.errors[0] ?? null, showings: observation.round.showings.length },
    };
    setHuntState(hunt.id, updated);
    await saveState(store, state);
    return { huntId: hunt.id, events: allowed.length, error: updated.lastRun?.error ?? null };
  }

  function due(hunt: Hunt): boolean {
    if (!active(hunt)) return false;
    const nextRunAt = huntStateOf(state, hunt.id).nextRunAt;
    return nextRunAt === null || nextRunAt <= now();
  }

  function quiet(): boolean {
    const hours = config.settings.quietHours;
    if (hours === null) return false;
    const { time } = romeNow(new Date(now()));
    return time !== hours.to && timeInRange(time, hours.from, hours.to);
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

  async function markBought(huntId: string): Promise<void> {
    await archive([huntId]);
  }

  async function confirmMovie(huntId: string, slug: string): Promise<void> {
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
    await saveState(store, state);
  }

  async function pruneHistory(): Promise<void> {
    const cutoff = addDays(romeToday(new Date(now())), -RETENTION_DAYS);
    const expired = Object.entries(state.historyDays).filter(([, day]) => day < cutoff);
    if (expired.length === 0) return;
    for (const [key] of expired) await history.remove(key);
    const historyDays = Object.fromEntries(Object.entries(state.historyDays).filter(([, day]) => day >= cutoff));
    state = { ...state, historyDays };
    await saveState(store, state);
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
    await saveState(store, state);
  }

  async function tick(): Promise<void> {
    config = await loadConfig(store, now);
    await archiveFinished();
    await pruneHistory();
    if (quiet()) return;
    await checkVersion();
    for (const hunt of config.hunts) {
      if (due(hunt)) await runHunt(hunt, false);
    }
    await sendDigestIfDue();
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
    for (const text of composeDigest(digestEntries())) await telegram.sendMessage(chatId, text);
    state = { ...state, lastDigestDate: rome.day };
    await saveState(store, state);
  }

  async function runNow(huntId?: string): Promise<RunReport[]> {
    config = await loadConfig(store, now);
    const targets = config.hunts.filter(
      (hunt) => active(hunt) && (huntId === undefined || hunt.id === huntId) && !manuallyRefreshedRecently(hunt),
    );
    const reports: RunReport[] = [];
    for (const hunt of targets) {
      const report = await runHunt(hunt, true);
      setHuntState(hunt.id, { ...huntStateOf(state, hunt.id), manualRunAt: now() });
      await saveState(store, state);
      reports.push(report);
    }
    return reports;
  }

  async function mute(huntId: string, durationMs: number): Promise<void> {
    setHuntState(huntId, { ...huntStateOf(state, huntId), mutedUntil: now() + durationMs });
    await saveState(store, state);
  }

  async function resume(huntId: string): Promise<void> {
    setHuntState(huntId, { ...huntStateOf(state, huntId), mutedUntil: null });
    await saveState(store, state);
  }

  return {
    tick,
    runNow,
    mute,
    resume,
    markBought,
    confirmMovie,
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
