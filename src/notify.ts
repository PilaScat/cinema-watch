import { copy } from "./copy.js";
import { escapeHtml, formatDay, formatEur, formatGroup, formatTime } from "./format.js";
import type { Hunt, HuntEvent, InlineButton, OutgoingMessage, SeatSummary, ShowingSnapshot } from "./model.js";

export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;

export type CallbackAction = "refresh" | "mute" | "bought";

export interface ComposeContext {
  hunt: Hunt;
  chats: { primary: string; extra: string[] };
  publicUrl: string | null;
  openAsButton: boolean;
  albumSize: number;
  theatreNames: Record<string, string>;
}

export interface DigestEntry {
  hunt: Hunt;
  showings: ShowingSnapshot[];
  mutedUntil: number | null;
}

const ACTION_PREFIX: Record<CallbackAction, string> = { refresh: "a", mute: "m", bought: "b" };

export function callbackData(action: CallbackAction, huntId: string): string {
  return `${ACTION_PREFIX[action]}:${huntId}`;
}

const ACTION_BY_PREFIX: Record<string, CallbackAction> = { a: "refresh", m: "mute", b: "bought" };

export function parseCallbackData(data: string): { action: CallbackAction; huntId: string } | null {
  const match = /^([amb]):([a-z0-9]{8})$/.exec(data);
  const action = ACTION_BY_PREFIX[match?.[1] ?? ""];
  const huntId = match?.[2];
  return action && huntId ? { action, huntId } : null;
}

interface PhotoCandidate {
  showing: ShowingSnapshot;
  seats: SeatSummary;
  freed: boolean;
}

function candidateOf(showing: ShowingSnapshot, freed: boolean): PhotoCandidate | null {
  return showing.seats ? { showing, seats: showing.seats, freed } : null;
}

function photoCandidate(event: HuntEvent): PhotoCandidate | null {
  switch (event.kind) {
    case "newShowing":
      return candidateOf(event.showing, false);
    case "seatsFreed":
      return candidateOf(event.showing, true);
    case "lastSeats":
      return event.freeInZone > 0 ? candidateOf(event.showing, false) : null;
    case "moved":
      return candidateOf(event.to, false);
    default:
      return null;
  }
}

function comparePhotoCandidates(a: PhotoCandidate, b: PhotoCandidate): number {
  if (a.freed !== b.freed) return a.freed ? -1 : 1;
  const zoneDiff = b.seats.freeInZone - a.seats.freeInZone;
  if (zoneDiff !== 0) return zoneDiff;
  const scoreDiff = (b.seats.best[0]?.score ?? -1) - (a.seats.best[0]?.score ?? -1);
  if (scoreDiff !== 0) return scoreDiff;
  return a.showing.startsAt.localeCompare(b.showing.startsAt);
}

function rankedPhotoShowings(events: HuntEvent[], albumSize: number): ShowingSnapshot[] {
  const ranked = events
    .map(photoCandidate)
    .filter((candidate): candidate is PhotoCandidate => candidate !== null)
    .sort(comparePhotoCandidates);
  const unique = new Map<string, ShowingSnapshot>();
  for (const candidate of ranked) {
    if (!unique.has(candidate.showing.key)) unique.set(candidate.showing.key, candidate.showing);
  }
  return [...unique.values()].slice(0, albumSize);
}

export function selectPhotoKeys(events: HuntEvent[], albumSize: number): string[] {
  return rankedPhotoShowings(events, albumSize).map((showing) => showing.key);
}

const MAX_BUY_BUTTONS = 3;

interface Section {
  title: string;
  items: string[][];
}

type EventOf<K extends HuntEvent["kind"]> = Extract<HuntEvent, { kind: K }>;

function theatreName(slug: string, context: ComposeContext): string {
  return escapeHtml(context.theatreNames[slug] ?? slug);
}

function dayTime(showing: ShowingSnapshot): string {
  return `${formatDay(showing.day)} ${showing.time}`;
}

function seatsPart(showing: ShowingSnapshot): string {
  if (!showing.seats) return copy.telegram.noPlan;
  return copy.telegram.seats(showing.seats.free, showing.seats.freeInZone);
}

