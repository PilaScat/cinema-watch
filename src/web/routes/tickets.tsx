import type { Context, Hono } from "hono";
import { formatters } from "../../format.js";
import { createGuardedFetch } from "../../http.js";
import { copyFor } from "../../i18n/index.js";
import { ticketCaption, ticketCardPng } from "../../tickets/card.js";
import { showtimeOf, TICKET_KEEP_DAYS, ticketDraftSchema, type Ticket, type TicketDraft, type TicketField } from "../../tickets/model.js";
import { PdfError, pdfTextStreams } from "../../tickets/pdf-text.js";
import { parseUciTickets } from "../../tickets/uci.js";
import { normalizeTitle } from "../../uci.js";
import { WALLET_HOSTS, WalletError, walletSaveUrl } from "../../tickets/wallet.js";
import { pageContext, renderPage, type AppDeps, type AppEnv } from "../app.js";
import { ActionForm, Button, buttonClass, Card, cx, Empty, FilePicker, Icon, inputClass, LinkButton, Notice, PageHeader, TextLink, type Tone } from "../components.js";
import { copy, currentLocale, formatDayOf, localized } from "../i18n.js";
import { bodyValues, FormGrid, type FormBody } from "../parts/forms.js";

const ui = localized((all) => all.ui.tickets);
const TICKET_ID = /^[a-z0-9]{12}$/;
const MAX_DRAFTS = 20;
const DAY_MS = 24 * 60 * 60_000;
const EMPTY_DRAFT: DraftValues = { title: "", day: "", time: "", theatre: "", address: "", room: "", sector: "", row: "", seat: "", kind: "", total: "", order: "", code: "" };
const FIELDS: Array<{ name: TicketField; type: "text" | "date" | "time"; wide?: boolean; required?: boolean }> = [
  { name: "title", type: "text", wide: true, required: true },
  { name: "day", type: "date", required: true },
  { name: "time", type: "time", required: true },
  { name: "theatre", type: "text" },
  { name: "address", type: "text" },
  { name: "room", type: "text" },
  { name: "sector", type: "text" },
  { name: "row", type: "text" },
  { name: "seat", type: "text" },
  { name: "kind", type: "text" },
  { name: "total", type: "text" },
  { name: "order", type: "text" },
  { name: "code", type: "text", required: true },
];

type DraftValues = Record<TicketField, string>;

interface PageNotice {
  tone: Tone;
  text: string;
}

function valuesOf(draft: TicketDraft): DraftValues {
  return { ...draft, total: draft.total === null ? "" : draft.total.toFixed(2).replace(".", ",") };
}

function totalOf(text: string): number | null {
  if (text.trim() === "") return null;
  const amount = Number(text.trim().replace(",", "."));
  return Number.isFinite(amount) ? amount : -1;
}

function valuesFromBody(body: FormBody): DraftValues[] {
  const columns = FIELDS.map((field) => ({ name: field.name, values: bodyValues(body, field.name) }));
  const count = Math.min(MAX_DRAFTS, bodyValues(body, "code").length);
  return Array.from({ length: count }, (_unused, index) => {
    const values = { ...EMPTY_DRAFT };
    for (const column of columns) values[column.name] = column.values[index] ?? "";
    return values;
  });
}

function DraftFields(props: { values: DraftValues; index: number }) {
  return (
    <Card title={ui.review.ticket(props.index + 1)}>
      <FormGrid>
        {FIELDS.map((field) => {
          const id = `${field.name}-${props.index}`;
          return (
            <div class={cx("flex min-w-0 flex-col gap-1.5", field.wide && "sm:col-span-2")}>
              <label for={id} class="text-sm font-semibold">
                {ui.fields[field.name]}
              </label>
              <input id={id} name={field.name} type={field.type} value={props.values[field.name]} required={field.required} autocomplete="off" class={inputClass} />
              {field.name === "code" ? <p class="text-xs text-muted">{ui.fields.codeHint}</p> : null}
            </div>
          );
        })}
      </FormGrid>
    </Card>
  );
}

function ReviewPage(props: { drafts: DraftValues[]; notice: PageNotice | null }) {
  return (
    <>
      <PageHeader title={ui.review.title} description={ui.review.description} actions={<LinkButton href="/tickets" label={ui.review.cancel} icon="arrowLeft" variant="outline" />} />
      {props.notice ? <Notice tone={props.notice.tone}>{props.notice.text}</Notice> : null}
      <form method="post" action="/tickets" class="flex flex-col gap-4">
        {props.drafts.map((values, index) => (
          <DraftFields values={values} index={index} />
        ))}
        <div>
          <Button label={ui.review.save} icon="check" variant="primary" />
        </div>
      </form>
    </>
  );
}

