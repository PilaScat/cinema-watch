import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBot } from "../src/bot.js";
import { saveConfig } from "../src/config.js";
import type { Config } from "../src/model.js";
import { createStore } from "../src/store.js";
import { fixture } from "./support/fake-world.js";
import { createHarness, PRIMARY_CHAT, type Harness } from "./support/harness.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function command(updateId: number, chatId: string, text: string) {
  return { updateId, message: { chatId, text, fromId: 1 }, callback: null };
}

async function primed(mutate?: (config: Config) => void) {
  const config = await harness.seed(mutate);
  const watcher = await harness.watcher();
  await watcher.tick();
  harness.world.telegram.length = 0;
  harness.advance(60_000);
  return { config, watcher, bot: createBot({ watcher, sleep: harness.sleep }) };
}

describe("bot", () => {
  it("answers /aggiorna with no news in the chat that asked", async () => {
    const { bot } = await primed();

    await bot.handleUpdate(command(1, PRIMARY_CHAT, "/aggiorna"));

    expect(harness.world.telegram.map((call) => [call.method, call.chatId])).toEqual([["sendMessage", PRIMARY_CHAT]]);
    expect(harness.world.telegram[0]?.text).toContain("Nessuna novità");
    expect(harness.world.telegram[0]?.text).toContain("Dune IMAX Verona");
  });

  it("ignores chats it does not know and messages that are not commands", async () => {
    const { bot } = await primed();

    await bot.handleUpdate(command(1, "999", "/aggiorna"));
    await bot.handleUpdate(command(2, PRIMARY_CHAT, "ciao"));

    expect(harness.world.telegram).toEqual([]);
  });

  it("mutes a hunt from the primary chat and answers the button", async () => {
    const { bot, config, watcher } = await primed();
    const huntId = config.hunts[0]?.id ?? "";

    await bot.handleUpdate(callback(1, PRIMARY_CHAT, `m:${huntId}`));

    expect(watcher.state().hunts[huntId]?.mutedUntil).toBe(harness.now() + 24 * 60 * 60_000);
    expect(answers()).toEqual(["Silenziata per 24 h"]);
  });

  it("archives a hunt bought from the primary chat but refuses it from an extra chat", async () => {
    const { bot, config, watcher } = await primed((draft) => {
      const hunt = draft.hunts[0];
      if (hunt) hunt.extraChatIds = ["-555"];
    });
    const huntId = config.hunts[0]?.id ?? "";

    await bot.handleUpdate(callback(1, "-555", `b:${huntId}`));
    const refused = watcher.config().hunts[0]?.archivedAt;
    await bot.handleUpdate(callback(2, PRIMARY_CHAT, `b:${huntId}`));

    expect(refused).toBeNull();
    expect(watcher.config().hunts[0]?.archivedAt).not.toBeNull();
    expect(answers()).toEqual(["Solo dalla chat principale", "Caccia archiviata"]);
  });

  it("answers buttons of hunts that no longer exist and ignores malformed ones", async () => {
    const { bot } = await primed();

    await bot.handleUpdate(callback(1, PRIMARY_CHAT, "a:zzzzzzzz"));
    await bot.handleUpdate(callback(2, PRIMARY_CHAT, "x:12"));

    expect(answers()).toEqual(["Caccia non trovata", ""]);
  });

  it("polls updates in order and never handles the same one twice", async () => {
    const { bot, config } = await primed();
    const huntId = config.hunts[0]?.id ?? "";
    harness.world.pushUpdate({ update_id: 10, callback_query: { id: "c10", from: { id: 1 }, data: `m:${huntId}`, message: { chat: { id: 4242 } } } });
    harness.world.pushUpdate({ update_id: 11, callback_query: { id: "c11", from: { id: 1 }, data: "a:zzzzzzzz", message: { chat: { id: 4242 } } } });

    const first = await bot.pollOnce();
    const second = await bot.pollOnce();

    expect([first, second]).toEqual([2, 0]);
    expect(answers()).toEqual(["Silenziata per 24 h", "Caccia non trovata"]);
  });

  it("waits a minute after another program read the same bot, then polls again", async () => {
    const { bot, config } = await primed();
    const huntId = config.hunts[0]?.id ?? "";
    harness.world.conflictOnPoll(true);
    const before = harness.now();

    await bot.cycle();
    const waited = harness.now() - before;
    const duringConflict = bot.status().error;
    harness.world.conflictOnPoll(false);
    harness.world.pushUpdate({ update_id: 20, callback_query: { id: "c20", from: { id: 1 }, data: `m:${huntId}`, message: { chat: { id: 4242 } } } });
    await bot.cycle();

    expect(waited).toBe(60_000);
    expect(duringConflict).toBe("Un altro programma legge gli aggiornamenti di questo bot");
    expect(bot.status().error).toBeNull();
    expect(answers()).toEqual(["Silenziata per 24 h"]);
  });

  it("starts reading from the beginning when the bot token changes", async () => {
    const { bot, config, watcher } = await primed();
    const huntId = config.hunts[0]?.id ?? "";
    harness.world.pushUpdate({ update_id: 500, callback_query: { id: "c500", from: { id: 1 }, data: "a:zzzzzzzz", message: { chat: { id: 4242 } } } });
    await bot.pollOnce();
    config.settings.telegram = { token: "987654321:AAAnotherFakeTokenForTests_abcdefghijk", chatId: PRIMARY_CHAT };
    await saveConfig(createStore(harness.dataDir), config);
    harness.advance(6 * 60_000);
    await watcher.tick();
    harness.world.pushUpdate({ update_id: 3, callback_query: { id: "c3", from: { id: 1 }, data: `m:${huntId}`, message: { chat: { id: 4242 } } } });

    await bot.pollOnce();

    expect(answers()).toContain("Silenziata per 24 h");
  });

  it("answers the refresh button with no news, then with updated once seats free up", async () => {
    const { bot, config } = await primed();
    const huntId = config.hunts[0]?.id ?? "";

    await bot.handleUpdate(callback(1, PRIMARY_CHAT, `a:${huntId}`));
    harness.world.setOccupancy(5116, 575978, freeing(["H/9", "H/10", "H/11"]));
    harness.advance(31_000);
    await bot.handleUpdate(callback(2, PRIMARY_CHAT, `a:${huntId}`));

    const methods = harness.world.telegram.map((call) => (call.method === "answerCallbackQuery" ? "answer" : (call.text?.includes("Nessuna novità") ? "noNews" : call.method)));

    expect(answers()).toEqual(["Aggiornamento in corso", "Aggiornamento in corso"]);
    expect(methods.slice(0, 2)).toEqual(["answer", "noNews"]);
    expect(harness.world.telegram.some((call) => call.text?.includes("Posti liberati"))).toBe(true);
  });

  it("tells that a hunt was refreshed moments ago instead of reading again", async () => {
    const { bot } = await primed();
    await bot.handleUpdate(command(1, PRIMARY_CHAT, "/aggiorna"));
    harness.world.telegram.length = 0;
    harness.advance(10_000);

    await bot.handleUpdate(command(2, PRIMARY_CHAT, "/aggiorna"));

    expect(harness.world.telegram.map((call) => call.text)).toEqual(["Aggiornata meno di 30 s fa"]);
  });

  it("lets /aggiorna deliver the alert instead of a no news reply when something changed", async () => {
    const { bot } = await primed();
    harness.world.setOccupancy(5116, 575978, freeing(["H/9", "H/10", "H/11"]));

    await bot.handleUpdate(command(1, PRIMARY_CHAT, "/aggiorna@cinema_watch_test_bot"));

    expect(harness.world.telegram.some((call) => call.text?.includes("Nessuna novità"))).toBe(false);
    expect(harness.world.telegram.some((call) => call.text?.includes("Posti liberati"))).toBe(true);
  });

  it("ignores buttons from chats outside the hunt and updates without content", async () => {
    const { bot, config } = await primed();
    const huntId = config.hunts[0]?.id ?? "";

    await bot.handleUpdate(callback(1, "-777", `m:${huntId}`));
    await bot.handleUpdate({ updateId: 2, message: null, callback: null });
    await bot.handleUpdate({ updateId: 3, message: null, callback: { id: "c3", chatId: null, data: `m:${huntId}`, fromId: 1 } });
    await bot.handleUpdate(callback(4, "-777", "a:zzzzzzzz"));

    expect(answers()).toEqual(["", "", ""]);
  });

  it("waits quietly while Telegram is not configured and stops cleanly", async () => {
    await harness.seed((config) => {
      config.settings.telegram = { token: null, chatId: null };
    });
    const bot = createBot({ watcher: await harness.watcher(), sleep: harness.sleep });

    bot.start();
    await bot.stop();

    expect(bot.status()).toEqual({ running: false, error: null });
  });
});

function freeing(seatIds: string[]): unknown {
  const occupancy = structuredClone(fixture("webtic/occupancy-5116-575978.json")) as { Data: { Occupancy: { Seats: Array<{ SeatId: string }> } } };
  occupancy.Data.Occupancy.Seats = occupancy.Data.Occupancy.Seats.filter((seat) => !seatIds.includes(seat.SeatId));
  return occupancy;
}

function callback(updateId: number, chatId: string, data: string) {
  return { updateId, message: null, callback: { id: `cb${updateId}`, chatId, data, fromId: 1 } };
}

function answers() {
  return harness.world.telegram.filter((call) => call.method === "answerCallbackQuery").map((call) => call.text ?? "");
}
