import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copy } from "../src/copy.js";
import { formatters } from "../src/format.js";
import { createStore } from "../src/store.js";
import { renderTicketCard } from "../src/tickets/card-svg.js";
import { ticketCaption, ticketCardPng } from "../src/tickets/card.js";
import { expired, showtimeOf, ticketDraftSchema, type TicketDraft } from "../src/tickets/model.js";
import { MAX_PDF_BYTES, PdfError, pdfTextStreams } from "../src/tickets/pdf-text.js";
import { createTicketStore } from "../src/tickets/store.js";
import { parseUciTickets } from "../src/tickets/uci.js";
import { TOKEN_URL, WALLET_API, WALLET_SAVE_URL, WalletError, walletSaveUrl, type WalletCredentials } from "../src/tickets/wallet.js";
import { contentStream, flate, pdfOf, syntheticTicket, ticketPdf } from "./support/ticket-pdf.js";

const DAY_MS = 24 * 60 * 60_000;
const draft: TicketDraft = { title: "Dune - Parte Tre", day: "2026-12-21", time: "20:20", theatre: "UCI Cinemas Verona", address: "S.Giovanni Lupatoto", room: "SALA 1 IMAX", sector: "PLATEA", row: "H", seat: "9", kind: "Top Intero WEB", total: 14.9, order: "UCI00000000", code: "00112233AABBCCDD" };

describe("text of a PDF", () => {
  it("reads the strings shown with Tj and TJ, with their escapes, and skips the images", () => {
    const pdf = pdfOf([{ dictionary: "/Subtype/Image/Filter/FlateDecode", data: flate("BT (image) Tj ET").data }, flate("BT\n(plain) Tj\n[(Sala \\(1\\)) -20 ( IMAX)] TJ\n(caf\\351 \\\\ fine) Tj\nET"), flate("q 1 0 0 1 0 0 cm Q")]);

    expect(pdfTextStreams(pdf)).toEqual([["plain", "Sala (1) IMAX", "café \\ fine"]]);
  });

  it("refuses what is not a PDF and what is over 10 MB", () => {
    const problem = (data: Uint8Array): string => {
      try {
        pdfTextStreams(data);
        return "read";
      } catch (error) {
        return error instanceof PdfError ? error.problem : "other";
      }
    };

    expect(problem(new TextEncoder().encode("<html>not a pdf</html>"))).toBe("notPdf");
    expect(problem(new Uint8Array(MAX_PDF_BYTES + 1))).toBe("tooLarge");
    expect(problem(new Uint8Array(0))).toBe("notPdf");
  });

  it("skips a stream that does not inflate or that inflates to more than 2 MB, and goes on with the others", () => {
    const bomb = flate(`BT (${"A".repeat(3 * 1024 * 1024)}) Tj ET`);
    const broken = { dictionary: "/Filter/FlateDecode", data: new Uint8Array([9, 9, 9, 9]) };

    expect(pdfTextStreams(pdfOf([bomb, broken, flate(contentStream(["kept"]))]))).toEqual([["kept"]]);
  });

  it("stops at a PDF with more streams than a ticket order can have", () => {
    const many = pdfOf(Array.from({ length: 2001 }, () => ({ dictionary: "/Subtype/Image", data: new Uint8Array(1) })));

    expect(() => pdfTextStreams(many)).toThrow(PdfError);
  });
});