function TicketCard(props: { ticket: Ticket; walletReady: boolean }) {
  const { ticket } = props;
  const image = `/tickets/${ticket.id}/card.png`;
  const alt = ui.card.alt(ticket.title, ticket.row, ticket.seat);
  return (
    <Card>
      <img src={image} alt={alt} width="900" height="440" loading="lazy" class="h-auto w-full max-w-2xl rounded-lg" />
      <div class="mt-4 flex flex-wrap items-center gap-2">
        {props.walletReady ? (
          <a href={`/tickets/${ticket.id}/wallet`} target="_blank" rel="noopener noreferrer" class={buttonClass("primary")}>
            <Icon name="wallet" />
            <span>{ui.actions.wallet}</span>
          </a>
        ) : null}
        {props.walletReady ? (
          <>
            <button type="button" data-wallet-link={`/tickets/${ticket.id}/wallet/link`} data-mode="copy" data-done={ui.actions.walletCopied} data-failed={ui.actions.walletLinkFailed} class={buttonClass("outline")}>
              <Icon name="copy" />
              <span data-label>{ui.actions.walletCopy}</span>
            </button>
            <button type="button" hidden data-wallet-link={`/tickets/${ticket.id}/wallet/link`} data-mode="share" data-failed={ui.actions.walletLinkFailed} data-share-title={alt} class={buttonClass("outline")}>
              <Icon name="share2" />
              <span data-label>{ui.actions.walletShare}</span>
            </button>
          </>
        ) : null}
        <a href={image} download={`ticket-${ticket.id}.png`} class={buttonClass("outline")}>
          <Icon name="download" />
          <span>{ui.actions.download}</span>
        </a>
        <button type="button" hidden data-share={image} data-share-title={alt} class={buttonClass("outline")}>
          <Icon name="share2" />
          <span>{ui.actions.share}</span>
        </button>
        <ActionForm action={`/tickets/${ticket.id}/telegram`}>
          <Button label={ui.actions.telegram} icon="send" variant="outline" confirm={ui.actions.confirmTelegram} />
        </ActionForm>
        <ActionForm action={`/tickets/${ticket.id}/delete`}>
          <Button label={ui.actions.delete} icon="trash2" variant="danger" confirm={copy.ui.common.actions.confirmDelete} />
        </ActionForm>
      </div>
      {props.walletReady ? <input type="text" readonly hidden data-wallet-url aria-label={ui.actions.walletCopy} class={cx(inputClass, "mt-3")} /> : null}
      <p class="mt-3 text-xs text-muted">
        {[ui.keptUntil(formatDayOf(showtimeOf(ticket) + TICKET_KEEP_DAYS * DAY_MS)), props.walletReady ? ui.walletNote : ""].filter((part) => part !== "").join(" · ")}
      </p>
    </Card>
  );
}

function noticeOf(c: Context<AppEnv>): PageNotice | null {
  const saved = c.req.query("saved");
  if (saved !== undefined && /^\d{1,3}$/.test(saved)) return saved === "0" ? { tone: "muted", text: ui.notices.alreadySaved } : { tone: "success", text: ui.notices.saved(Number(saved)) };
  const sent = c.req.query("sent");
  if (sent === "ok") return { tone: "success", text: ui.notices.sent };
  if (sent === "fail") return { tone: "danger", text: ui.notices.sendFailed };
  if (c.req.query("deleted") === "1") return { tone: "success", text: ui.notices.deleted };
  const wallet = c.req.query("wallet");
  if (wallet === "key") return { tone: "danger", text: ui.notices.walletKey };
  if (wallet === "auth") return { tone: "danger", text: ui.notices.walletAuth };
  if (wallet === "refused") return { tone: "danger", text: ui.notices.walletRefused };
  if (wallet === "network") return { tone: "danger", text: ui.notices.walletNetwork };
  return null;
}

