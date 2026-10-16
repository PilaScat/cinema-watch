import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/model.js";
import { fixture } from "./support/fake-world.js";
import { createHarness, duneHunt, MINUTE, type Harness } from "./support/harness.js";
import { interceptFetch, mapKeys, occupancyWithout, occupancyWithTaken, rewriteJson, UCI_HOST } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

const OCCUPANCY = "webtic/occupancy-5116-575978.json";
const DAY_PATH = "/api/theatres/uci-cinemas-verona/programming/2026-12-15";

function withPublicUrl(url: string) {
  return (config: Config) => {
    config.settings.publicUrl = url;
  };
}

async function errorDetails(watcher: Awaited<ReturnType<Harness["watcher"]>>): Promise<string[]> {
  return (await watcher.events(50)).filter((entry) => entry.kind === "error").map((entry) => entry.detail ?? "");
}

describe("public address in alerts", () => {
  it("adds an open hall button when the address is https", async () => {
    await harness.seed(withPublicUrl("https://cinema.example.com/"));
    const watcher = await harness.watcher();

    await watcher.tick();
    const summary = harness.world.telegram.find((call) => call.method === "sendMessage");
    const buttons = JSON.stringify(summary?.replyMarkup);

    expect(buttons).toContain('"text":"Apri sala"');
    expect(buttons).toContain("https://cinema.example.com/performances/5116/575978");
    expect(summary?.text).not.toContain("Apri sala:");
  });

  it("writes the link in the text when the address is plain http", async () => {
    await harness.seed(withPublicUrl("http://cinema.local:8080"));
    const watcher = await harness.watcher();

    await watcher.tick();
    const summary = harness.world.telegram.find((call) => call.method === "sendMessage");

    expect(summary?.text).toContain("Apri sala: http://cinema.local:8080/performances/5116/575978");
    expect(JSON.stringify(summary?.replyMarkup)).not.toContain("Apri sala");
  });
});

describe("alerts for every kind of change", () => {
  it("reports a cancelled showing only after it stayed missing for two rounds, when cancellations are on", async () => {
    await harness.seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.notify = { ...hunt.notify, cancelled: true };
    });
    const watcher = await harness.watcher();
    await watcher.tick();
    harness.world.telegram.length = 0;
    const withoutDune = (fixture("uci/programming-uci-cinemas-verona-2026-12-15.json") as { data: Array<{ slug: string }> }).data.filter((movie) => movie.slug !== "dune-parte-tre");
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-15", { data: withoutDune });

    harness.advance(6 * MINUTE);
    await watcher.tick();
    const afterOne = harness.world.telegram.length;
    harness.advance(6 * MINUTE);
    await watcher.tick();

    expect(afterOne).toBe(0);
    expect(harness.world.telegram.some((call) => call.text?.includes("Annullati"))).toBe(true);
    expect((await watcher.events(10)).some((entry) => entry.kind === "cancelled" && entry.key === "5116-575978" && entry.detail === "mar 15/12 20:30")).toBe(true);
  });

  it("keeps quiet about a cancelled showing when cancellations are off", async () => {
    await harness.seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.notify = { ...hunt.notify, cancelled: false };
    });
    const watcher = await harness.watcher();
    await watcher.tick();
    harness.world.telegram.length = 0;
    const withoutDune = (fixture("uci/programming-uci-cinemas-verona-2026-12-15.json") as { data: Array<{ slug: string }> }).data.filter((movie) => movie.slug !== "dune-parte-tre");
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-15", { data: withoutDune });

    for (let round = 0; round < 3; round += 1) {
      harness.advance(6 * MINUTE);
      await watcher.tick();
    }

    expect(harness.world.telegram.some((call) => call.text?.includes("Annullati"))).toBe(false);
  });

  it("reports a showing that changed time as moved, when moves are on", async () => {
    await harness.seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.notify = { ...hunt.notify, moved: true };
    });
    const watcher = await harness.watcher();
    await watcher.tick();
    harness.world.telegram.length = 0;
    const day = fixture("uci/programming-uci-cinemas-verona-2026-12-15.json");
    const shifted = JSON.parse(JSON.stringify(day).replaceAll("2026-12-15 20:30:00", "2026-12-15 21:15:00").replaceAll('"actual_start_at":"20:30"', '"actual_start_at":"21:15"'));
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-15", shifted);

    harness.advance(6 * MINUTE);
    await watcher.tick();

    expect(harness.world.telegram.some((call) => call.text?.includes("Spostati"))).toBe(true);
    expect((await watcher.events(10)).find((entry) => entry.kind === "moved")?.detail).toBe("mar 15/12 20:30 → mar 15/12 21:15");
  });

  it("warns when the zone falls under the last seats threshold, when that alert is on", async () => {
    await harness.seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.notify = { ...hunt.notify, lastSeats: true };
      if (hunt) hunt.lastSeatsThreshold = 2;
    });
    const watcher = await harness.watcher();
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture(OCCUPANCY), ["H/9", "H/10", "H/11"]));
    await watcher.tick();
    harness.world.telegram.length = 0;
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture(OCCUPANCY), ["H/9"]));

    harness.advance(6 * MINUTE);
    await watcher.tick();

    expect(harness.world.telegram.some((call) => call.text?.includes("Ultimi posti"))).toBe(true);
    expect((await watcher.events(10)).find((entry) => entry.kind === "lastSeats")?.detail).toBe("mar 15/12 20:30");
  });

  it("does not warn about last seats when that alert is off", async () => {
    await harness.seed((config) => {
      const hunt = config.hunts[0];
      if (hunt) hunt.notify = { ...hunt.notify, lastSeats: false };
      if (hunt) hunt.lastSeatsThreshold = 2;
    });
    const watcher = await harness.watcher();
    harness.world.setOccupancy(5116, 575978, occupancyWithout(fixture(OCCUPANCY), ["H/9", "H/10", "H/11"]));
    await watcher.tick();
    harness.world.telegram.length = 0;
    harness.world.setOccupancy(5116, 575978, occupancyWithTaken(occupancyWithout(fixture(OCCUPANCY), ["H/9"]), "H/12"));

    harness.advance(6 * MINUTE);
    await watcher.tick();

    expect(harness.world.telegram.some((call) => call.text?.includes("Ultimi posti"))).toBe(false);
  });
});

