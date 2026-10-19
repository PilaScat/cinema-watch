import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Config } from "../src/model.js";
import { createHarness, type Harness } from "./support/harness.js";
import { createWebApp } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

function home(radiusKm: number | null) {
  return (config: Config) => {
    config.settings.home = { lat: 45.4384, lon: 10.9916 };
    config.settings.radiusKm = radiusKm;
  };
}

async function page(path: string, mutate?: (config: Config) => void): Promise<string> {
  const { instance } = await createWebApp(harness, mutate ? { mutate } : {});
  return (await instance.request(path)).text();
}

function position(html: string, text: string): number {
  return html.indexOf(text);
}

describe("theatres by distance", () => {
  it("lists the theatres within the radius from the nearest, with the km, and hides the far ones", async () => {
    const html = await page("/theatres", home(60));

    expect(html).toContain("Entro 60 km");
    expect(html).toContain("I cinema, dal più vicino a casa.");
    expect(html).not.toContain("raggruppati per regione");
    expect(position(html, "UCI Cinemas Verona")).toBeLessThan(position(html, "UCI Luxe Palladio"));
    expect(html).toContain("5 km");
    expect(html).toContain("48 km");
    expect(html).not.toContain("UCI Cinemas Meridiana");
    expect(html).toMatch(/href="\/theatres\?all=1"[^>]*>[^<]*Mostra anche i lontani \(31\)/);
  });

  it("shows the far theatres after the near ones when asked", async () => {
    const html = await page("/theatres?all=1", home(60));

    expect(html).toContain("Più lontani");
    expect(position(html, "UCI Luxe Palladio")).toBeLessThan(position(html, "UCI Cinemas Meridiana"));
    expect(html).not.toContain("Mostra anche i lontani");
  });

  it("sorts every theatre by distance when there is no radius", async () => {
    const html = await page("/theatres", home(null));

    expect(html).toContain("Dal più vicino");
    expect(position(html, "UCI Luxe Palladio")).toBeLessThan(position(html, "UCI Cinemas Arezzo"));
    expect(html).not.toContain("Mostra anche i lontani");
  });

  it("keeps the regions and no km without a home", async () => {
    const html = await page("/theatres");

    expect(html).toContain("Veneto");
    expect(html).not.toMatch(/\d km/);
  });
});

describe("search by distance", () => {
  it("lists the theatres of the chosen film from the nearest, hiding the far ones", async () => {
    const near = await page("/search?q=dune&movie=dune-parte-tre", home(60));
    const all = await page("/search?q=dune&movie=dune-parte-tre&all=1", home(60));

    expect(near).toContain('href="/theatres/uci-cinemas-verona/movies/dune-parte-tre"');
    expect(near).toContain("5 km");
    expect(near).not.toContain('href="/theatres/uci-cinemas-arezzo/movies/dune-parte-tre"');
    expect(near).toMatch(/href="\/search\?q=dune&amp;movie=dune-parte-tre&amp;all=1"/);
    expect(position(all, "uci-cinemas-verona/movies")).toBeLessThan(position(all, "uci-cinemas-arezzo/movies"));
  });
});

describe("hunt form by distance", () => {
  it("puts the theatres near home in their own open group, once", async () => {
    const html = await page("/hunts/new", home(60));

    expect(html).toContain("Vicino a casa");
    expect(position(html, "Vicino a casa")).toBeLessThan(position(html, 'value="uci-cinemas-verona"'));
    expect(position(html, 'value="uci-cinemas-verona"')).toBeLessThan(position(html, 'value="uci-cinemas-vicenza-palladio"'));
    expect(html.match(/value="uci-cinemas-verona"/g)).toHaveLength(1);
  });

  it("keeps only the regions without a home", async () => {
    const html = await page("/hunts/new");

    expect(html).not.toContain("Vicino a casa");
  });
});