describe("tickets of a UCI order", () => {
  it("reads one ticket per page with film, day, hall, row, seat, price, order and entry code", () => {
    const pdf = ticketPdf([syntheticTicket(), syntheticTicket({ seat: "10", seal: "1122334455667788" }), syntheticTicket({ seat: "11", seal: "99AABBCCDDEEFF00" })]);

    const tickets = parseUciTickets(pdfTextStreams(pdf));

    expect(tickets).toHaveLength(3);
    expect(tickets[0]).toEqual(draft);
    expect(tickets.map((ticket) => `${ticket.row} ${ticket.seat} ${ticket.code}`)).toEqual(["H 9 00112233AABBCCDD", "H 10 1122334455667788", "H 11 99AABBCCDDEEFF00"]);
    expect(tickets.every((ticket) => ticketDraftSchema.safeParse(ticket).success)).toBe(true);
  });

  it("drops the hall from the end of the title when the hall says it already, and only then", () => {
    const titleOf = (title: string, room: string): string => parseUciTickets(pdfTextStreams(ticketPdf([syntheticTicket({ title, room })])))[0]?.title ?? "";

    expect(titleOf("Dune - Parte Tre sala IMAX", "SALA 1 IMAX")).toBe("Dune - Parte Tre");
    expect(titleOf("Dune - Parte Tre Sala imax", "SALA 1 IMAX")).toBe("Dune - Parte Tre");
    expect(titleOf("Dune - Parte Tre sala IMAX", "SALA 05")).toBe("Dune - Parte Tre sala IMAX");
    expect(titleOf("La sala professori", "SALA 3")).toBe("La sala professori");
    expect(titleOf("Avengers sala XL", "SALA 07 XL")).toBe("Avengers");
  });

  it("finds no ticket in a PDF that is something else, and leaves a missing price empty", () => {
    const other = pdfOf([flate(contentStream(["Fattura n. 12", "Totale: 30,00"]))]);
    const [free] = parseUciTickets(pdfTextStreams(ticketPdf([syntheticTicket({ total: "" })])));

    expect(parseUciTickets(pdfTextStreams(other))).toEqual([]);
    expect(free?.total).toBeNull();
  });
});

describe("how long a ticket is kept", () => {
  it("is a week after the showing, on the time in Rome", () => {
    const showtime = showtimeOf(draft);

    expect(new Date(showtime).toISOString()).toBe("2026-12-21T19:20:00.000Z");
    expect(expired(draft, showtime + 7 * DAY_MS)).toBe(false);
    expect(expired(draft, showtime + 7 * DAY_MS + 1)).toBe(true);
  });

  it("refuses a ticket without film, day, time or entry code, and one with a code that is not plain text", () => {
    const valid = (changes: Partial<TicketDraft>): boolean => ticketDraftSchema.safeParse({ ...draft, ...changes }).success;

    expect(valid({})).toBe(true);
    expect(valid({ title: " " })).toBe(false);
    expect(valid({ day: "2026-02-30" })).toBe(false);
    expect(valid({ time: "25:00" })).toBe(false);
    expect(valid({ code: "" })).toBe(false);
    expect(valid({ code: "riga\nnuova" })).toBe(false);
    expect(valid({ total: -1 })).toBe(false);
    expect(valid({ total: null, theatre: "", room: "" })).toBe(true);
  });
});

describe("saved tickets", () => {
  let dir: string;
  let clock: number;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cw-tickets-"));
    clock = Date.parse("2026-12-01T10:00:00Z");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const tickets = () => createTicketStore(createStore(dir), () => clock);

  it("keeps them in a private file, in showing order, without saving the same entry code twice", async () => {
    const store = tickets();

    const first = await store.add([{ ...draft, seat: "10", code: "B" }, { ...draft, code: "A" }]);
    const again = await store.add([{ ...draft, code: "A" }, { ...draft, day: "2026-12-10", code: "C" }]);

    expect(first.map((ticket) => ticket.id)).toEqual([expect.stringMatching(/^[a-z0-9]{12}$/), expect.stringMatching(/^[a-z0-9]{12}$/)]);
    expect(again.map((ticket) => ticket.code)).toEqual(["C"]);
    expect((await store.list()).map((ticket) => ticket.code)).toEqual(["C", "A", "B"]);
    expect(await store.get(first[0]?.id ?? "")).toMatchObject({ code: "B" });
    expect(await store.get("zzzzzzzzzzzz")).toBeNull();
    if (process.platform !== "win32") expect((await stat(join(dir, "tickets.json"))).mode & 0o777).toBe(0o600);
  });

  it("deletes one on request and the old ones on their own, a week after the showing", async () => {
    const store = tickets();
    const [kept, removed] = await store.add([{ ...draft, code: "A" }, { ...draft, code: "B" }]);
    await store.add([{ ...draft, day: "2026-12-02", code: "OLD" }]);

    await store.remove(removed?.id ?? "");
    clock = Date.parse("2026-12-10T10:00:00Z");
    const pruned = await store.prune();

    expect(pruned).toBe(1);
    expect((await store.list()).map((ticket) => ticket.id)).toEqual([kept?.id]);
    expect(await readFile(join(dir, "tickets.json"), "utf8")).not.toContain("OLD");
  });

  it("starts from no tickets when the file is missing or is not what it wrote", async () => {
    const store = tickets();
    await writeFile(join(dir, "tickets.json"), JSON.stringify({ version: 99, tickets: [{ nope: true }] }));

    expect(await store.list()).toEqual([]);
    expect(await store.prune()).toBe(0);
  });
});

