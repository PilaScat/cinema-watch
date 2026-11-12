import type { TicketDraft } from "./model.js";

const SEAL = /^Sigillo Fiscale:\s*(\S+)/;
const ORDER = /^O:\s*(\S+)/;
const DATE = /^Data:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}:\d{2})/;
const PLACE = /^Sala:\s*(.*?),\s*Settore:\s*(.*?),\s*Fila:\s*(.*?),\s*Posto:\s*(.*)$/;
const ROOM_IN_TITLE = /\s+sala\s+(\S+)$/i;
const AMOUNT = /^(\d{1,5})(?:[.,](\d{1,2}))?/;

function valueOf(strings: string[], label: string): string {
  const found = strings.find((text) => text.startsWith(`${label}:`));
  return found === undefined ? "" : found.slice(label.length + 1).trim();
}

function amountOf(text: string): number | null {
  const match = AMOUNT.exec(text);
  if (match === null) return null;
  return Number(`${match[1]}.${(match[2] ?? "0").padEnd(2, "0")}`);
}

function titleWithoutRoom(title: string, room: string): string {
  const suffix = ROOM_IN_TITLE.exec(title);
  if (suffix === null || !room.toLowerCase().split(/\s+/).includes((suffix[1] ?? "").toLowerCase())) return title;
  return title.slice(0, suffix.index).trim();
}

function ticketOf(strings: string[]): TicketDraft | null {
  const seal = strings.map((text) => SEAL.exec(text)).find((match) => match !== null);
  const dateAt = strings.findIndex((text) => DATE.test(text));
  const date = DATE.exec(strings[dateAt] ?? "");
  if (!seal || date === null) return null;
  const place = strings.map((text) => PLACE.exec(text)).find((match) => match !== null);
  const order = strings.map((text) => ORDER.exec(text)).find((match) => match !== null);
  return {
    title: titleWithoutRoom((strings[dateAt - 1] ?? "").trim(), place?.[1]?.trim() ?? ""),
    day: `${date[3]}-${date[2]}-${date[1]}`,
    time: date[4] ?? "",
    theatre: valueOf(strings, "Nome Locale"),
    address: valueOf(strings, "Indirizzo Locale"),
    room: place?.[1]?.trim() ?? "",
    sector: place?.[2]?.trim() ?? "",
    row: place?.[3]?.trim() ?? "",
    seat: place?.[4]?.trim() ?? "",
    kind: valueOf(strings, "Biglietto"),
    total: amountOf(valueOf(strings, "Prezzo Totale")),
    order: order?.[1] ?? "",
    code: seal[1] ?? "",
  };
}

export function parseUciTickets(streams: string[][]): TicketDraft[] {
  return streams.flatMap((strings) => ticketOf(strings) ?? []);
}
