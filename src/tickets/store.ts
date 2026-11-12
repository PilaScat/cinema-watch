import type { createStore } from "../store.js";
import { expired, MAX_TICKETS, showtimeOf, ticketFileSchema, TICKETS_SCHEMA_VERSION, type Ticket, type TicketDraft } from "./model.js";

type Store = ReturnType<typeof createStore>;

const TICKETS_FILE = "tickets.json";
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 12;

export interface TicketStore {
  list(): Promise<Ticket[]>;
  get(id: string): Promise<Ticket | null>;
  add(drafts: TicketDraft[]): Promise<Ticket[]>;
  remove(id: string): Promise<void>;
  prune(): Promise<number>;
}

function newId(random: () => number): string {
  return Array.from({ length: ID_LENGTH }, () => ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)] ?? "a").join("");
}

export function createTicketStore(store: Store, now: () => number, random: () => number = Math.random): TicketStore {
  let queue: Promise<unknown> = Promise.resolve();

  function exclusive<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job);
    queue = run.catch(() => undefined);
    return run;
  }

  async function read(): Promise<Ticket[]> {
    const parsed = ticketFileSchema.safeParse(await store.readJson(TICKETS_FILE).catch(() => null));
    return parsed.success ? parsed.data.tickets : [];
  }

  async function write(tickets: Ticket[]): Promise<void> {
    await store.writeJson(TICKETS_FILE, { version: TICKETS_SCHEMA_VERSION, tickets }, { private: true });
  }

  async function current(): Promise<Ticket[]> {
    const all = await read();
    const kept = all.filter((ticket) => !expired(ticket, now()));
    if (kept.length < all.length) await write(kept);
    return kept.sort((a, b) => showtimeOf(a) - showtimeOf(b) || a.row.localeCompare(b.row) || a.seat.localeCompare(b.seat, undefined, { numeric: true }));
  }

  return {
    list: () => exclusive(current),
    get: (id) => exclusive(async () => (await current()).find((ticket) => ticket.id === id) ?? null),
    add: (drafts) =>
      exclusive(async () => {
        const existing = await current();
        const fresh = drafts.filter((draft) => !existing.some((ticket) => ticket.code === draft.code));
        const added = fresh.map((draft): Ticket => ({ ...draft, id: newId(random), addedAt: now() }));
        await write([...existing, ...added].slice(-MAX_TICKETS));
        return added;
      }),
    remove: (id) =>
      exclusive(async () => {
        const existing = await current();
        await write(existing.filter((ticket) => ticket.id !== id));
      }),
    prune: () =>
      exclusive(async () => {
        const before = (await read()).length;
        return before - (await current()).length;
      }),
  };
}