describe("card of a ticket", () => {
  it("carries film, day, hall, row, seat and the entry code as a QR code and as text", () => {
    const svg = renderTicketCard(draft, { labels: copy.ui.tickets.card, when: "lun 21/12 20:20", price: "14,90 €" });

    for (const text of ["UCI CINEMAS VERONA", "Dune - Parte Tre", "lun 21/12 20:20", "SALA 1 IMAX", ">H<", ">9<", "Top Intero WEB · 14,90 €", "Ordine UCI00000000", ">00112233AABBCCDD<"]) expect(svg).toContain(text);
    expect(svg).toMatch(/<path transform="translate\(\d+ \d+\)" fill="#121014" d="M[\d. ]+h[\d.]+v[\d.]+h-[\d.]+z/);
  });

  it("escapes what comes from the PDF, shortens what does not fit and leaves out what is empty", () => {
    const svg = renderTicketCard({ ...draft, title: `<script>${"x".repeat(150)}`, order: "", row: "", kind: "", total: null }, { labels: copy.ui.tickets.card, when: "", price: null });

    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("…</text>");
    expect(svg).not.toContain("Ordine");
    expect(svg).not.toContain(">FILA<");
  });

  it("becomes a PNG and a caption in the language asked for", () => {
    const png = ticketCardPng(draft, copy, formatters("it"));

    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(ticketCaption({ ...draft, title: "A & B" }, copy, formatters("it"))).toBe("🎟 <b>A &amp; B</b>\nlun 21/12 20:20\nUCI Cinemas Verona · SALA 1 IMAX · Fila H · Posto 9");
  });
});

describe("Google Wallet link", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const credentials: WalletCredentials = { issuerId: "3388000000012345678", clientEmail: "cinema-watch@example-project.iam.gserviceaccount.com", privateKey: pair.privateKey };
  const now = Date.parse("2026-12-01T10:00:00Z");

  interface Call {
    method: string;
    url: string;
    body: string;
    authorization: string | null;
  }

  function google(statuses: Record<string, number> = {}) {
    const calls: Call[] = [];
    const doFetch = (url: string, init: RequestInit = {}): Promise<Response> => {
      const method = init.method ?? "GET";
      calls.push({ method, url, body: typeof init.body === "string" ? init.body : "", authorization: new Headers(init.headers).get("authorization") });
      const status = statuses[`${method} ${url}`] ?? 200;
      return Promise.resolve(new Response(JSON.stringify(url === TOKEN_URL ? { access_token: "token-1" } : {}), { status }));
    };
    return { calls, doFetch };
  }

  function claimsOf(jwt: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
  }

  function problemOf(error: unknown): string {
    return error instanceof WalletError ? `${error.problem} ${error.status ?? ""}`.trim() : "other";
  }

  it("creates the pass at Google and gives a short link signed with the key, that names the pass only", async () => {
    const { calls, doFetch } = google();

    const url = await walletSaveUrl({ ticket: draft, language: "it", posterUrl: "https://storage.googleapis.com/posters/dune.jpg" }, credentials, now, doFetch);
    const jwt = url.slice(WALLET_SAVE_URL.length);
    const [header = "", payload = "", signature = ""] = jwt.split(".");
    const [, ticketClass, ticketObject] = calls.map((call) => (call.body.startsWith("{") ? (JSON.parse(call.body) as Record<string, unknown>) : {}));

    expect(url.startsWith(WALLET_SAVE_URL)).toBe(true);
    expect(jwt.length).toBeLessThan(1800);
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), createPublicKey(pair.publicKey), Buffer.from(signature, "base64url"))).toBe(true);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`POST ${TOKEN_URL}`, `POST ${WALLET_API}/eventTicketClass`, `POST ${WALLET_API}/eventTicketObject`]);
    expect(calls.slice(1).map((call) => call.authorization)).toEqual(["Bearer token-1", "Bearer token-1"]);
    expect(claimsOf(new URLSearchParams(calls[0]?.body).get("assertion") ?? "")).toMatchObject({ iss: credentials.clientEmail, aud: TOKEN_URL, scope: "https://www.googleapis.com/auth/wallet_object.issuer" });
    expect(ticketClass).toMatchObject({ issuerName: "Cinema Watch", logo: { sourceUri: { uri: expect.stringMatching(/^https:\/\/raw\.githubusercontent\.com\/PilaScat\/cinema-watch\/main\/assets\/icons\/icon-512\.png$/) as unknown } }, heroImage: { sourceUri: { uri: "https://storage.googleapis.com/posters/dune.jpg" } }, reviewStatus: "UNDER_REVIEW", eventName: { defaultValue: { language: "it", value: draft.title } }, dateTime: { start: "2026-12-21T20:20:00" }, venue: { name: { defaultValue: { value: "UCI Cinemas Verona" } } } });
    expect(ticketObject).toMatchObject({ classId: ticketClass?.["id"], state: "ACTIVE", barcode: { type: "QR_CODE", value: draft.code }, seatInfo: { row: { defaultValue: { value: "H" } }, seat: { defaultValue: { value: "9" } } }, faceValue: { micros: "14900000", currencyCode: "EUR" } });
    expect(ticketObject).not.toHaveProperty("hexBackgroundColor");
    expect(String(ticketObject?.["id"])).toMatch(/^3388000000012345678\.cw-[0-9a-f]{24}$/);
    expect(claimsOf(jwt)).toMatchObject({ iss: credentials.clientEmail, aud: "google", typ: "savetowallet", payload: { eventTicketObjects: [{ id: ticketObject?.["id"], classId: ticketClass?.["id"] }] } });
    expect(JSON.stringify(claimsOf(jwt))).not.toContain(draft.code);
  });

  it("updates a pass that Google already has, and leaves out what the ticket does not say", async () => {
    const { calls, doFetch } = google({ [`POST ${WALLET_API}/eventTicketClass`]: 409, [`POST ${WALLET_API}/eventTicketObject`]: 409 });

    await walletSaveUrl({ ticket: { ...draft, theatre: "", room: "", row: "", seat: "", kind: "", order: "", total: null }, language: "en", posterUrl: "http://plain.example/poster.jpg" }, credentials, now, doFetch);
    const puts = calls.filter((call) => call.method === "PUT");
    const bodies = puts.map((call) => JSON.parse(call.body) as Record<string, unknown>);

    expect(puts.map((call) => call.url.slice(0, call.url.lastIndexOf("/")))).toEqual([`${WALLET_API}/eventTicketClass`, `${WALLET_API}/eventTicketObject`]);
    expect(bodies[0]).not.toHaveProperty("venue");
    expect(bodies[0]).not.toHaveProperty("heroImage");
    expect(bodies[1]).toMatchObject({ hexBackgroundColor: "#121014" });
    expect(bodies[1]).toMatchObject({ seatInfo: {} });
    for (const key of ["ticketType", "reservationInfo", "faceValue"]) expect(bodies[1]).not.toHaveProperty(key);
  });

  it("says what went wrong: a key that does not sign, a refused account, a refused ticket, no answer", async () => {
    const failing = async (run: () => Promise<string>): Promise<string> => run().then(() => "saved", problemOf);
    const down = (): Promise<Response> => Promise.reject(new Error("offline"));
    const pass = { ticket: draft, language: "it" as const, posterUrl: null };

    expect(await failing(() => walletSaveUrl(pass, { ...credentials, privateKey: "not a key" }, now, google().doFetch))).toBe("key");
    expect(await failing(() => walletSaveUrl(pass, credentials, now, google({ [`POST ${TOKEN_URL}`]: 401 }).doFetch))).toBe("auth 401");
    expect(await failing(() => walletSaveUrl(pass, credentials, now, google({ [`POST ${WALLET_API}/eventTicketClass`]: 400 }).doFetch))).toBe("refused 400");
    expect(await failing(() => walletSaveUrl(pass, credentials, now, google({ [`POST ${WALLET_API}/eventTicketObject`]: 403 }).doFetch))).toBe("refused 403");
    expect(await failing(() => walletSaveUrl(pass, credentials, now, down))).toBe("network");
  });
});
