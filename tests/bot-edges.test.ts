import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot.js";
import type { Config } from "../src/model.js";
import { createHarness, duneHunt, PRIMARY_CHAT, type Harness } from "./support/harness.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function twoHunts(config: Config) {
  const first = config.hunts[0];
  if (first) first.extraChatIds = ["-1001"];
  config.hunts.push({ ...duneHunt(config, { name: "Seconda caccia" }), id: "bbbbbbbb" });
}

function sleepRecorder() {
  const slept: number[] = [];
  return { slept, sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); } };
}

function answers() {
  return harness.world.telegram.filter((call) => call.method === "answerCallbackQuery").map((call) => call.text ?? "");
}

describe("bot buttons across hunts", () => {
  it("answers with nothing when an extra chat presses a button of a hunt it does not follow", async () => {
    await harness.seed(twoHunts);
    const watcher = await harness.watcher();
    const bot = createBot({ watcher, sleep: harness.sleep });

    await bot.handleUpdate({ updateId: 1, message: null, callback: { id: "c1", chatId: "-1001", data: "m:bbbbbbbb", fromId: 1 } });
    await bot.handleUpdate({ updateId: 2, message: null, callback: { id: "c2", chatId: "-1001", data: "a:bbbbbbbb", fromId: 1 } });

    expect(answers()).toEqual(["", ""]);
    expect(watcher.state().hunts["bbbbbbbb"]?.mutedUntil ?? null).toBeNull();
  });

  it("lets an extra chat refresh the hunt it follows", async () => {
    const config = await harness.seed(twoHunts);
    const watcher = await harness.watcher();
    const bot = createBot({ watcher, sleep: harness.sleep });
    const followed = config.hunts[0]?.id ?? "";

    await bot.handleUpdate({ updateId: 1, message: null, callback: { id: "c1", chatId: "-1001", data: `a:${followed}`, fromId: 1 } });

    expect(answers()[0]).toBe("Aggiornamento in corso");
  });
});

describe("bot updates", () => {
  it("ignores a message without text and still moves on", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    const bot = createBot({ watcher, sleep: harness.sleep });
    harness.world.pushUpdate({ update_id: 7, message: { chat: { id: Number(PRIMARY_CHAT) }, from: { id: 1 } } });

    const first = await bot.pollOnce();
    const second = await bot.pollOnce();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(harness.world.telegram.filter((call) => call.method !== "getUpdates")).toEqual([]);
  });

  it("logs a failing update and goes on with the next one without handling it twice", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    const failures: unknown[] = [new Error("boom"), "plain text failure"];
    let attempts = 0;
    watcher.runNow = () => {
      attempts += 1;
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      return Promise.reject(failures.shift());
    };
    const bot = createBot({ watcher, sleep: harness.sleep });
    harness.world.pushUpdate({ update_id: 1, message: { chat: { id: Number(PRIMARY_CHAT) }, text: "/aggiorna", from: { id: 1 } } });
    harness.world.pushUpdate({ update_id: 2, message: { chat: { id: Number(PRIMARY_CHAT) }, text: "/aggiorna", from: { id: 1 } } });

    const handled = await bot.pollOnce();
    const again = await bot.pollOnce();

    expect(handled).toBe(2);
    expect(attempts).toBe(2);
    expect(again).toBe(0);
  });
});

describe("bot waits after failures", () => {
  it("waits five seconds after an error that is not a Telegram answer", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    watcher.telegram.getUpdates = () => Promise.reject(new Error("socket closed"));
    const { slept, sleep } = sleepRecorder();
    const bot = createBot({ watcher, sleep });

    await bot.cycle();

    expect(slept).toEqual([5_000]);
  });

  it("waits a minute when the token is refused and five seconds on a server error", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    const { slept, sleep } = sleepRecorder();
    const bot = createBot({ watcher, sleep });

    harness.world.failHost("api.telegram.org", 401);
    await bot.cycle();
    harness.world.failHost("api.telegram.org", 400);
    await bot.cycle();

    expect(slept).toEqual([60_000, 5_000]);
  });

  it("clears its error once polling works again", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    const bot = createBot({ watcher, sleep: harness.sleep });

    harness.world.conflictOnPoll(true);
    await bot.cycle();
    const during = bot.status().error;
    harness.world.conflictOnPoll(false);
    await bot.cycle();

    expect(during).toBe("Un altro programma legge gli aggiornamenti di questo bot");
    expect(bot.status().error).toBeNull();
  });

  it("starts one loop even when started twice", async () => {
    await harness.seed((config) => {
      config.settings.telegram = { token: null, chatId: null };
    });
    const { slept, sleep } = sleepRecorder();
    const bot = createBot({ watcher: await harness.watcher(), sleep });

    bot.start();
    bot.start();
    expect(bot.status().running).toBe(true);
    await bot.stop();

    expect(bot.status().running).toBe(false);
    expect(slept.every((ms) => ms === 60_000)).toBe(true);
  });
});
