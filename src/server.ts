import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { serve as honoServe } from "@hono/node-server";
import { createBot } from "./bot.js";
import type { OutgoingMessage } from "./model.js";
import { createApp } from "./web/app.js";
import { createWatcher } from "./watcher.js";

const TICK_MS = 30_000;
const DEFAULT_PORT = 8790;

const dataDir = process.env.DATA_DIR ?? "/data";
const version = process.env.APP_VERSION ?? "dev";
const port = Number(process.env.PORT ?? DEFAULT_PORT);

async function dryRun(): Promise<void> {
  const outDir = join(dataDir, "dry-run");
  await mkdir(outDir, { recursive: true });
  let batch = 0;
  const watcher = await createWatcher({
    dataDir,
    version,
    outbox: async (messages: OutgoingMessage[], photos: Map<string, Uint8Array>) => {
      batch += 1;
      await writeFile(join(outDir, `messages-${batch}.json`), JSON.stringify(messages, null, 2));
      for (const [key, png] of photos) await writeFile(join(outDir, `${key}.png`), png);
    },
  });
  const reports = await watcher.runNow();
  const summaries = watcher.summaries().map((entry) => ({
    hunt: entry.hunt.name,
    showings: entry.showings.map((showing) => ({
      key: showing.key,
      when: `${showing.day} ${showing.time}`,
      room: showing.room,
      free: showing.seats?.free ?? null,
      freeInZone: showing.seats?.freeInZone ?? null,
      ok: showing.seats?.ok ?? null,
    })),
  }));
  watcher.logger.info("dry run", { reports, summaries, outDir });
}

async function serve(): Promise<void> {
  const watcher = await createWatcher({ dataDir, version });
  const bot = createBot({ watcher });
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      await watcher.tick();
    } catch (error) {
      watcher.logger.error("tick", { error: error instanceof Error ? error.message : String(error) });
    } finally {
      ticking = false;
    }
  };
  const timer = setInterval(() => void tick(), TICK_MS);
  bot.start();
  const app = await createApp({ watcher, version, dataDir, env: process.env });
  const server = honoServe({ fetch: app.fetch, port, hostname: "0.0.0.0" });
  watcher.logger.info("started", { version, dataDir, port });
  void tick();
  const shutdown = async () => {
    clearInterval(timer);
    server.close();
    await bot.stop();
    await watcher.close();
    watcher.logger.info("stopped");
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

await (process.argv.includes("--dry-run") ? dryRun() : serve());
