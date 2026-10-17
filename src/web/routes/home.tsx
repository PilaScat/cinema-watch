import type { Hono } from "hono";
import { copy } from "../../copy.js";
import { formatDay, formatTime } from "../../format.js";
import type { Hunt, HuntState } from "../../model.js";
import { backTo, renderPage, type AppDeps, type AppEnv } from "../app.js";
import { ActionForm, Badge, Button, Card, Empty, LinkButton, Notice, PageHeader, type Tone } from "../components.js";
import { windowEnded } from "../../watcher-rules.js";

const MUTE_MS = 24 * 60 * 60_000;

function windowText(hunt: Hunt): string {
  const ui = copy.ui.home;
  return hunt.window.kind === "fixed" ? ui.windowFixed(formatDay(hunt.window.from), formatDay(hunt.window.to)) : ui.windowNext(hunt.window.days);
}

function stateBadge(hunt: Hunt, state: HuntState | undefined, now: number): { tone: Tone; text: string } {
  const ui = copy.ui.common.states;
  if (hunt.archivedAt !== null) return { tone: "muted", text: ui.archived };
  if (!hunt.enabled) return { tone: "muted", text: ui.paused };
  if (state?.mutedUntil && state.mutedUntil > now) return { tone: "gold", text: ui.muted(formatTime(state.mutedUntil)) };
  if (state?.lastRun && !state.lastRun.ok) return { tone: "danger", text: ui.failed };
  return { tone: "success", text: ui.active };
}

function HuntCard(props: { hunt: Hunt; state: HuntState | undefined; theatres: Record<string, string>; now: number }) {
  const { hunt, state, now } = props;
  const ui = copy.ui.home;
  const actions = copy.ui.common.actions;
  const showings = Object.values(state?.showings ?? {});
  const withSeats = showings.filter((showing) => showing.seats?.ok === true).length;
  const badge = stateBadge(hunt, state, now);
  const muted = state?.mutedUntil !== undefined && state.mutedUntil !== null && state.mutedUntil > now;
  const pending = state?.pendingMovieSlugs.length ?? 0;
  const active = hunt.enabled && hunt.archivedAt === null;
  return (
    <Card>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <a href={`/hunts/${hunt.id}`} class="font-display text-2xl tracking-wide hover:text-primary">
              {hunt.name}
            </a>
            <Badge tone={badge.tone}>{badge.text}</Badge>
          </div>
          <p class="mt-1 text-sm text-muted">
            {[hunt.theatres.map((slug) => props.theatres[slug] ?? slug).join(", "), hunt.formats.length > 0 ? hunt.formats.join(", ") : ui.allFormats, windowText(hunt)].join(" · ")}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          {active ? (
            <ActionForm action={`/hunts/${hunt.id}/refresh`}>
              <Button label={actions.refresh} icon="refreshCw" size="sm" />
            </ActionForm>
          ) : null}
          {active ? (
            <ActionForm action={`/hunts/${hunt.id}/${muted ? "resume" : "mute"}`}>
              <Button label={muted ? actions.resume : actions.mute} icon={muted ? "bell" : "bellOff"} size="icon" variant="outline" />
            </ActionForm>
          ) : null}
          {hunt.archivedAt !== null ? (
            <ActionForm action={`/hunts/${hunt.id}/restore`}>
              <Button label={ui.restore} icon="refreshCw" size="sm" variant="outline" />
            </ActionForm>
          ) : null}
          <LinkButton href={`/hunts/${hunt.id}`} label={actions.edit} icon="pencil" size="icon" variant="outline" />
        </div>
      </div>
      <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>{ui.showings(showings.length)}</span>
        <span class={withSeats > 0 ? "font-semibold text-gold" : "text-muted"}>{ui.withSeats(withSeats)}</span>
        {state?.lastRun ? <span class="text-muted">{ui.lastRun(formatTime(state.lastRun.at))}</span> : null}
        {active && state?.nextRunAt ? <span class="text-muted">{ui.nextRun(formatTime(state.nextRunAt))}</span> : null}
      </div>
      {pending > 0 ? (
        <a href={`/hunts/${hunt.id}`} class="mt-3 inline-block">
          <Badge tone="gold">{ui.pendingMovies(pending)}</Badge>
        </a>
      ) : null}
    </Card>
  );
}

export function registerHomeRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const now = deps.now ?? Date.now;

  app.get("/", async (c) => {
    const ui = copy.ui.home;
    const config = deps.watcher.config();
    const state = deps.watcher.state();
    let theatres: Record<string, string> = {};
    try {
      theatres = Object.fromEntries((await deps.watcher.services.theatres()).map((theatre) => [theatre.slug, theatre.name]));
    } catch {
      theatres = {};
    }
    const current = config.hunts.filter((hunt) => hunt.archivedAt === null);
    const archived = config.hunts.filter((hunt) => hunt.archivedAt !== null);
    const telegramReady = deps.watcher.telegramConfigured();
    return renderPage(c, deps, {
      title: ui.title,
      section: "hunts",
      body: (
        <>
          <PageHeader
            title={ui.title}
            description={ui.description}
            actions={
              <>
                {current.length > 0 ? (
                  <ActionForm action="/hunts/refresh">
                    <Button label={ui.refreshAll} icon="refreshCw" />
                  </ActionForm>
                ) : null}
                <LinkButton href="/hunts/new" label={ui.addHunt} icon="plus" variant="primary" />
              </>
            }
          />
          {telegramReady ? null : (
            <Notice>
              {ui.telegramMissing}{" "}
              <a href="/settings" class="font-semibold underline">
                {ui.telegramMissingLink}
              </a>
            </Notice>
          )}
          {current.length === 0 ? (
            <Empty text={ui.empty} hint={ui.emptyHint} />
          ) : (
            <div class="grid gap-4">
              {current.map((hunt) => (
                <HuntCard hunt={hunt} state={state.hunts[hunt.id]} theatres={theatres} now={now()} />
              ))}
            </div>
          )}
          {archived.length > 0 ? (
            <details class="mt-8">
              <summary class="cursor-pointer font-display text-2xl tracking-wide text-muted">{ui.archived}</summary>
              <div class="mt-4 grid gap-4">
                {archived.map((hunt) => (
                  <HuntCard hunt={hunt} state={state.hunts[hunt.id]} theatres={theatres} now={now()} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ),
    });
  });

  app.post("/hunts/refresh", async (c) => {
    await deps.watcher.runNow();
    return backTo(c);
  });

  app.post("/hunts/:id/restore", async (c) => {
    const id = c.req.param("id");
    const hunt = deps.watcher.huntById(id);
    if (hunt === null) return c.notFound();
    if (windowEnded(hunt, (deps.now ?? Date.now)())) return c.redirect(`/hunts/${id}?restore=dates`, 303);
    await deps.watcher.restore(id);
    return c.redirect(`/hunts/${id}`, 303);
  });

  app.post("/hunts/:id/:action{(refresh|mute|resume|bought)}", async (c) => {
    const id = c.req.param("id");
    if (deps.watcher.huntById(id) === null) return c.notFound();
    const action = c.req.param("action");
    if (action === "refresh") await deps.watcher.runNow(id);
    if (action === "mute") await deps.watcher.mute(id, MUTE_MS);
    if (action === "resume") await deps.watcher.resume(id);
    if (action === "bought") await deps.watcher.markBought(id);
    return backTo(c);
  });
}