export function registerTicketsRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const { watcher } = deps;
  const now = deps.now ?? Date.now;
  const walletFetch = createGuardedFetch(WALLET_HOSTS, deps.fetch ?? fetch);

  const review = (c: Context<AppEnv>, drafts: DraftValues[], notice: PageNotice | null, status: 200 | 400 = 200) =>
    renderPage(c, deps, { title: ui.review.title, section: "tickets", status, body: <ReviewPage drafts={drafts} notice={notice} /> });

  async function posterOf(title: string): Promise<string | null> {
    const wanted = normalizeTitle(title);
    const movies = await watcher.services.movies().catch(() => []);
    return movies.find((movie) => normalizeTitle(movie.title) === wanted)?.poster ?? null;
  }

  async function ticketOf(c: Context<AppEnv>): Promise<Ticket | null> {
    const id = c.req.param("id") ?? "";
    return TICKET_ID.test(id) ? watcher.tickets.get(id) : null;
  }

  app.get("/tickets", async (c) => {
    const tickets = await watcher.tickets.list();
    const walletReady = watcher.config().settings.wallet !== null;
    const notice = noticeOf(c);
    return renderPage(c, deps, {
      title: ui.title,
      section: "tickets",
      body: (
        <>
          <PageHeader title={ui.title} description={ui.description} />
          {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
          {walletReady ? null : (
            <Notice tone="muted">
              {ui.walletMissing} <TextLink href="/settings">{ui.walletMissingLink}</TextLink>
            </Notice>
          )}
          <div class="grid gap-4">
            <Card title={ui.upload.title}>
              <form method="post" action="/tickets/read" enctype="multipart/form-data" class="flex flex-col gap-1.5">
                <label for="pdf" class="text-sm font-semibold">
                  {ui.upload.file}
                </label>
                <div class="flex flex-wrap items-center gap-3">
                  <FilePicker id="pdf" name="pdf" accept="application/pdf,.pdf" required choose={copy.ui.common.file.choose} none={copy.ui.common.file.none} />
                  <Button label={ui.upload.button} icon="upload" variant="primary" />
                  <TextLink href="/tickets/new" class="text-sm">
                    {ui.upload.byHand}
                  </TextLink>
                </div>
                <p class="text-xs text-muted">{ui.upload.hint}</p>
              </form>
            </Card>
            {tickets.length === 0 ? <Empty text={ui.empty} hint={ui.emptyHint} /> : tickets.map((ticket) => <TicketCard ticket={ticket} walletReady={walletReady} />)}
          </div>
          <script src="/assets/tickets.js" defer nonce={pageContext(c, deps).nonce}></script>
        </>
      ),
    });
  });

  app.get("/tickets/new", (c) => review(c, [EMPTY_DRAFT], null));

  app.post("/tickets/read", async (c) => {
    const file = (await c.req.parseBody())["pdf"];
    if (!(file instanceof File)) return review(c, [EMPTY_DRAFT], { tone: "danger", text: ui.notices.notPdf }, 400);
    try {
      const drafts = parseUciTickets(pdfTextStreams(new Uint8Array(await file.arrayBuffer()))).slice(0, MAX_DRAFTS);
      if (drafts.length === 0) return review(c, [EMPTY_DRAFT], { tone: "gold", text: ui.notices.nothingRead });
      return review(c, drafts.map(valuesOf), null);
    } catch (error) {
      if (!(error instanceof PdfError)) throw error;
      return review(c, [EMPTY_DRAFT], { tone: "danger", text: error.problem === "tooLarge" ? ui.notices.tooLarge : ui.notices.notPdf }, 400);
    }
  });

  app.post("/tickets", async (c) => {
    const values = valuesFromBody(await c.req.parseBody({ all: true }));
    const parsed = values.map((draft) => ticketDraftSchema.safeParse({ ...draft, total: totalOf(draft.total) }));
    const invalid = parsed.findIndex((result) => !result.success);
    if (values.length === 0 || invalid !== -1) return review(c, values.length === 0 ? [EMPTY_DRAFT] : values, { tone: "danger", text: ui.notices.invalid(Math.max(0, invalid) + 1) }, 400);
    const added = await watcher.tickets.add(parsed.flatMap((result) => (result.success ? [result.data] : [])));
    return c.redirect(`/tickets?saved=${added.length}`, 303);
  });

  app.get("/tickets/:id/card.png", async (c) => {
    const ticket = await ticketOf(c);
    if (ticket === null) return c.notFound();
    const png = ticketCardPng(ticket, copyFor(currentLocale()), formatters(currentLocale()));
    return c.body(new Uint8Array(png), 200, { "content-type": "image/png", "cache-control": "private, no-store" });
  });

  async function walletLink(c: Context<AppEnv>): Promise<{ url: string } | { problem: WalletError["problem"] } | null> {
    const ticket = await ticketOf(c);
    const settings = watcher.config().settings;
    if (ticket === null || settings.wallet === null) return null;
    try {
      const pass = { ticket, language: settings.language, posterUrl: await posterOf(ticket.title) };
      return { url: await walletSaveUrl(pass, settings.wallet, now(), walletFetch) };
    } catch (error) {
      if (!(error instanceof WalletError)) throw error;
      watcher.logger.warn("wallet", { problem: error.problem, status: error.status });
      return { problem: error.problem };
    }
  }

  app.get("/tickets/:id/wallet", async (c) => {
    const link = await walletLink(c);
    if (link === null) return c.notFound();
    return c.redirect("url" in link ? link.url : `/tickets?wallet=${link.problem}`, 303);
  });

  app.get("/tickets/:id/wallet/link", async (c) => {
    const link = await walletLink(c);
    if (link === null) return c.notFound();
    return c.json(link, "url" in link ? 200 : 502, { "cache-control": "private, no-store" });
  });

  app.post("/tickets/:id/telegram", async (c) => {
    const ticket = await ticketOf(c);
    if (ticket === null) return c.notFound();
    const language = watcher.config().settings.language;
    const sent = await watcher.sendPhoto(ticketCardPng(ticket, copyFor(language), formatters(language)), ticketCaption(ticket, copyFor(language), formatters(language)));
    return c.redirect(`/tickets?sent=${sent.ok ? "ok" : "fail"}`, 303);
  });

  app.post("/tickets/:id/delete", async (c) => {
    const ticket = await ticketOf(c);
    if (ticket === null) return c.notFound();
    await watcher.tickets.remove(ticket.id);
    return c.redirect("/tickets?deleted=1", 303);
  });
}
