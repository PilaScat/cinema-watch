import { copy } from "./copy.js";
import { composeNoNews, parseCallbackData } from "./notify.js";
import { TelegramError, type TelegramUpdate } from "./telegram.js";
import type { Watcher } from "./watcher.js";

const MUTE_MS = 24 * 60 * 60_000;
const POLL_SECONDS = 50;
const IDLE_RETRY_MS = 60_000;
const ERROR_RETRY_MS = 5_000;

export interface BotOptions {
  watcher: Watcher;
  sleep?: (ms: number) => Promise<void>;
}

type Callback = NonNullable<TelegramUpdate["callback"]>;

function isCommand(text: string, name: string): boolean {
  const [word] = text.trim().split(/\s+/);
  return word === `/${name}` || word?.startsWith(`/${name}@`) === true;
}

export function createBot(options: BotOptions) {
  const { watcher } = options;

  function huntsForChat(chatId: string): string[] | null {
    const hunts = watcher.config().hunts;
    if (chatId === watcher.primaryChat()) return hunts.map((hunt) => hunt.id);
    const listed = hunts.filter((hunt) => hunt.extraChatIds.includes(chatId)).map((hunt) => hunt.id);
    return listed.length > 0 ? listed : null;
  }

  async function refresh(chatId: string, huntIds: string[]): Promise<void> {
    const reports = [];
    for (const huntId of huntIds) reports.push(...(await watcher.runNow(huntId)));
    if (reports.some((report) => report.events > 0)) return;
    for (const text of composeNoNews(watcher.summaries(huntIds))) await watcher.telegram.sendMessage(chatId, text);
  }

  async function answerButton(callback: Callback): Promise<string> {
    const parsed = parseCallbackData(callback.data);
    if (parsed === null || callback.chatId === null) return "";
    if (!watcher.config().hunts.some((hunt) => hunt.id === parsed.huntId)) return copy.callbacks.notFound;
    const allowed = huntsForChat(callback.chatId);
    if (allowed === null || !allowed.includes(parsed.huntId)) return "";
    const primary = callback.chatId === watcher.primaryChat();
    if (parsed.action === "refresh") {
      const reports = await watcher.runNow(parsed.huntId);
      return reports.some((report) => report.events > 0) ? copy.callbacks.refreshed : copy.callbacks.noNews;
    }
    if (!primary) return copy.callbacks.primaryOnly;
    if (parsed.action === "mute") {
      await watcher.mute(parsed.huntId, MUTE_MS);
      return copy.callbacks.muted;
    }
    await watcher.markBought(parsed.huntId);
    return copy.callbacks.bought;
  }

  async function handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback) {
      const text = await answerButton(update.callback);
      await watcher.telegram.answerCallbackQuery(update.callback.id, text);
      return;
    }
    const message = update.message;
    if (message === null) return;
    const huntIds = huntsForChat(message.chatId);
    if (huntIds === null) return;
    if (isCommand(message.text, "aggiorna")) await refresh(message.chatId, huntIds);
  }

  let offset = 0;
  let running = false;
  let error: string | null = null;
  let controller: AbortController | null = null;
  let loop: Promise<void> = Promise.resolve();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  async function pollOnce(): Promise<number> {
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

  async function pause(failure: unknown): Promise<boolean> {
    if (failure instanceof TelegramError && failure.kind === "conflict") {
      error = copy.callbacks.conflict;
      watcher.logger.error("bot conflict", { error: failure.description });
      return false;
    }
    const idle = failure instanceof TelegramError && failure.kind === "unauthorized";
    if (running) await sleep(idle ? IDLE_RETRY_MS : ERROR_RETRY_MS);
    return true;
  }

  async function run(): Promise<void> {
    while (running) {
      try {
        await pollOnce();
        error = null;
      } catch (failure) {
        if (!(await pause(failure))) running = false;
      }
    }
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
    await loop;
  }

  function restart(): void {
    controller?.abort();
  }

  return {
    handleUpdate,
    pollOnce,
    start,
    stop,
    restart,
    stopped: () => loop,
    status: () => ({ running, error }),
  };
}
