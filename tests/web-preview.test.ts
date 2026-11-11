import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

const plain = (text: string): string => text.replaceAll(" ", " ").replaceAll("&nbsp;", " ");
const AVENGERS = "/theatres/uci-cinemas-verona/movies/avengers-doomsday?day=2026-12-16";

describe("hall preview from a list of showings", () => {
  it("answers with the hall alone, in both themes, without the page around it", async () => {
    const { instance } = await createWebApp(harness);

    const response = await instance.request("/showings/5116-575978/preview?theatre=uci-cinemas-verona");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain("<html");
    expect([...html.matchAll(/<svg xmlns/g)]).toHaveLength(2);
    expect(html).toContain("44 liberi");
    expect(html).not.toContain("style=");
  });

  it("lists the prices when the hall has more than one", async () => {
    const { instance } = await createWebApp(harness);

    const html = plain(await (await instance.request("/showings/5116-576749/preview?theatre=uci-cinemas-verona")).text());

    expect(html).toContain("Normale 12,90 €");
    expect(html).toContain("Vip 13,90 €");
  });

  it("refuses a key or a cinema that are not well formed and says when the hall cannot be read", async () => {
    const { instance } = await createWebApp(harness);

    expect((await instance.request("/showings/nope!/preview")).status).toBe(404);
    expect((await instance.request("/showings/5116-575978/preview?theatre=NO")).status).toBe(404);
    const missing = await instance.request("/showings/5116-1/preview?theatre=uci-cinemas-verona");
    expect(missing.status).toBe(502);
    expect(await missing.text()).toContain("Pianta non disponibile.");
  });

  it("is offered on the count of good seats, in the showings of a film and in those of a hunt", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);
    await watcher.tick();

    const film = await (await instance.request("/theatres/uci-cinemas-verona/movies/dune-parte-tre")).text();
    const hunt = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(film).toContain('data-preview="/showings/5116-575978/preview?theatre=uci-cinemas-verona"');
    expect(film).toContain("data-preview-panel");
    expect(hunt).toContain(`data-preview="/showings/5116-575978/preview?hunt=${huntId}&amp;theatre=uci-cinemas-verona"`);
  });
});

describe("film with more than 12 showings in a day", () => {
  it("offers to show them all, and asks for the hall of 12 showings at most", async () => {
    const { instance } = await createWebApp(harness);

    const first = await (await instance.request(AVENGERS)).text();
    const hallReads = (): number => harness.world.requests.filter((request) => request.endsWith("/Api2/Performance")).length;
    const afterFirst = hallReads();
    const all = await (await instance.request(`${AVENGERS}&all=1`)).text();
    const rows = (html: string): number => [...html.matchAll(/data-preview-row/g)].length;

    expect(rows(first)).toBe(12);
    expect(first).toMatch(/href="\?day=2026-12-16&amp;all=1"[^>]*>Mostra tutti \(\d+\)/);
    expect(rows(all)).toBeGreaterThan(12);
    expect(all).toContain("Apri pianta");
    expect(all).not.toContain("Mostra tutti");
    expect(afterFirst).toBeLessThanOrEqual(12);
    expect(hallReads() - afterFirst).toBeLessThanOrEqual(12);
  });
});
