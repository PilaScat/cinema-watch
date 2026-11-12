import { z } from "zod";
import { romeMidnight } from "../dates.js";
import type { IsoDay } from "../types.js";

export const TICKETS_SCHEMA_VERSION = 1;
export const TICKET_KEEP_DAYS = 7;
export const MAX_TICKETS = 200;

const DAY_MS = 24 * 60 * 60_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const CODE = /^[\x20-\x7e]{1,200}$/;

function isRealDay(value: string): boolean {
  const match = DAY.exec(value);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const short = (max: number) => z.string().trim().max(max);

export const ticketDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  day: z.string().refine(isRealDay),
  time: z.string().regex(TIME),
  theatre: short(80),
  address: short(120),
  room: short(40),
  sector: short(40),
  row: short(10),
  seat: short(10),
  kind: short(60),
  total: z.number().min(0).max(10_000).nullable(),
  order: short(40),
  code: z.string().regex(CODE),
});

export type TicketDraft = z.infer<typeof ticketDraftSchema>;
export type TicketField = keyof TicketDraft;

export const ticketSchema = ticketDraftSchema.extend({ id: z.string().regex(/^[a-z0-9]{12}$/), addedAt: z.number() });

export type Ticket = z.infer<typeof ticketSchema>;

export const ticketFileSchema = z.strictObject({ version: z.literal(TICKETS_SCHEMA_VERSION), tickets: z.array(ticketSchema).max(MAX_TICKETS) });

export function showtimeOf(ticket: { day: IsoDay; time: string }): number {
  const [hours = 0, minutes = 0] = ticket.time.split(":").map(Number);
  return romeMidnight(ticket.day) + (hours * 60 + minutes) * 60_000;
}

export function expired(ticket: { day: IsoDay; time: string }, now: number): boolean {
  return now > showtimeOf(ticket) + TICKET_KEEP_DAYS * DAY_MS;
}