function showingLine(showing: ShowingSnapshot, context: ComposeContext, tail: string | null): string {
  const parts = [
    copy.telegram.showingLine(
      formatDay(showing.day),
      showing.time,
      theatreName(showing.theatreSlug, context),
      escapeHtml(showing.room),
      escapeHtml(showing.format),
    ),
  ];
  if (tail !== null) parts.push(tail);
  if (showing.priceFrom !== null) parts.push(copy.telegram.price(formatEur(showing.priceFrom)));
  return parts.join(copy.telegram.separator);
}

function ofKind<K extends HuntEvent["kind"]>(
  events: HuntEvent[],
  kind: K,
  start: (event: EventOf<K>) => ShowingSnapshot,
): Array<EventOf<K>> {
  return events
    .filter((event): event is EventOf<K> => event.kind === kind)
    .sort((a, b) => start(a).startsAt.localeCompare(start(b).startsAt));
}

function buildSections(events: HuntEvent[], context: ComposeContext): Section[] {
  const { sections } = copy.telegram;
  const freed = ofKind(events, "seatsFreed", (event) => event.showing).map((event) => {
    const lines = [showingLine(event.showing, context, seatsPart(event.showing))];
    if (event.groups.length > 0) lines.push(copy.telegram.best(event.groups.map(formatGroup).join(", ")));
    return lines;
  });
  const created = ofKind(events, "newShowing", (event) => event.showing).map((event) => [
    showingLine(event.showing, context, seatsPart(event.showing)),
  ]);
  const lastSeats = ofKind(events, "lastSeats", (event) => event.showing).map((event) => [
    showingLine(event.showing, context, copy.telegram.lastSeats(event.freeInZone)),
  ]);
  const moved = ofKind(events, "moved", (event) => event.to).map((event) => [
    copy.telegram.moved(
      dayTime(event.from),
      dayTime(event.to),
      theatreName(event.to.theatreSlug, context),
      escapeHtml(event.to.room),
    ),
  ]);
  const cancelled = ofKind(events, "cancelled", (event) => event.showing).map((event) => [
    showingLine(event.showing, context, null),
  ]);
  const movies = events
    .filter((event): event is EventOf<"movieAppeared"> => event.kind === "movieAppeared")
    .map((event) => [copy.telegram.movieAppeared(escapeHtml(event.movie.title), theatreName(event.theatreSlug, context))]);
  return [
    { title: sections.freed, items: freed },
    { title: sections.created, items: created },
    { title: sections.lastSeats, items: lastSeats },
    { title: sections.moved, items: moved },
    { title: sections.cancelled, items: cancelled },
    { title: sections.movies, items: movies },
  ].filter((section) => section.items.length > 0);
}

function renderText(sections: Section[], kept: number, header: string, footer: string[], omitted: number): string {
  const lines = [header];
  let remaining = kept;
  for (const section of sections) {
    if (remaining === 0) break;
    const items = section.items.slice(0, remaining);
    remaining -= items.length;
    lines.push("", copy.telegram.sectionTitle(section.title), ...items.flat());
  }
  if (omitted > 0) lines.push(copy.telegram.more(omitted));
  if (footer.length > 0) lines.push("", ...footer);
  return lines.join("\n");
}

function fitText(sections: Section[], header: string, footer: string[]): string {
  const total = sections.reduce((sum, section) => sum + section.items.length, 0);
  let kept = total;
  let text = renderText(sections, kept, header, footer, 0);
  while (text.length > TELEGRAM_TEXT_LIMIT && kept > 0) {
    kept--;
    text = renderText(sections, kept, header, footer, total - kept);
  }
  return text;
}

