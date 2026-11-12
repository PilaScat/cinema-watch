import { deflateSync } from "node:zlib";

export interface SyntheticTicket {
  title: string;
  date: string;
  room: string;
  row: string;
  seat: string;
  kind: string;
  total: string;
  theatre: string;
  address: string;
  order: string;
  seal: string;
}

export const SYNTHETIC_ORDER = "UCI00000000";

export function syntheticTicket(overrides: Partial<SyntheticTicket> = {}): SyntheticTicket {
  return {
    title: "Dune - Parte Tre sala IMAX",
    date: "21/12/2026 - 20:20",
    room: "SALA 1 IMAX",
    row: "H",
    seat: "9",
    kind: "Top Intero WEB",
    total: "14,90",
    theatre: "UCI Cinemas Verona",
    address: "S.Giovanni Lupatoto",
    order: SYNTHETIC_ORDER,
    seal: "00112233AABBCCDD",
    ...overrides,
  };
}

function ticketStrings(ticket: SyntheticTicket, index: number, count: number): string[] {
  return [
    "",
    `P: ${index + 1} / ${count}`,
    `O: ${ticket.order}`,
    ticket.title,
    `Data: ${ticket.date}`,
    `Sala: ${ticket.room}, Settore: PLATEA, Fila: ${ticket.row}, Posto: ${ticket.seat}`,
    `Biglietto: ${ticket.kind}`,
    "Prezzo: 13,40 ",
    "Supplemento: 1,50 ",
    `Prezzo Totale: ${ticket.total} `,
    "Tipo Evento: CINEMA",
    "Organizzatore: ESEMPIO (S.P.A.)",
    `Nome Locale: ${ticket.theatre}`,
    `Indirizzo Locale: ${ticket.address}`,
    `Sigillo Fiscale: ${ticket.seal}`,
    "Data Ora Emissione: 01/12/2026 10.00",
  ];
}

function literal(text: string): string {
  return `(${text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")})`;
}

export function contentStream(strings: string[]): string {
  return `BT /F1 10 Tf\n${strings.map((text, index) => (index % 2 === 0 ? `[${literal(text)}] TJ` : `${literal(text)} Tj`)).join("\n")}\nET`;
}

export function pdfOf(objects: Array<{ dictionary: string; data: Uint8Array }>): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n", "latin1")];
  objects.forEach((object, index) => {
    parts.push(Buffer.from(`${index + 1} 0 obj\n<<${object.dictionary}/Length ${object.data.byteLength}>>stream\n`, "latin1"), Buffer.from(object.data), Buffer.from("\nendstream\nendobj\n", "latin1"));
  });
  parts.push(Buffer.from("%%EOF\n", "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}

export function flate(content: string): { dictionary: string; data: Uint8Array } {
  return { dictionary: "/Filter/FlateDecode", data: deflateSync(Buffer.from(content, "latin1")) };
}

export function ticketPdf(tickets: SyntheticTicket[]): Uint8Array {
  const image = { dictionary: "/Type/XObject/Subtype/Image/Width 100/Height 100/Filter/CCITTFaxDecode", data: new Uint8Array([1, 2, 3, 4]) };
  return pdfOf(tickets.flatMap((ticket, index) => [image, flate(contentStream(ticketStrings(ticket, index, tickets.length))), flate(contentStream([ticket.seal]))]));
}
