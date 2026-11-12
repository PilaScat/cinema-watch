import { createHash, generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportConfig, importConfig, issueLines, parseConfig } from "../src/config.js";
import { copy } from "../src/copy.js";
import type { TicketDraft } from "../src/tickets/model.js";
import { TOKEN_URL, WALLET_SAVE_URL } from "../src/tickets/wallet.js";
import { createHarness, PRIMARY_CHAT, type Harness } from "./support/harness.js";
import { syntheticTicket, ticketPdf, SYNTHETIC_ORDER } from "./support/ticket-pdf.js";
import { createWebApp, ORIGIN, post } from "./support/web.js";

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

const pair = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const wallet = { issuerId: "3388000000012345678", clientEmail: "cinema-watch@example-project.iam.gserviceaccount.com", privateKey: pair.privateKey };
const draft: TicketDraft = { title: "Dune: Parte Tre", day: "2026-12-21", time: "20:20", theatre: "UCI Cinemas Verona", address: "S.Giovanni Lupatoto", room: "SALA 1 IMAX", sector: "PLATEA", row: "H", seat: "9", kind: "Top Intero WEB", total: 14.9, order: SYNTHETIC_ORDER, code: "00112233AABBCCDD" };

function upload(pdf: Uint8Array, name = "tickets.pdf") {
  const body = new FormData();
  body.append("pdf", new File([new Uint8Array(pdf)], name, { type: "application/pdf" }));
  return { method: "POST", body, headers: { origin: ORIGIN } };
}

function fieldsOf(html: string): Array<[string, string]> {
  return [...html.matchAll(/<input id="(\w+)-\d+" name="\w+" type="\w+" value="([^"]*)"/g)].map((match): [string, string] => [match[1] ?? "", match[2] ?? ""]);
}

