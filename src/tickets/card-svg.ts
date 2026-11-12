import qrcode from "qrcode-generator";
import { escapeHtml } from "../format.js";
import type { TicketDraft } from "./model.js";

export interface TicketCardLabels {
  room: string;
  row: string;
  seat: string;
  kind: string;
  order: string;
}

export interface TicketCardOptions {
  labels: TicketCardLabels;
  when: string;
  price: string | null;
}

const WIDTH = 900;
const HEIGHT = 440;
const MARGIN = 40;
const QR_BOX = 280;
const QR_QUIET = 4;
const TITLE_FONT = "Bebas Neue, sans-serif";
const BODY_FONT = "Barlow, sans-serif";
const TITLE_MAX_SIZE = 58;
const TITLE_MIN_SIZE = 30;
const TITLE_WIDTH = WIDTH - QR_BOX - MARGIN * 3;
const TITLE_CHAR_RATIO = 0.42;
const COLOURS = { background: "#121014", surface: "#1c191e", border: "#34303a", text: "#f4efe6", muted: "#a39a90", gold: "#f5c518", primary: "#c0392b", paper: "#ffffff", ink: "#121014" };

function qrPath(value: string, size: number): string {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const count = code.getModuleCount();
  const cell = size / (count + QR_QUIET * 2);
  let path = "";
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (code.isDark(row, column)) path += `M${((column + QR_QUIET) * cell).toFixed(2)} ${((row + QR_QUIET) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
    }
  }
  return path;
}

function text(value: string, x: number, y: number, size: number, fill: string, family = BODY_FONT, weight = 400): string {
  return `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeHtml(value)}</text>`;
}

function titleSize(title: string): number {
  return Math.max(TITLE_MIN_SIZE, Math.min(TITLE_MAX_SIZE, Math.floor(TITLE_WIDTH / (Math.max(1, title.length) * TITLE_CHAR_RATIO))));
}

function clipped(value: string, size: number, width: number, ratio: number): string {
  const fits = Math.floor(width / (size * ratio));
  return value.length <= fits ? value : `${value.slice(0, Math.max(1, fits - 1)).trimEnd()}…`;
}

function field(label: string, value: string, x: number, y: number, width = 190): string {
  if (value === "") return "";
  return text(label.toUpperCase(), x, y, 15, COLOURS.muted, BODY_FONT, 600) + text(clipped(value, 30, width, 0.42), x, y + 34, 30, COLOURS.text, TITLE_FONT);
}

export function renderTicketCard(ticket: TicketDraft, options: TicketCardOptions): string {
  const { labels } = options;
  const size = titleSize(ticket.title);
  const qrX = WIDTH - MARGIN - QR_BOX;
  const qrY = MARGIN + 16;
  const fields = [
    field(labels.room, ticket.room, MARGIN, 250),
    field(labels.row, ticket.row, MARGIN + 220, 250),
    field(labels.seat, ticket.seat, MARGIN + 330, 250),
    field(labels.kind, [ticket.kind, options.price ?? ""].filter((part) => part !== "").join(" · "), MARGIN, 330, TITLE_WIDTH),
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<rect width="${WIDTH}" height="${HEIGHT}" rx="28" fill="${COLOURS.background}"/>`,
    `<rect x="1" y="1" width="${WIDTH - 2}" height="${HEIGHT - 2}" rx="27" fill="${COLOURS.surface}" stroke="${COLOURS.border}" stroke-width="2"/>`,
    `<rect x="${MARGIN}" y="${MARGIN}" width="56" height="6" rx="3" fill="${COLOURS.primary}"/>`,
    text(clipped(ticket.theatre, 20, TITLE_WIDTH, 0.5).toUpperCase(), MARGIN, 84, 20, COLOURS.muted, BODY_FONT, 600),
    text(clipped(ticket.title, size, TITLE_WIDTH, TITLE_CHAR_RATIO), MARGIN, 96 + size, size, COLOURS.text, TITLE_FONT),
    text(options.when, MARGIN, 196, 26, COLOURS.gold, BODY_FONT, 600),
    ...fields,
    ticket.order === "" ? "" : text(`${labels.order} ${ticket.order}`, MARGIN, HEIGHT - MARGIN, 16, COLOURS.muted),
    `<rect x="${qrX}" y="${qrY}" width="${QR_BOX}" height="${QR_BOX}" rx="16" fill="${COLOURS.paper}"/>`,
    `<path transform="translate(${qrX} ${qrY})" fill="${COLOURS.ink}" d="${qrPath(ticket.code, QR_BOX)}"/>`,
    `<text x="${qrX + QR_BOX / 2}" y="${qrY + QR_BOX + 34}" text-anchor="middle" font-family="${BODY_FONT}" font-size="18" font-weight="600" fill="${COLOURS.muted}">${escapeHtml(clipped(ticket.code, 18, QR_BOX, 0.62))}</text>`,
    "</svg>",
  ].join("");
}