describe("reading problems are described by their cause", () => {
  it("says the answer had an unexpected format when the cinema sends something else", async () => {
    await harness.seed();
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-15", { unexpected: true });
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(await errorDetails(watcher)).toContain("uci-cinemas-verona mar 15/12 · UCI: risposta in formato inatteso");
  });

  it("says the seats request was refused, with the reason Webtic gives", async () => {
    await harness.seed();
    harness.world.setOccupancy(5116, 575978, { Status: { Success: false, ReasonCode: 12, Message: "Spettacolo chiuso" } });
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(await errorDetails(watcher)).toContain("mar 15/12 20:30 SALA 1 IMAX · Webtic: richiesta rifiutata (Spettacolo chiuso)");
  });

  it("falls back to the reason code when Webtic gives no message", async () => {
    await harness.seed();
    harness.world.setOccupancy(5116, 575978, { Status: { Success: false, ReasonCode: 12 } });
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(await errorDetails(watcher)).toContain("mar 15/12 20:30 SALA 1 IMAX · Webtic: richiesta rifiutata (12)");
  });

  it("leaves the detail empty when Webtic gives neither message nor code", async () => {
    await harness.seed();
    harness.world.setOccupancy(5116, 575978, { Status: { Success: false } });
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(await errorDetails(watcher)).toContain("mar 15/12 20:30 SALA 1 IMAX · Webtic: richiesta rifiutata ()");
  });

  it("says the answer was not readable when the cinema sends something that is not json", async () => {
    await harness.seed();
    interceptFetch(harness, (url, passthrough) => (url.hostname === UCI_HOST && url.pathname === DAY_PATH ? Promise.resolve(new Response("<html>oops</html>", { status: 200 })) : passthrough()));
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(await errorDetails(watcher)).toContain("uci-cinemas-verona mar 15/12 · UCI: risposta non leggibile");
  });

  it("reports several failures of one hunt with a count, once a day", async () => {
    await harness.seed();
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-15", { unexpected: true });
    harness.world.setProgramming("uci-cinemas-verona", "2026-12-16", { unexpected: true });
    const watcher = await harness.watcher();

    await watcher.tick();
    const warning = harness.world.telegram.find((call) => call.text?.includes("lettura non riuscita"));

    expect(warning?.text).toContain("UCI: risposta in formato inatteso (+1)");
  });

  it("hides the bot token from a failure that mentions it", async () => {
    await harness.seed();
    const token = harness.world.telegram.length === 0 ? (await harness.watcher()).botToken() : null;
    harness.world.setOccupancy(5116, 575978, { Status: { Success: false, ReasonCode: 1, Message: `token ${token}` } });
    const watcher = await harness.watcher();

    await watcher.tick();
    const warning = harness.world.telegram.find((call) => call.text?.includes("lettura non riuscita"));

    expect(warning?.text).toContain("token ***");
    expect(warning?.text).not.toContain(String(token));
  });
});

