import { createHash } from "node:crypto";
import { sign } from "hono/jwt";
import type { GuardedFetch } from "../http.js";
import type { Locale } from "../i18n/index.js";
import type { TicketDraft } from "./model.js";

export interface WalletCredentials {
  issuerId: string;
  clientEmail: string;
  privateKey: string;
}

export const WALLET_SAVE_URL = "https://pay.google.com/gp/v/save/";
export const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const WALLET_HOSTS = [new URL(WALLET_API).hostname, new URL(TOKEN_URL).hostname];

const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const TOKEN_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

const ISSUER_NAME = "Cinema Watch";
const LOGO_URL = "https://raw.githubusercontent.com/PilaScat/cinema-watch/main/assets/icons/icon-512.png";
const BACKGROUND = "#121014";
const ID_LENGTH = 24;

export type WalletProblem = "key" | "auth" | "refused" | "network";

export class WalletError extends Error {
  override readonly name = "WalletError";

  constructor(
    readonly problem: WalletProblem,
    readonly status: number | null = null,
  ) {
    super(status === null ? problem : `${problem} ${status}`);
  }
}

function idOf(issuerId: string, ...parts: string[]): string {
  return `${issuerId}.cw-${createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, ID_LENGTH)}`;
}

function localized(value: string, language: Locale): { defaultValue: { language: Locale; value: string } } {
  return { defaultValue: { language, value } };
}

function present<T extends Record<string, unknown>>(entries: T): Partial<T> {
  return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function image(uri: string): { sourceUri: { uri: string } } {
  return { sourceUri: { uri } };
}

function walletPayload(ticket: TicketDraft, issuerId: string, language: Locale, posterUrl: string | null) {
  const classId = idOf(issuerId, ticket.title, ticket.day, ticket.time, ticket.theatre, ticket.room);
  const optional = (value: string) => (value === "" ? undefined : localized(value, language));
  const venue = ticket.theatre === "" ? undefined : { name: localized(ticket.theatre, language), address: localized(ticket.address === "" ? ticket.theatre : ticket.address, language) };
  return {
    ticketClass: {
      id: classId,
      ...present({
        issuerName: ISSUER_NAME,
        logo: image(LOGO_URL),
        heroImage: posterUrl === null ? undefined : image(posterUrl),
        reviewStatus: "UNDER_REVIEW",
        eventName: localized(ticket.title, language),
        eventId: classId.slice(issuerId.length + 1),
        venue,
        dateTime: { start: `${ticket.day}T${ticket.time}:00` },
        sectionLabel: "THEATER",
      }),
    },
    ticketObject: {
      id: idOf(issuerId, ticket.code),
      ...present({
        classId,
        state: "ACTIVE",
        hexBackgroundColor: posterUrl === null ? BACKGROUND : undefined,
        barcode: { type: "QR_CODE", value: ticket.code, alternateText: ticket.code },
        seatInfo: present({ section: optional(ticket.room), row: optional(ticket.row), seat: optional(ticket.seat) }),
        ticketType: optional(ticket.kind),
        reservationInfo: ticket.order === "" ? undefined : { confirmationCode: ticket.order },
        faceValue: ticket.total === null ? undefined : { micros: String(Math.round(ticket.total * 1_000_000)), currencyCode: "EUR" },
      }),
    },
  };
}

async function signed(claims: Record<string, unknown>, privateKey: string): Promise<string> {
  try {
    return await sign(claims, privateKey, "RS256");
  } catch {
    throw new WalletError("key");
  }
}

async function call(doFetch: GuardedFetch, url: string, init: RequestInit): Promise<Response> {
  try {
    return await doFetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch {
    throw new WalletError("network");
  }
}

async function accessToken(doFetch: GuardedFetch, credentials: WalletCredentials, now: number): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const assertion = await signed({ iss: credentials.clientEmail, scope: WALLET_SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + TOKEN_SECONDS }, credentials.privateKey);
  const response = await call(doFetch, TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const answer: unknown = await response.json().catch(() => null);
  const token: unknown = typeof answer === "object" && answer !== null ? Reflect.get(answer, "access_token") : undefined;
  if (!response.ok || typeof token !== "string") throw new WalletError("auth", response.status);
  return token;
}

async function upsert(doFetch: GuardedFetch, token: string, kind: "eventTicketClass" | "eventTicketObject", resource: { id: string }): Promise<void> {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const body = JSON.stringify(resource);
  const created = await call(doFetch, `${WALLET_API}/${kind}`, { method: "POST", headers, body });
  if (created.ok) return;
  if (created.status !== 409) throw new WalletError("refused", created.status);
  const updated = await call(doFetch, `${WALLET_API}/${kind}/${encodeURIComponent(resource.id)}`, { method: "PUT", headers, body });
  if (!updated.ok) throw new WalletError("refused", updated.status);
}

export interface WalletPass {
  ticket: TicketDraft;
  language: Locale;
  posterUrl: string | null;
}

export async function walletSaveUrl(pass: WalletPass, credentials: WalletCredentials, now: number, doFetch: GuardedFetch): Promise<string> {
  const posterUrl = pass.posterUrl !== null && pass.posterUrl.startsWith("https://") ? pass.posterUrl : null;
  const payload = walletPayload(pass.ticket, credentials.issuerId, pass.language, posterUrl);
  const token = await accessToken(doFetch, credentials, now);
  await upsert(doFetch, token, "eventTicketClass", payload.ticketClass);
  await upsert(doFetch, token, "eventTicketObject", payload.ticketObject);
  const saved = { id: payload.ticketObject.id, classId: payload.ticketClass.id };
  const claims = { iss: credentials.clientEmail, aud: "google", typ: "savetowallet", iat: Math.floor(now / 1000), origins: [], payload: { eventTicketObjects: [saved] } };
  return `${WALLET_SAVE_URL}${await signed(claims, credentials.privateKey)}`;
}