describe("tickets page", () => {
  it("is in the menu, starts empty and says when Google Wallet is not set up", async () => {
    const { instance } = await createWebApp(harness);

    const html = await (await instance.request("/tickets")).text();

    expect(html).toContain('<a href="/tickets" aria-current="page"');
    expect(html).toContain("Nessun biglietto.");
    expect(html).toContain("Google Wallet non configurato.");
    expect(html).toContain('enctype="multipart/form-data"');
  });

  it("reads the PDF of an order into fields to check, saves them and shows a card for each ticket", async () => {
    const { instance, watcher } = await createWebApp(harness);
    const pdf = ticketPdf([syntheticTicket(), syntheticTicket({ seat: "10", seal: "1122334455667788" })]);

    const read = await instance.request("/tickets/read", upload(pdf));
    const fields = fieldsOf(await read.text());
    const saved = await instance.request("/tickets", post(fields));
    const again = await instance.request("/tickets", post(fields));
    const page = await (await instance.request("/tickets?saved=2")).text();
    const [first] = await watcher.tickets.list();

    expect(read.status).toBe(200);
    expect(fields.filter(([name]) => name === "code").map(([, value]) => value)).toEqual(["00112233AABBCCDD", "1122334455667788"]);
    expect(fields.find(([name]) => name === "total")?.[1]).toBe("14,90");
    expect(saved.headers.get("location")).toBe("/tickets?saved=2");
    expect(again.headers.get("location")).toBe("/tickets?saved=0");
    expect(await watcher.tickets.list()).toHaveLength(2);
    expect(first).toMatchObject({ ...draft, title: "Dune - Parte Tre" });
    expect(page).toContain("2 biglietti salvati.");
    expect([...page.matchAll(/<img src="\/tickets\/[a-z0-9]{12}\/card\.png"/g)]).toHaveLength(2);
    expect(page).toContain("Si elimina da solo dopo lun 28/12");
    expect(page).not.toContain("00112233AABBCCDD");
    expect(await readFile(join(harness.dataDir, "tickets.json"), "utf8")).toContain("00112233AABBCCDD");
  });

  it("takes a PDF of 2 MiB on the upload route only, and refuses one over 10 MB there too", async () => {
    const { instance } = await createWebApp(harness);
    const padded = (megabytes: number): Uint8Array => {
      const pdf = ticketPdf([syntheticTicket()]);
      const bytes = new Uint8Array(megabytes * 1024 * 1024);
      bytes.set(pdf);
      return bytes;
    };

    const accepted = await instance.request("/tickets/read", upload(padded(2)));
    const elsewhere = await instance.request("/tickets", upload(padded(2)));
    const tooLarge = await instance.request("/tickets/read", upload(padded(11)));

    expect(accepted.status).toBe(200);
    expect(fieldsOf(await accepted.text()).some(([name, value]) => name === "code" && value === "00112233AABBCCDD")).toBe(true);
    expect(elsewhere.status).toBe(413);
    expect(tooLarge.status).toBe(413);
  });

  it("says when the file is not a PDF or has no ticket, and offers the fields to fill in by hand", async () => {
    const { instance } = await createWebApp(harness);

    const notPdf = await instance.request("/tickets/read", upload(new TextEncoder().encode("ciao")));
    const other = await instance.request("/tickets/read", upload(new TextEncoder().encode("%PDF-1.4\n%%EOF\n")));
    const missing = await instance.request("/tickets/read", post({ pdf: "testo" }));
    const byHand = await (await instance.request("/tickets/new")).text();

    expect(notPdf.status).toBe(400);
    expect(await notPdf.text()).toContain("Il file non è un PDF.");
    expect(await other.text()).toContain("Nessun biglietto riconosciuto nel PDF");
    expect(missing.status).toBe(400);
    expect(fieldsOf(byHand).map(([name]) => name)).toEqual(["title", "day", "time", "theatre", "address", "room", "sector", "row", "seat", "kind", "total", "order", "code"]);
  });

  it("saves a ticket typed by hand and refuses one without film, day, time or code, keeping what was typed", async () => {
    const { instance, watcher } = await createWebApp(harness);
    const typed = { title: "Hope", day: "2026-12-20", time: "18:00", theatre: "", address: "", room: "Sala 3", sector: "", row: "F", seat: "7", kind: "", total: "", order: "", code: "ABC-123" };

    const refused = await instance.request("/tickets", post({ ...typed, day: "", total: "dieci" }));
    const empty = await instance.request("/tickets", post({}));
    const saved = await instance.request("/tickets", post(typed));

    expect(refused.status).toBe(400);
    expect(await refused.text()).toMatch(/Biglietto 1: controllare film, giorno, ora e codice d&#39;ingresso\.|Biglietto 1: controllare film, giorno, ora e codice d'ingresso\./);
    expect(empty.status).toBe(400);
    expect(saved.headers.get("location")).toBe("/tickets?saved=1");
    expect(await watcher.tickets.list()).toMatchObject([{ title: "Hope", total: null, code: "ABC-123" }]);
  });

  it("serves the card as a PNG that is not cached, and nothing for a ticket it does not have", async () => {
    const { instance, watcher } = await createWebApp(harness);
    const [ticket] = await watcher.tickets.add([draft]);

    const card = await instance.request(`/tickets/${ticket?.id}/card.png`);
    const bytes = new Uint8Array(await card.arrayBuffer());

    expect(card.headers.get("content-type")).toBe("image/png");
    expect(card.headers.get("cache-control")).toBe("private, no-store");
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect((await instance.request("/tickets/zzzzzzzzzzzz/card.png")).status).toBe(404);
    expect((await instance.request("/tickets/NOPE/card.png")).status).toBe(404);
  });

  it("sends the card to the main chat after a confirmation, and deletes a ticket", async () => {
    const { instance, watcher } = await createWebApp(harness);
    const [ticket] = await watcher.tickets.add([draft]);
    const page = await (await instance.request("/tickets")).text();

    const sent = await instance.request(`/tickets/${ticket?.id}/telegram`, post());
    const deleted = await instance.request(`/tickets/${ticket?.id}/delete`, post());

    expect(page).toMatch(/data-confirm="Conferma: la card porta il codice d(&#39;|')ingresso"/);
    expect(sent.headers.get("location")).toBe("/tickets?sent=ok");
    expect(harness.world.telegram.map((call) => [call.method, call.chatId, call.photos])).toEqual([["sendPhoto", PRIMARY_CHAT, 1]]);
    expect(harness.world.telegram[0]?.caption).toContain("<b>Dune: Parte Tre</b>");
    expect(deleted.headers.get("location")).toBe("/tickets?deleted=1");
    expect(await watcher.tickets.list()).toEqual([]);
    expect((await instance.request(`/tickets/${ticket?.id}/telegram`, post())).status).toBe(404);
  });

  it("says when Telegram is not set up instead of sending", async () => {
    const { instance, watcher } = await createWebApp(harness, { mutate: (config) => (config.settings.telegram = { token: null, chatId: null }) });
    const [ticket] = await watcher.tickets.add([draft]);

    const sent = await instance.request(`/tickets/${ticket?.id}/telegram`, post());

    expect(sent.headers.get("location")).toBe("/tickets?sent=fail");
    expect(await (await instance.request("/tickets?sent=fail")).text()).toContain("Invio su Telegram non riuscito.");
  });
});

describe("Google Wallet from the tickets page", () => {
  it("offers the button only with the credentials, and opens the link Google gives after creating the pass", async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    const google: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      bodies.push(typeof init?.body === "string" ? init.body : "");
      return Promise.resolve(new Response(JSON.stringify(url === TOKEN_URL ? { access_token: "token" } : {}), { status: 200 }));
    };
    const { instance, watcher } = await createWebApp(harness, { mutate: (config) => (config.settings.wallet = wallet), fetch: google });
    const [ticket] = await watcher.tickets.add([draft]);

    const page = await (await instance.request("/tickets")).text();
    const opened = await instance.request(`/tickets/${ticket?.id}/wallet`);

    expect(page).toContain(`href="/tickets/${ticket?.id}/wallet" target="_blank" rel="noopener noreferrer"`);
    expect(page).toContain("Il link di Google Wallet vale per chiunque lo apra.");
    expect(page).not.toContain("Google Wallet non configurato.");
    expect(opened.status).toBe(303);
    expect(opened.headers.get("location")?.startsWith(WALLET_SAVE_URL)).toBe(true);
    expect(calls.map((url) => new URL(url).hostname)).toEqual(["oauth2.googleapis.com", "walletobjects.googleapis.com", "walletobjects.googleapis.com"]);
    expect(bodies[1]).toMatch(/"heroImage":\{"sourceUri":\{"uri":"https:\/\/[^"]+"\}\}/);
  });

  it("comes back with the reason when Google refuses, and has no link without the credentials", async () => {
    const refusing: typeof fetch = () => Promise.resolve(new Response("{}", { status: 401 }));
    const configured = await createWebApp(harness, { mutate: (config) => (config.settings.wallet = wallet), fetch: refusing });
    const [ticket] = await configured.watcher.tickets.add([draft]);

    const refused = await configured.instance.request(`/tickets/${ticket?.id}/wallet`);
    const explained = await (await configured.instance.request("/tickets?wallet=auth")).text();

    expect(refused.headers.get("location")).toBe("/tickets?wallet=auth");
    expect(explained).toContain("Google Wallet: Google ha rifiutato il service account.");
  });

  it("answers not found for the link when the credentials are missing", async () => {
    const { instance, watcher } = await createWebApp(harness);
    const [ticket] = await watcher.tickets.add([draft]);

    expect((await instance.request(`/tickets/${ticket?.id}/wallet`)).status).toBe(404);
    expect(await (await instance.request("/tickets")).text()).not.toContain(`/tickets/${ticket?.id}/wallet`);
  });
});

describe("Google Wallet credentials", () => {
  const settingsForm = (overrides: Record<string, string> = {}): Record<string, string> => ({ token: "", chatId: PRIMARY_CHAT, publicUrl: "", interval: "5", quietFrom: "", quietTo: "", digestEnabled: "1", digestTime: "20:00", albumSize: "3", threshold: "10", sellableTypes: "STANDARD", zoneFrom: "", zoneTo: "", zoneCenter: "", ...overrides });
  const keyFile = JSON.stringify({ type: "service_account", client_email: wallet.clientEmail, private_key: wallet.privateKey });

  it("are read from the JSON file of the key, kept when the field stays empty and never written in the page", async () => {
    const { instance, watcher } = await createWebApp(harness);

    const saved = await instance.request("/settings", post(settingsForm({ walletIssuerId: wallet.issuerId, walletKey: keyFile })));
    const kept = await instance.request("/settings", post(settingsForm({ walletIssuerId: "3388000000099999999" })));
    const page = await (await instance.request("/settings")).text();

    expect(saved.status).toBe(303);
    expect(kept.status).toBe(303);
    expect(watcher.config().settings.wallet).toEqual({ ...wallet, issuerId: "3388000000099999999" });
    expect(page).toContain(`Impostata: ${wallet.clientEmail}`);
    expect(page).not.toContain("BEGIN PRIVATE KEY");
    expect((await readFile(join(harness.dataDir, "config.json"), "utf8")).includes("BEGIN PRIVATE KEY")).toBe(true);
  });

  it("are refused next to their field when the key is not the JSON file or the issuer is not a number, and deleted on request", async () => {
    const { instance, watcher } = await createWebApp(harness, { mutate: (config) => (config.settings.wallet = wallet) });

    const badKey = await instance.request("/settings", post(settingsForm({ walletIssuerId: wallet.issuerId, walletKey: "-----BEGIN PRIVATE KEY-----" })));
    const badIssuer = await instance.request("/settings", post(settingsForm({ walletIssuerId: "abc" })));
    const cleared = await instance.request("/settings", post(settingsForm({ walletIssuerId: wallet.issuerId, walletClear: "1" })));

    expect(badKey.status).toBe(400);
    expect(await badKey.text()).toContain("email del service account");
    expect(badIssuer.status).toBe(400);
    expect(await badIssuer.text()).toContain("solo cifre");
    expect(cleared.status).toBe(303);
    expect(watcher.config().settings.wallet).toBeNull();
  });

  it("stay out of an export without secrets, survive an import that does not carry them and are missing in an old config", async () => {
    const { config } = await createWebApp(harness, { mutate: (settings) => (settings.settings.wallet = wallet) });
    const { wallet: dropped, ...oldSettings } = config.settings;

    const exported = exportConfig(config, { includeToken: false });
    const imported = importConfig(config, exported);
    const migrated = parseConfig({ ...config, schemaVersion: 4, settings: oldSettings });
    const badKey = parseConfig({ ...config, settings: { ...config.settings, wallet: { ...wallet, privateKey: "nope" } } });

    expect(dropped).toEqual(wallet);
    expect(exported).not.toContain("PRIVATE KEY");
    expect(exportConfig(config, { includeToken: true })).toContain("PRIVATE KEY");
    expect(imported.ok ? imported.config.settings.wallet : null).toEqual(wallet);
    expect(migrated.ok ? migrated.config.settings.wallet : "failed").toBeNull();
    expect(badKey.ok ? [] : issueLines(badKey.issues, copy.validation)).toEqual(["settings.wallet.privateKey: chiave privata in formato PEM"]);
  });
});

describe("after a hunt is marked as bought", () => {
  it("points to the tickets page from the page of the archived hunt", async () => {
    const { instance, watcher, huntId } = await createWebApp(harness);

    const before = await (await instance.request(`/hunts/${huntId}`)).text();
    await watcher.markBought(huntId);
    const after = await (await instance.request(`/hunts/${huntId}`)).text();

    expect(before).not.toContain("Biglietti acquistati?");
    expect(after).toContain("Biglietti acquistati? Si aggiungono dal PDF dell");
    expect(after).toContain('<a href="/tickets"');
  });
});

describe("real tickets", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const skipped = new Set(["node_modules", "dist", "coverage", "reports", ".stryker-tmp", ".git", ".claude", "fonts", "img"]);
  const REAL_SEALS = new Set(["fa8cf5b62206770cb116a757168dc5ca60b5132a1b6d5b1845e009939b656e7c", "89fc97947c53930595f4f31d81710a2e934e8987bea2b61b3fd995b0a421bb4c", "6b7d12e01089f98aed4bc0d39aab7d193d569b21b5bd0011c2409dffba575598"]);

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return skipped.has(entry) ? [] : files(path);
      return /\.(ts|tsx|js|mjs|json|md|yml|svg|xml|sh|txt|snap)$/.test(entry) && entry !== "package-lock.json" ? [path] : [];
    });
  }

  it("never reach the repository: no order number but the made-up one, no entry code of the real order", () => {
    const found: string[] = [];
    for (const path of files(root)) {
      const text = readFileSync(path, "utf8");
      for (const order of text.match(/UCI\d{8}/g) ?? []) if (order !== SYNTHETIC_ORDER) found.push(`${path}: order number`);
      for (const code of text.match(/\b[0-9A-F]{16}\b/g) ?? []) if (REAL_SEALS.has(createHash("sha256").update(code).digest("hex"))) found.push(`${path}: entry code`);
    }

    expect(found).toEqual([]);
  });
});
