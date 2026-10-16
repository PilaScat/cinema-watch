import type { Hono } from "hono";
import { romeToday } from "../../dates.js";
import { copy } from "../../copy.js";
import type { EventEntry } from "../../events.js";
import { formatDay, formatTime } from "../../format.js";
import { renderPage, type AppDeps, type AppEnv } from "../app.js";
import { Badge, Button, Card, Empty, inputClass, PageHeader, type Tone } from "../components.js";

const ui = copy.ui.log;
const EVENTS_SHOWN = 500;
const PERFORMANCE_KEY = /^(\d+)-(\d+)$/;
const KIND_TONES: Record<string, Tone> = {
  newShowing: "success",
  seatsFreed: "gold",
  lastSeats: "gold",
  cancelled: "danger",
  moved: "neutral",
  error: "danger",
  telegramError: "danger",
};

function kindLabel(kind: string): string {
  return (ui.kinds as Record<string, string>)[kind] ?? kind;
}

function timeOf(entry: EventEntry): string {
  return `${formatDay(romeToday(new Date(entry.t)))} ${formatTime(entry.t)}`;
}

function showingLink(entry: EventEntry): string | null {
  const match = entry.key === null ? null : PERFORMANCE_KEY.exec(entry.key);
  if (!match) return null;
  const query = entry.huntId === null ? "" : `?${new URLSearchParams({ hunt: entry.huntId }).toString()}`;
  return `/performances/${match[1] ?? ""}/${match[2] ?? ""}${query}`;
}

function Select(props: { name: string; label: string; value: string; options: Array<[string, string]> }) {
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <label for={props.name} class="text-sm font-semibold">
        {props.label}
      </label>
      <select id={props.name} name={props.name} class={inputClass}>
        {props.options.map(([value, label]) => (
          <option value={value} selected={value === props.value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function registerLogRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  app.get("/log", async (c) => {
    const huntFilter = c.req.query("hunt") ?? "";
    const kindFilter = c.req.query("kind") ?? "";
    const hunts = deps.watcher.config().hunts;
    const names = new Map(hunts.map((hunt) => [hunt.id, hunt.name]));
    const all = await deps.watcher.events(EVENTS_SHOWN);
    const entries = all.filter((entry) => (huntFilter === "" || entry.huntId === huntFilter) && (kindFilter === "" || entry.kind === kindFilter));
    const kinds = [...new Set([...Object.keys(ui.kinds), ...all.map((entry) => entry.kind)])];
    return renderPage(c, deps, {
      title: ui.title,
      section: "log",
      body: (
        <>
          <PageHeader title={ui.title} description={ui.description} />
          <Card class="mb-4">
            <form method="get" action="/log" class="grid min-w-0 items-end gap-3 sm:grid-cols-3">
              <Select name="hunt" label={ui.filters.hunt} value={huntFilter} options={[["", ui.filters.all], ...hunts.map((hunt): [string, string] => [hunt.id, hunt.name])]} />
              <Select name="kind" label={ui.filters.kind} value={kindFilter} options={[["", ui.filters.allKinds], ...kinds.map((kind): [string, string] => [kind, kindLabel(kind)])]} />
              <div>
                <Button label={ui.filters.apply} icon="search" variant="outline" />
              </div>
            </form>
          </Card>
          {entries.length === 0 ? (
            <Empty text={ui.empty} />
          ) : (
            <ul class="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
              {entries.map((entry) => {
                const link = showingLink(entry);
                const huntName = entry.huntId === null ? null : (names.get(entry.huntId) ?? ui.deletedHunt);
                return (
                  <li class="grid min-w-0 gap-1 px-4 py-3 text-sm sm:grid-cols-[9rem_12rem_11rem_1fr] sm:gap-3">
                    <span class="text-muted">{timeOf(entry)}</span>
                    <span class="min-w-0 truncate font-semibold">{huntName ?? ""}</span>
                    <span>
                      <Badge tone={KIND_TONES[entry.kind] ?? "muted"}>{kindLabel(entry.kind)}</Badge>
                    </span>
                    <span class="min-w-0 break-words">
                      {entry.detail ?? ""}
                      {link ? (
                        <a href={link} class="ml-2 font-semibold text-primary hover:underline">
                          {ui.openShowing}
                        </a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      ),
    });
  });
}
