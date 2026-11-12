import { escapeHtml, type Formatters } from "../format.js";
import type { Copy } from "../i18n/index.js";
import { svgToPng } from "../png.js";
import { renderTicketCard } from "./card-svg.js";
import type { TicketDraft } from "./model.js";

const CARD_WIDTH = 900;
const SEPARATOR = " · ";

function whenOf(ticket: TicketDraft, format: Formatters): string {
  return `${format.day(ticket.day)} ${ticket.time}`;
}

export function ticketCardPng(ticket: TicketDraft, texts: Copy, format: Formatters): Buffer {
  const svg = renderTicketCard(ticket, { labels: texts.ui.tickets.card, when: whenOf(ticket, format), price: ticket.total === null ? null : format.eur(ticket.total) });
  return svgToPng(svg, { width: CARD_WIDTH });
}

export function ticketCaption(ticket: TicketDraft, texts: Copy, format: Formatters): string {
  const labels = texts.ui.tickets.card;
  const place = [ticket.theatre, ticket.room, ticket.row === "" ? "" : `${labels.row} ${ticket.row}`, ticket.seat === "" ? "" : `${labels.seat} ${ticket.seat}`].filter((part) => part !== "");
  return texts.telegram.ticketCaption(escapeHtml(ticket.title), whenOf(ticket, format), escapeHtml(place.join(SEPARATOR)));
}