describe("version check", () => {
  it("keeps the known version when GitHub answers without a tag", async () => {
    await harness.seed();
    interceptFetch(harness, (url, passthrough) => (url.hostname === "api.github.com" ? Promise.resolve(new Response(JSON.stringify({ name: "no tag here" }), { status: 200 })) : passthrough()));
    const watcher = await harness.watcher();
    const start = harness.now();

    await watcher.tick();

    expect(watcher.state().latestVersion).toBeNull();
    expect(watcher.state().lastVersionCheckAt).toBe(start);
  });

  it("keeps the known version when the tag is not text", async () => {
    await harness.seed();
    interceptFetch(harness, (url, passthrough) => (url.hostname === "api.github.com" ? Promise.resolve(new Response(JSON.stringify({ tag_name: 7 }), { status: 200 })) : passthrough()));
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(watcher.state().latestVersion).toBeNull();
  });
});

describe("housekeeping", () => {
  it("leaves a hunt that was already bought with its first archive date", async () => {
    const config = await harness.seed();
    const huntId = config.hunts[0]?.id ?? "";
    const watcher = await harness.watcher();

    await watcher.markBought(huntId);
    const first = watcher.config().hunts[0]?.archivedAt;
    harness.advance(60 * MINUTE);
    await watcher.markBought(huntId);

    expect(first).toBe("2026-12-01T10:00:00.000Z");
    expect(watcher.config().hunts[0]?.archivedAt).toBe(first);
  });

  it("bought archives only the hunt that was asked for", async () => {
    await harness.seed((config) => {
      config.hunts.push({ ...duneHunt(config, { name: "Seconda caccia" }), id: "bbbbbbbb" });
    });
    const watcher = await harness.watcher();

    await watcher.markBought("bbbbbbbb");

    expect(watcher.config().hunts.map((hunt) => hunt.archivedAt === null)).toEqual([true, false]);
  });

  it("does not send a snapshot of a hunt that does not exist", async () => {
    await harness.seed();
    const watcher = await harness.watcher();

    expect(await watcher.sendSnapshot("zzzzzzzz")).toBe(false);
    expect(harness.world.telegram).toEqual([]);
  });

  it("does not confirm a movie on a hunt that follows slugs", async () => {
    const config = await harness.seed();
    const watcher = await harness.watcher();

    await watcher.confirmMovie(config.hunts[0]?.id ?? "", "avengers-doomsday");

    expect(watcher.config().hunts[0]?.movie).toEqual({ kind: "slug", slugs: ["dune-parte-tre"] });
  });

  it("stops with the error when the configuration cannot be read at all", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    await rm(join(harness.dataDir, "config.json"));
    await mkdir(join(harness.dataDir, "config.json"));

    await expect(watcher.tick()).rejects.toThrow();
  });

  it("keeps the old configuration when the file on disk became invalid", async () => {
    await harness.seed();
    const watcher = await harness.watcher();
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(harness.dataDir, "config.json"), "{ broken");

    await watcher.tick();

    expect(watcher.config().hunts[0]?.name).toBe("Dune IMAX Verona");
  });

  it("keeps the programme day when a title hunt sees movies without poster", async () => {
    await harness.seed();
    rewriteJson(harness, (url) => url.pathname.includes("/programming"), (json) => mapKeys(json, "poster", null));
    const watcher = await harness.watcher();

    await watcher.tick();

    expect(Object.keys(watcher.state().hunts[watcher.config().hunts[0]?.id ?? ""]?.showings ?? {})).toEqual(["5116-575978"]);
  });
});