function hallUrl(showing: ShowingSnapshot, publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, "")}/performances/${showing.localId}/${showing.performanceId}`;
}

function captionFor(showing: ShowingSnapshot): string {
  const characters = Array.from(showing.movieTitle);
  const build = (): string =>
    copy.telegram.caption(
      escapeHtml(characters.join("")),
      formatDay(showing.day),
      showing.time,
      escapeHtml(showing.room),
      escapeHtml(showing.format),
      seatsPart(showing),
    );
  let caption = build();
  while (caption.length > TELEGRAM_CAPTION_LIMIT && characters.length > 0) {
    characters.pop();
    caption = build();
  }
  return caption;
}

function buildKeyboard(
  photos: ShowingSnapshot[],
  context: ComposeContext,
  primary: boolean,
): InlineButton[][] {
  const { buttons } = copy.telegram;
  const huntId = context.hunt.id;
  const refresh: InlineButton = { text: buttons.refresh, callbackData: callbackData("refresh", huntId) };
  const rows: InlineButton[][] = [];
  const buy = photos.slice(0, MAX_BUY_BUTTONS);
  if (buy.length > 0) {
    rows.push(
      buy.map((showing) => ({
        text: buttons.buy(buy.length === 1 ? null : showing.time),
        url: showing.cartUrl,
      })),
    );
  }
  const [first] = photos;
  if (context.publicUrl !== null && context.openAsButton && first) {
    rows.push([{ text: buttons.openHall, url: hallUrl(first, context.publicUrl) }]);
  }
  if (primary) {
    rows.push([
      refresh,
      { text: buttons.mute, callbackData: callbackData("mute", huntId) },
      { text: buttons.bought, callbackData: callbackData("bought", huntId) },
    ]);
  } else {
    rows.push([refresh]);
  }
  return rows;
}

function photoMessages(photos: ShowingSnapshot[], chatId: string): OutgoingMessage[] {
  const [only] = photos;
  if (photos.length === 1 && only) {
    return [{ kind: "photo", chatId, showingKey: only.key, caption: captionFor(only) }];
  }
  if (photos.length > 1) {
    return [
      {
        kind: "album",
        chatId,
        items: photos.map((showing) => ({ showingKey: showing.key, caption: captionFor(showing) })),
      },
    ];
  }
  return [];
}

export function composeRound(events: HuntEvent[], context: ComposeContext): OutgoingMessage[] {
  if (events.length === 0) return [];
  const photos = rankedPhotoShowings(events, context.albumSize);
  const publicUrl = context.publicUrl;
  const footer =
    publicUrl !== null && !context.openAsButton
      ? photos.map((showing) => copy.telegram.openHall(escapeHtml(hallUrl(showing, publicUrl))))
      : [];
  const text = fitText(
    buildSections(events, context),
    copy.telegram.huntHeader(escapeHtml(context.hunt.name)),
    footer,
  );
  const onlyMovies = events.every((event) => event.kind === "movieAppeared");
  const chats = [...new Set([context.chats.primary, ...context.chats.extra])];
  return chats.flatMap((chatId, index): OutgoingMessage[] => [
    ...photoMessages(photos, chatId),
    {
      kind: "text",
      chatId,
      text,
      keyboard: onlyMovies
        ? [[{ text: copy.telegram.buttons.refresh, callbackData: callbackData("refresh", context.hunt.id) }]]
        : buildKeyboard(photos, context, index === 0),
    },
  ]);
}

function digestLine(entry: DigestEntry): string {
  const withSeats = entry.showings.filter((showing) => showing.seats?.ok === true).length;
  const line = copy.telegram.digest.huntLine(escapeHtml(entry.hunt.name), entry.showings.length, withSeats);
  if (entry.mutedUntil === null) return line;
  return `${line}${copy.telegram.separator}${copy.telegram.digest.mutedUntil(formatTime(entry.mutedUntil))}`;
}

function chunkLines(header: string, lines: string[]): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  const render = (body: string[]): string => `${header}\n\n${body.join("\n")}`;
  for (const line of lines) {
    if (current.length > 0 && render([...current, line]).length > TELEGRAM_TEXT_LIMIT) {
      chunks.push(render(current));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) chunks.push(render(current));
  return chunks;
}

export function composeDigest(entries: DigestEntry[]): string[] {
  return chunkLines(copy.telegram.digest.header, entries.map(digestLine));
}

export function composeNoNews(entries: DigestEntry[]): string[] {
  return chunkLines(copy.telegram.noNews.header, entries.map(digestLine));
}
