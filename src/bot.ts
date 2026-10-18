import { copy } from "./copy.js";
import { escapeHtml, formatTime } from "./format.js";
import type { Hunt } from "./model.js";
import { callbackData, composeNoNews, parseCallbackData, type CallbackAction } from "./notify.js";
import { windowEnded } from "./watcher-rules.js";
import { TelegramError, type TelegramUpdate } from "./telegram.js";
import type { RunReport, Watcher } from "./watcher.js";

const MUTE_MS = 24 * 60 * 60_000;
const POLL_SECONDS = 50;
const CONFLICT_RETRY_MS = 60_000;
const IDLE_RETRY_MS = 60_000;
const ERROR_RETRY_MS = 5_000;

export interface BotOptions {
  watcher: Watcher;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

type Callback = NonNullable<TelegramUpdate["callback"]>;

function isCommand(text: string, name: string): boolean {
  const [word] = text.trim().split(/\s+/);
  return word === `/${name}` || word?.startsWith(`/${name}@`) === true;
}

function hadNews(reports: RunReport[]): boolean {
  return reports.some((report) => report.events > 0);
}

function allSkipped(reports: RunReport[]): boolean {
  return reports.length > 0 && reports.every((report) => report.skipped);
}

export function createBot(options: BotOptions) {
  const { watcher } = options;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  let offset = 0;
  let lastToken: string | null = null;
  let running = false;
  let error: string | null = null;
  let controller: AbortController | null = null;
  let loop: Promise<void> = Promise.resolve();
  let wake: () => void = () => undefined;

  function pause(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      wake = resolve;
      void sleep(ms).then(resolve);
    });
  }

  function huntsForChat(chatId: string): string[] | null {
    const hunts = watcher.config().hunts;
    if (chatId === watcher.primaryChat()) return hunts.map((hunt) => hunt.id);
    const listed = hunts.filter((hunt) => hunt.extraChatIds.includes(chatId)).map((hunt) => hunt.id);
    return listed.length > 0 ? listed : null;
  }

  async function say(chatId: string, texts: string[]): Promise<void> {
    for (const text of texts) await watcher.telegram.sendMessage(chatId, text);
  }

  async function refresh(chatId: string, huntIds: string[]): Promise<void> {
    const reports: RunReport[] = [];
    for (const huntId of huntIds) reports.push(...(await watcher.runNow(huntId)));
    if (allSkipped(reports)) return say(chatId, [copy.callbacks.tooSoon]);
    if (!hadNews(reports)) await say(chatId, composeNoNews(watcher.summaries(huntIds)));
  }

  async function offerUndo(chatId: string, text: string, action: CallbackAction, label: string, huntId: string): Promise<void> {
    await watcher.telegram.sendMessage(chatId, text, [[{ text: label, callbackData: callbackData(action, huntId) }]]);
  }

  async function primaryAction(action: Exclude<CallbackAction, "refresh">, hunt: Hunt, chatId: string, answer: (text: string) => Promise<void>): Promise<void> {
    const name = escapeHtml(hunt.name);
    const buttons = copy.telegram.buttons;
    if (action === "mute") {
      await watcher.mute(hunt.id, MUTE_MS);
      await answer(copy.callbacks.muted);
      return offerUndo(chatId, copy.telegram.mutedNotice(name, formatTime(now() + MUTE_MS)), "resume", buttons.resume, hunt.id);
    }
    if (action === "bought") {
      await watcher.markBought(hunt.id);
      await answer(copy.callbacks.bought);
      return offerUndo(chatId, copy.telegram.archived(name), "restore", buttons.restore, hunt.id);
    }
    if (action === "resume") {
      await watcher.resume(hunt.id);
      return answer(copy.callbacks.resumed);
    }
    if (hunt.archivedAt === null) return answer(copy.callbacks.alreadyActive);
    if (windowEnded(hunt, now())) return answer(copy.callbacks.datesEnded);
    await watcher.restore(hunt.id);
    return answer(copy.callbacks.restored);
  }

  async function answerButton(callback: Callback): Promise<void> {
    const answer = (text: string) => watcher.telegram.answerCallbackQuery(callback.id, text);
    const parsed = parseCallbackData(callback.data);
    const chatId = callback.chatId;
    const allowed = chatId === null ? null : huntsForChat(chatId);
    if (parsed === null || chatId === null || allowed === null) return answer("");
    const hunt = watcher.huntById(parsed.huntId);
    if (hunt === null) return answer(copy.callbacks.notFound);
    if (!allowed.includes(parsed.huntId)) return answer("");
    if (parsed.action === "refresh") {
      await answer(copy.callbacks.refreshing);
      return refresh(chatId, [parsed.huntId]);
    }
    if (chatId !== watcher.primaryChat()) return answer(copy.callbacks.primaryOnly);
    return primaryAction(parsed.action, hunt, chatId, answer);
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback) return answerButton(update.callback);
    const message = update.message;
    if (message === null) return;
    const huntIds = huntsForChat(message.chatId);
    if (huntIds === null) return;
    if (isCommand(message.text, "aggiorna")) await refresh(message.chatId, huntIds);
  }

  async function pollOnce(): Promise<number> {
    const token = watcher.botToken();
    if (token !== lastToken) {
      offset = 0;
      lastToken = token;
    }
    controller = new AbortController();
    const updates = await watcher.telegram.getUpdates(offset, POLL_SECONDS, controller.signal);
    for (const update of updates) {
      offset = Math.max(offset, update.updateId + 1);
      try {
        await handleUpdate(update);
      } catch (failure) {
        watcher.logger.error("bot update", { error: failure instanceof Error ? failure.message : String(failure) });
      }
    }
    return updates.length;
  }

  function retryDelay(failure: unknown): number {
    if (!(failure instanceof TelegramError)) return ERROR_RETRY_MS;
    if (failure.kind === "conflict") {
      error = copy.callbacks.conflict;
      watcher.logger.error("bot conflict", { error: failure.description });
      return CONFLICT_RETRY_MS;
    }
    return failure.kind === "unauthorized" ? IDLE_RETRY_MS : ERROR_RETRY_MS;
  }

  async function cycle(): Promise<void> {
    try {
      await pollOnce();
      error = null;
    } catch (failure) {
      await pause(retryDelay(failure));
    }
  }

  async function run(): Promise<void> {
    while (running) await cycle();
  }

  function start(): void {
    if (running) return;
    running = true;
    error = null;
    loop = run();
  }

  async function stop(): Promise<void> {
    running = false;
    controller?.abort();
    wake();
    await loop;
  }

  return {
    handleUpdate,
    pollOnce,
    cycle,
    start,
    stop,
    status: () => ({ running, error }),
  };
}
