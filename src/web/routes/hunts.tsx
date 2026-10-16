import type { Hono } from "hono";
import { raw } from "hono/html";
import { createHunt } from "../../config.js";
import { copy } from "../../copy.js";
import { formatDay } from "../../format.js";
import { renderHallSvg } from "../../hall-svg.js";
import type { Config, Hunt, HuntState, NotifyFlags } from "../../model.js";
import type { Theatre } from "../../types.js";
import { pageContext, renderPage, type AppDeps, type AppEnv } from "../app.js";
import { ActionForm, Badge, Button, Card, Field, inputClass, LinkButton, Notice, PageHeader } from "../components.js";
import {
  absoluteSummary,
  bodyText,
  bodyValues,
  CheckBox,
  FormGrid,
  Group,
  noErrors,
  nullableNumber,
  numberOf,
  optionalText,
  Radio,
  splitErrors,
  splitList,
  TextField,
  Wide,
  zoneFromValues,
  zoneValuesFromBody,
  zoneValuesOf,
  ZoneFields,
  type FieldErrors,
  type FormBody,
  type ZoneValues,
} from "../parts/forms.js";
import { HUNT_ID } from "./home.js";
import { listedMovies, MAX_MOVIE_THEATRES, type ListedMovie } from "../parts/movies.js";
import { movieTitleFor } from "../parts/titles.js";

type PageContext = Parameters<typeof renderPage>[0];

const ui = copy.ui.hunts;
const common = copy.ui.common;
const NOTIFY_KEYS: Array<keyof NotifyFlags> = ["newShowings", "seatsFreed", "lastSeats", "cancelled", "moved", "movieAppeared", "digest"];
const SLUG = /^[a-z0-9-]+$/;
const HALL_KEY = /^\d+-\d+$/;
const PERFORMANCE = /^(\d+)-(\d+)$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DAYS = "30";

interface HuntValues {
  name: string;
  theatres: string[];
  theatreText: string;
  movieKind: "listed" | "slug" | "title";
  movieListed: string;
  movieSlugs: string;
  movieWords: string;
  formats: string[];
  windowKind: "fixed" | "next";
  windowFrom: string;
  windowTo: string;
  windowDays: string;
  timeFrom: string;
  timeTo: string;
  weekdays: string[];
  languages: string;
  together: string;
  zone: ZoneValues;
  interval: string;
  threshold: string;
  notify: string[];
  extraChats: string;
  enabled: boolean;
}

function splitWords(text: string): string[] {
  return text.split(/[\s,]+/).filter((word) => word !== "");
}

function valuesOfHunt(hunt: Hunt): HuntValues {
  return {
    name: hunt.name,
    theatres: hunt.theatres,
    theatreText: "",
    movieKind: hunt.movie.kind,
    movieListed: "",
    movieSlugs: hunt.movie.kind === "slug" ? hunt.movie.slugs.join(", ") : "",
    movieWords: hunt.movie.kind === "title" ? hunt.movie.words.join(" ") : "",
    formats: hunt.formats,
    windowKind: hunt.window.kind,
    windowFrom: hunt.window.kind === "fixed" ? hunt.window.from : "",
    windowTo: hunt.window.kind === "fixed" ? hunt.window.to : "",
    windowDays: hunt.window.kind === "next" ? String(hunt.window.days) : DEFAULT_DAYS,
    timeFrom: hunt.timeFrom ?? "",
    timeTo: hunt.timeTo ?? "",
    weekdays: (hunt.weekdays ?? []).map(String),
    languages: (hunt.languages ?? []).join(", "),
    together: String(hunt.together),
    zone: zoneValuesOf(hunt.zone),
    interval: hunt.intervalMinutes === null ? "" : String(hunt.intervalMinutes),
    threshold: String(hunt.lastSeatsThreshold),
    notify: NOTIFY_KEYS.filter((key) => hunt.notify[key]),
    extraChats: hunt.extraChatIds.join("\n"),
    enabled: hunt.enabled,
  };
}

function movieKindOf(text: string): HuntValues["movieKind"] {
  if (text === "slug" || text === "title") return text;
  return "listed";
}

function preferListed(values: HuntValues, movies: ListedMovie[] | null): HuntValues {
  if (values.movieKind !== "slug") return values;
  const slugs = splitWords(values.movieSlugs);
  if (slugs.length === 0) return { ...values, movieKind: "listed" };
  const [slug] = slugs;
  if (slugs.length === 1 && movies?.some((movie) => movie.slug === slug)) return { ...values, movieKind: "listed", movieListed: slug ?? "", movieSlugs: "" };
  return values;
}

function valuesOfBody(body: FormBody): HuntValues {
  return {
    name: bodyText(body, "name"),
    theatres: bodyValues(body, "theatre"),
    theatreText: bodyText(body, "theatreText"),
    movieKind: movieKindOf(bodyText(body, "movieKind")),
    movieListed: bodyText(body, "movieListed"),
    movieSlugs: bodyText(body, "movieSlugs"),
    movieWords: bodyText(body, "movieWords"),
    formats: bodyValues(body, "format"),
    windowKind: bodyText(body, "windowKind") === "fixed" ? "fixed" : "next",
    windowFrom: bodyText(body, "windowFrom"),
    windowTo: bodyText(body, "windowTo"),
    windowDays: bodyText(body, "windowDays"),
    timeFrom: bodyText(body, "timeFrom"),
    timeTo: bodyText(body, "timeTo"),
    weekdays: bodyValues(body, "weekday"),
    languages: bodyText(body, "languages"),
    together: bodyText(body, "together"),
    zone: zoneValuesFromBody(body, "zone"),
    interval: bodyText(body, "interval"),
    threshold: bodyText(body, "threshold"),
    notify: bodyValues(body, "notify"),
    extraChats: bodyText(body, "extraChats"),
    enabled: bodyValues(body, "enabled").length > 0,
  };
}

function valuesOfQuery(base: Hunt, query: Record<string, string>): HuntValues {
  const values = valuesOfHunt(base);
  const from = query["from"] ?? "";
  const to = query["to"] ?? "";
  return {
    ...values,
    theatres: query["theatre"] ? [query["theatre"]] : values.theatres,
    movieSlugs: query["movie"] ?? values.movieSlugs,
    formats: query["format"] ? [query["format"]] : values.formats,
    ...(ISO_DAY.test(from) && ISO_DAY.test(to) ? { windowKind: "fixed" as const, windowFrom: from, windowTo: to } : {}),
  };
}

function huntOfValues(values: HuntValues, base: Hunt): Hunt {
  const notify = Object.fromEntries(NOTIFY_KEYS.map((key) => [key, values.notify.includes(key)])) as unknown as NotifyFlags;
  const languages = splitList(values.languages);
  return {
    ...base,
    name: values.name,
    enabled: values.enabled,
    theatres: [...values.theatres, ...splitList(values.theatreText)],
    movie:
      values.movieKind === "listed"
        ? { kind: "slug", slugs: splitWords(values.movieListed) }
        : values.movieKind === "slug"
          ? { kind: "slug", slugs: splitWords(values.movieSlugs) }
          : { kind: "title", words: splitWords(values.movieWords), confirmedSlugs: base.movie.kind === "title" ? base.movie.confirmedSlugs : [] },
    formats: values.formats,
    window:
      values.windowKind === "fixed"
        ? { kind: "fixed", from: values.windowFrom, to: values.windowTo }
        : { kind: "next", days: numberOf(values.windowDays) },
    timeFrom: optionalText(values.timeFrom),
    timeTo: optionalText(values.timeTo),
    weekdays: values.weekdays.length > 0 ? values.weekdays.map(Number) : null,
    languages: languages.length > 0 ? languages : null,
    zone: zoneFromValues(values.zone, base.zone),
    together: numberOf(values.together),
    intervalMinutes: nullableNumber(values.interval),
    lastSeatsThreshold: numberOf(values.threshold),
    notify,
    extraChatIds: splitList(values.extraChats),
  };
}

const HUNT_FIELDS: Record<string, string> = {
  name: "name",
  theatres: "theatres",
  movie: "movie",
  formats: "formats",
  timeFrom: "timeFrom",
  timeTo: "timeTo",
  weekdays: "weekdays",
  languages: "languages",
  zone: "zone",
  together: "together",
  intervalMinutes: "interval",
  lastSeatsThreshold: "threshold",
  extraChatIds: "extraChats",
};

function huntFieldOf(rest: string): string | null {
  if (rest.startsWith("window.from")) return "windowFrom";
  if (rest.startsWith("window.to")) return "windowTo";
  if (rest.startsWith("window.days")) return "windowDays";
  if (rest.startsWith("window")) return "windowKind";
  return HUNT_FIELDS[rest.split(/[.[]/)[0] ?? ""] ?? null;
}

function groupByRegion(theatres: Theatre[]): Array<[string, Theatre[]]> {
  const groups = new Map<string, Theatre[]>();
  for (const theatre of theatres) {
    const region = theatre.region ?? ui.unknownRegion;
    groups.set(region, [...(groups.get(region) ?? []), theatre]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "it"))
    .map(([region, list]): [string, Theatre[]] => [region, [...list].sort((a, b) => a.name.localeCompare(b.name, "it"))]);
}

async function loadTheatres(deps: AppDeps): Promise<Theatre[] | null> {
  try {
    return await deps.watcher.services.theatres();
  } catch {
    return null;
  }
}

function TheatrePicker(props: { theatres: Theatre[] | null; values: HuntValues; error: string | undefined }) {
  if (props.theatres === null) {
    return (
      <TextField
        name="theatreText"
        label={ui.fields.theatreText}
        value={[...props.values.theatres, props.values.theatreText].filter(Boolean).join(", ")}
        error={props.error}
      />
    );
  }
  return (
    <Group legend={ui.fields.theatres} error={props.error}>
      <div class="flex flex-col gap-2">
        {groupByRegion(props.theatres).map(([region, list]) => (
          <details open={list.some((theatre) => props.values.theatres.includes(theatre.slug))} class="rounded-lg border border-border px-3 py-2">
            <summary class="cursor-pointer text-sm font-semibold">{region}</summary>
            <div class="mt-2 grid gap-2 sm:grid-cols-2">
              {list.map((theatre) => (
                <CheckBox name="theatre" value={theatre.slug} label={theatre.name} checked={props.values.theatres.includes(theatre.slug)} />
              ))}
            </div>
          </details>
        ))}
      </div>
    </Group>
  );
}

function ErrorList(props: { errors: string[] }) {
  if (props.errors.length === 0) return null;
  return (
    <Notice tone="danger">
      <ul>
        {props.errors.map((error) => (
          <li>{error}</li>
        ))}
      </ul>
    </Notice>
  );
}

function movieOptions(values: HuntValues, movies: ListedMovie[] | null): Array<{ value: string; label: string }> {
  if (values.theatres.length === 0) return [{ value: "", label: ui.fields.movieListedNoTheatres }];
  if (movies === null) return [{ value: "", label: ui.fields.movieListedError }];
  const listed = movies.map((movie) => ({ value: movie.slug, label: movie.label }));
  const kept = values.movieListed !== "" && !movies.some((movie) => movie.slug === values.movieListed) ? [{ value: values.movieListed, label: values.movieListed }] : [];
  if (listed.length === 0 && kept.length === 0) return [{ value: "", label: ui.fields.movieListedNone }];
  return [{ value: "", label: ui.fields.movieListedPick }, ...listed, ...kept];
}

function MovieSelect(props: { values: HuntValues; movies: ListedMovie[] | null; error: string | undefined }) {
  return (
    <Field label={ui.fields.movieListed} for="movieListed" error={props.error}>
      <select
        id="movieListed"
        name="movieListed"
        aria-invalid={props.error ? "true" : undefined}
        class={inputClass}
        data-movie-picker
        data-max={String(MAX_MOVIE_THEATRES)}
        data-text-pick={ui.fields.movieListedPick}
        data-text-no-theatres={ui.fields.movieListedNoTheatres}
        data-text-none={ui.fields.movieListedNone}
        data-text-error={ui.fields.movieListedError}
      >
        {movieOptions(props.values, props.movies).map((option) => (
          <option value={option.value} selected={option.value !== "" && option.value === props.values.movieListed}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function HuntFormBody(props: {
  values: HuntValues;
  errors: FieldErrors;
  theatres: Theatre[] | null;
  movies: ListedMovie[] | null;
  zoneKept: string | undefined;
  action: string;
}) {
  const { values, errors } = props;
  const fieldError = errors.fields;
  const formats = [...ui.formats, ...values.formats.filter((format) => !ui.formats.some((known) => known === format))];
  const movieError = fieldError["movie"];
  return (
    <form method="post" action={props.action} class="flex flex-col gap-4">
      <Card title={ui.sections.what}>
        <FormGrid>
          <Wide>
            <TextField name="name" label={ui.fields.name} value={values.name} error={fieldError["name"]} />
          </Wide>
          <Wide>
            <Group legend={ui.fields.movieKind}>
              <div class="flex flex-wrap gap-4">
                <Radio name="movieKind" value="listed" label={ui.movieKinds.listed} checked={values.movieKind === "listed"} />
                <Radio name="movieKind" value="slug" label={ui.movieKinds.slug} checked={values.movieKind === "slug"} />
                <Radio name="movieKind" value="title" label={ui.movieKinds.title} checked={values.movieKind === "title"} />
              </div>
            </Group>
          </Wide>
          <Wide>
            <MovieSelect values={values} movies={props.movies} error={values.movieKind === "listed" ? movieError : undefined} />
          </Wide>
          <TextField
            name="movieSlugs"
            label={ui.fields.movieSlug}
            value={values.movieSlugs}
            hint={ui.fields.movieSlugHint}
            error={values.movieKind === "slug" ? movieError : undefined}
          />
          <TextField
            name="movieWords"
            label={ui.fields.movieTitle}
            value={values.movieWords}
            hint={ui.fields.movieTitleHint}
            error={values.movieKind === "title" ? movieError : undefined}
          />
          <Wide>
            <Group legend={ui.fields.formats} hint={ui.fields.formatsHint} error={fieldError["formats"]}>
              <div class="flex flex-wrap gap-x-4 gap-y-2">
                {formats.map((format) => (
                  <CheckBox name="format" value={format} label={format} checked={values.formats.includes(format)} />
                ))}
              </div>
            </Group>
          </Wide>
        </FormGrid>
      </Card>
      <Card title={ui.sections.where}>
        <TheatrePicker theatres={props.theatres} values={values} error={fieldError["theatres"]} />
      </Card>
      <Card title={ui.sections.when}>
        <FormGrid>
          <Wide>
            <Group legend={ui.fields.windowKind} error={fieldError["windowKind"]}>
              <div class="flex flex-wrap gap-4">
                <Radio name="windowKind" value="fixed" label={ui.windowKinds.fixed} checked={values.windowKind === "fixed"} />
                <Radio name="windowKind" value="next" label={ui.windowKinds.next} checked={values.windowKind === "next"} />
              </div>
            </Group>
          </Wide>
          <TextField name="windowFrom" label={ui.fields.windowFrom} value={values.windowFrom} type="date" error={fieldError["windowFrom"]} />
          <TextField name="windowTo" label={ui.fields.windowTo} value={values.windowTo} type="date" error={fieldError["windowTo"]} />
          <TextField name="windowDays" label={ui.fields.windowDays} value={values.windowDays} type="number" min={1} max={60} error={fieldError["windowDays"]} />
          <div class="hidden sm:block" />
          <TextField name="timeFrom" label={ui.fields.timeFrom} value={values.timeFrom} type="time" error={fieldError["timeFrom"]} />
          <TextField name="timeTo" label={ui.fields.timeTo} value={values.timeTo} type="time" error={fieldError["timeTo"]} />
          <Wide>
            <Group legend={ui.fields.weekdays} hint={ui.fields.weekdaysHint} error={fieldError["weekdays"]}>
              <div class="flex flex-wrap gap-x-4 gap-y-2">
                {ui.weekdays.map((label, index) => (
                  <CheckBox name="weekday" value={String(index + 1)} label={label} checked={values.weekdays.includes(String(index + 1))} />
                ))}
              </div>
            </Group>
          </Wide>
          <Wide>
            <TextField name="languages" label={ui.fields.languages} value={values.languages} hint={ui.fields.languagesHint} error={fieldError["languages"]} />
          </Wide>
        </FormGrid>
      </Card>
      <Card title={ui.sections.seats}>
        <FormGrid>
          <TextField name="together" label={ui.fields.together} value={values.together} type="number" min={1} max={10} error={fieldError["together"]} />
          <TextField name="threshold" label={ui.fields.threshold} value={values.threshold} type="number" min={0} error={fieldError["threshold"]} />
          <Wide>
            <Group legend={ui.fields.zone}>
              <ZoneFields
                prefix="zone"
                values={values.zone}
                labels={{ from: ui.fields.zoneFrom, to: ui.fields.zoneTo, center: ui.fields.zoneCenter }}
                error={fieldError["zone"]}
                kept={props.zoneKept}
              />
            </Group>
          </Wide>
          <TextField name="interval" label={ui.fields.interval} value={values.interval} type="number" min={1} hint={ui.fields.intervalHint} error={fieldError["interval"]} />
        </FormGrid>
      </Card>
      <Card title={ui.sections.alerts}>
        <FormGrid>
          <Wide>
            <Group legend={ui.fields.notify}>
              <div class="grid gap-2 sm:grid-cols-2">
                {NOTIFY_KEYS.map((key) => (
                  <CheckBox name="notify" value={key} label={ui.notify[key]} checked={values.notify.includes(key)} />
                ))}
              </div>
            </Group>
          </Wide>
          <Wide>
            <label for="extraChats" class="mb-1.5 block text-sm font-semibold">
              {ui.fields.extraChats}
            </label>
            <textarea
              id="extraChats"
              name="extraChats"
              rows={3}
              class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {values.extraChats}
            </textarea>
            <p class="mt-1.5 text-xs text-muted">{ui.fields.extraChatsHint}</p>
            {fieldError["extraChats"] ? <p class="mt-1.5 text-xs font-semibold text-danger">{fieldError["extraChats"]}</p> : null}
          </Wide>
          <Wide>
            <CheckBox name="enabled" value="1" label={ui.fields.enabled} checked={values.enabled} />
          </Wide>
        </FormGrid>
      </Card>
      <div>
        <Button label={ui.actions.save} icon="check" variant="primary" />
      </div>
    </form>
  );
}

function hallKeyOf(showing: { localId: number; screenId: number | null }): string | null {
  return showing.screenId === null ? null : `${showing.localId}-${showing.screenId}`;
}

function StatusCards(props: { hunt: Hunt; state: HuntState | undefined; theatreNames: Record<string, string> }) {
  const { hunt } = props;
  const showings = Object.values(props.state?.showings ?? {}).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pending = props.state?.pendingMovieSlugs ?? [];
  return (
    <>
      <Card
        title={ui.sections.status}
        actions={
          <>
            <ActionForm action={`/hunts/${hunt.id}/send`}>
              <Button label={ui.actions.send} icon="send" size="sm" variant="outline" />
            </ActionForm>
            <ActionForm action={`/hunts/${hunt.id}/delete`}>
              <Button label={ui.actions.deleteHunt} icon="trash2" size="sm" variant="danger" confirm={common.actions.confirmDelete} />
            </ActionForm>
          </>
        }
      >
        {showings.length === 0 ? (
          <p class="text-sm text-muted">{ui.empty.showings}</p>
        ) : (
          <ul class="flex flex-col divide-y divide-border">
            {showings.map((showing) => {
              const query = new URLSearchParams({ hunt: hunt.id, movie: showing.movieSlug, theatre: showing.theatreSlug });
              const free = showing.seats?.freeInZone;
              return (
                <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div class="min-w-0">
                    <span class="font-semibold">{`${formatDay(showing.day)} ${showing.time}`}</span>
                    <span class="text-muted">{` · ${props.theatreNames[showing.theatreSlug] ?? showing.theatreSlug} · ${showing.screenName ?? showing.room}`}</span>
                  </div>
                  <div class="flex items-center gap-3">
                    {free === undefined ? (
                      <Badge tone="muted">{ui.showing.unknown}</Badge>
                    ) : (
                      <Badge tone={showing.seats?.ok ? "gold" : "neutral"}>{ui.showing.free(free)}</Badge>
                    )}
                    <a href={`/performances/${showing.localId}/${showing.performanceId}?${query.toString()}`} class="font-semibold text-primary hover:underline">
                      {ui.showing.open}
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {pending.length > 0 ? (
        <Card title={ui.sections.pending}>
          <ul class="flex flex-col divide-y divide-border">
            {pending.map((slug) => (
              <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span class="min-w-0 font-semibold">{slug}</span>
                <ActionForm action={`/hunts/${hunt.id}/confirm`}>
                  <input type="hidden" name="slug" value={slug} />
                  <Button label={ui.actions.confirm} icon="check" size="sm" variant="primary" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <HallZonesCard hunt={hunt} state={props.state} />
    </>
  );
}

function HallZonesCard(props: { hunt: Hunt; state: HuntState | undefined }) {
  const { hunt } = props;
  const rooms = new Map<string, { room: string; performanceId: number }>();
  for (const showing of Object.values(props.state?.showings ?? {})) {
    const key = hallKeyOf(showing);
    if (key !== null && !rooms.has(key)) rooms.set(key, { room: showing.screenName ?? showing.room, performanceId: showing.performanceId });
  }
  const zones = Object.entries(hunt.hallZones);
  const toReconfirm = props.state?.hallsToReconfirm ?? [];
  return (
    <Card title={ui.sections.halls}>
      {zones.length === 0 ? <p class="text-sm text-muted">{ui.empty.halls}</p> : null}
      <ul class="flex flex-col divide-y divide-border">
        {zones.map(([key, zone]) => (
          <li class="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span class="min-w-0">
              <span class="font-semibold">{rooms.get(key)?.room ?? key}</span>
              <span class="text-muted">{` · ${ui.zonePage.zoneSummary(zone.rows.join(", "), zone.seatFrom, zone.seatTo)}`}</span>
            </span>
            {toReconfirm.includes(key) ? <Badge tone="danger">{ui.hallChanged}</Badge> : null}
            <ActionForm action={`/hunts/${hunt.id}/zones/${key}/delete`}>
              <Button label={ui.actions.removeZone} icon="trash2" size="sm" variant="danger" />
            </ActionForm>
          </li>
        ))}
      </ul>
      {rooms.size > 0 ? (
        <ul class="mt-3 flex flex-col gap-2">
          {[...rooms.entries()].map(([key, room]) => (
            <li class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="min-w-0">{room.room}</span>
              <LinkButton
                href={`/hunts/${hunt.id}/zone?performance=${key.split("-")[0] ?? ""}-${room.performanceId}`}
                label={ui.actions.setZone}
                icon="armchair"
                size="sm"
                variant="outline"
              />
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

interface ZoneFormValues {
  rows: string;
  seatFrom: string;
  seatTo: string;
}

const ZONE_FIELDS: Record<string, string> = { rows: "rows", seatFrom: "seatFrom", seatTo: "seatTo" };

function zoneFieldOf(rest: string): string | null {
  if (rest === "") return "seatTo";
  return ZONE_FIELDS[rest.replace(/^\./, "").split(/[.[]/)[0] ?? ""] ?? null;
}

function zoneFormValuesOf(hunt: Hunt, hallKey: string): ZoneFormValues {
  const zone = hunt.hallZones[hallKey] ?? (hunt.zone.kind === "absolute" ? hunt.zone : null);
  if (zone === null) return { rows: "", seatFrom: "", seatTo: "" };
  return {
    rows: zone.rows.join(", "),
    seatFrom: zone.seatFrom === null ? "" : String(zone.seatFrom),
    seatTo: zone.seatTo === null ? "" : String(zone.seatTo),
  };
}

export function registerHuntsRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const watcher = deps.watcher;

  function findHunt(id: string): Hunt | null {
    if (!HUNT_ID.test(id)) return null;
    return watcher.config().hunts.find((hunt) => hunt.id === id) ?? null;
  }

  function blankHunt(): Hunt {
    return createHunt({ name: "", theatres: [], movie: { kind: "slug", slugs: [] } }, watcher.config().settings);
  }

  async function huntPage(c: PageContext, page: { hunt: Hunt | null; base: Hunt; values: HuntValues; errors: FieldErrors; status: 200 | 400 }) {
    const theatres = await loadTheatres(deps);
    const movies = await listedMovies(deps, page.values.theatres);
    const values = page.status === 200 ? preferListed(page.values, movies) : page.values;
    const theatreNames = Object.fromEntries((theatres ?? []).map((theatre) => [theatre.slug, theatre.name]));
    const zone = absoluteSummary(page.base.zone);
    const { hunt } = page;
    const title = hunt ? hunt.name : ui.titleNew;
    return renderPage(c, deps, {
      title,
      section: "hunts",
      status: page.status,
      body: (
        <>
          <PageHeader
            title={title}
            description={hunt ? ui.descriptionEdit : ui.descriptionNew}
            actions={<LinkButton href="/" label={common.actions.back} icon="arrowLeft" variant="outline" />}
          />
          <ErrorList errors={page.errors.general} />
          {hunt && c.req.query("sent") === "ok" ? <Notice tone="success">{ui.sent.ok}</Notice> : null}
          {hunt && c.req.query("sent") === "fail" ? <Notice tone="danger">{ui.sent.fail}</Notice> : null}
          {hunt ? (
            <div class="mb-4 flex flex-col gap-4">
              <StatusCards hunt={hunt} state={watcher.state().hunts[hunt.id]} theatreNames={theatreNames} />
            </div>
          ) : null}
          <HuntFormBody
            values={values}
            errors={page.errors}
            theatres={theatres}
            movies={movies}
            zoneKept={zone ? ui.fields.zoneKept(zone.rows, zone.seats) : undefined}
            action={hunt ? `/hunts/${hunt.id}` : "/hunts"}
          />
          <script src="/assets/movie-picker.js" defer nonce={pageContext(c, deps).nonce}></script>
        </>
      ),
    });
  }

  async function saveHunt(c: PageContext, hunt: Hunt | null) {
    const config = watcher.config();
    const base = hunt ?? blankHunt();
    const body = await c.req.parseBody({ all: true });
    const values = valuesOfBody(body);
    const built = huntOfValues(values, base);
    const index = hunt ? config.hunts.findIndex((item) => item.id === hunt.id) : config.hunts.length;
    const next: Config = {
      ...config,
      hunts: hunt ? config.hunts.map((item) => (item.id === hunt.id ? built : item)) : [...config.hunts, built],
    };
    const result = await watcher.saveConfig(next);
    if (result.ok) return c.redirect("/", 303);
    return huntPage(c, { hunt, base, values, errors: splitErrors(result.errors, `hunts[${index}].`, huntFieldOf), status: 400 });
  }

  app.get("/hunts/new", (c) => {
    const base = blankHunt();
    return huntPage(c, { hunt: null, base, values: valuesOfQuery(base, c.req.query()), errors: noErrors(), status: 200 });
  });

  app.post("/hunts", (c) => saveHunt(c, null));

  app.get("/api/movies", async (c) => {
    const query = c.req.query("theatres");
    const theatres = (query ?? "").split(",").map((slug) => slug.trim()).filter((slug) => slug !== "");
    if (query === undefined || theatres.length > MAX_MOVIE_THEATRES || !theatres.every((slug) => SLUG.test(slug))) return c.json({ error: "invalid theatres" }, 400);
    const movies = await listedMovies(deps, theatres);
    if (movies === null) return c.json({ error: "programming unavailable" }, 502);
    return c.json(movies);
  });

  app.get("/hunts/:id", (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    return huntPage(c, { hunt, base: hunt, values: valuesOfHunt(hunt), errors: noErrors(), status: 200 });
  });

  app.post("/hunts/:id", (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    return saveHunt(c, hunt);
  });

  app.post("/hunts/:id/delete", async (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    const config = watcher.config();
    await watcher.saveConfig({ ...config, hunts: config.hunts.filter((item) => item.id !== hunt.id) });
    return c.redirect("/", 303);
  });

  app.post("/hunts/:id/confirm", async (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    const slug = bodyText(await c.req.parseBody({ all: true }), "slug");
    if (SLUG.test(slug)) await watcher.confirmMovie(hunt.id, slug);
    return c.redirect(`/hunts/${hunt.id}`, 303);
  });

  app.post("/hunts/:id/send", async (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    const sent = await watcher.sendSnapshot(hunt.id);
    return c.redirect(`/hunts/${hunt.id}?sent=${sent ? "ok" : "fail"}`, 303);
  });

  app.post("/hunts/:id/zones/:hallKey/delete", async (c) => {
    const hunt = findHunt(c.req.param("id"));
    const hallKey = c.req.param("hallKey");
    if (!hunt || !HALL_KEY.test(hallKey)) return c.notFound();
    const hallZones = Object.fromEntries(Object.entries(hunt.hallZones).filter(([key]) => key !== hallKey));
    const config = watcher.config();
    await watcher.saveConfig({ ...config, hunts: config.hunts.map((item) => (item.id === hunt.id ? { ...item, hallZones } : item)) });
    await watcher.confirmHallZone(hunt.id, hallKey);
    return c.redirect(`/hunts/${hunt.id}`, 303);
  });

  async function zonePage(
    c: PageContext,
    page: { hunt: Hunt; performance: string; values: ZoneFormValues | null; errors: FieldErrors; status: 200 | 400 | 500 },
  ) {
    const match = PERFORMANCE.exec(page.performance);
    if (!match) return c.notFound();
    const [localId, performanceId] = [Number(match[1]), Number(match[2])];
    const { hunt } = page;
    const header = (
      <PageHeader
        title={ui.titleZone}
        description={ui.descriptionZone}
        actions={<LinkButton href={`/hunts/${hunt.id}`} label={common.actions.back} icon="arrowLeft" variant="outline" />}
      />
    );
    let view;
    try {
      view = await watcher.services.hall(localId, performanceId, hunt.id);
    } catch {
      return renderPage(c, deps, {
        title: ui.titleZone,
        section: "hunts",
        status: 500,
        body: (
          <>
            {header}
            <Notice tone="danger">{ui.zonePage.unavailable}</Notice>
          </>
        ),
      });
    }
    const hallKey = `${view.performance.localId}-${view.performance.screenId}`;
    const options = {
      title: await movieTitleFor(deps, `${view.performance.localId}-${view.performance.performanceId}`, view.performance.title, hunt.theatres),
      subtitle: ui.zonePage.hallSubtitle(hunt.name, view.performance.screenName),
      labels: copy.hall.labels,
    };
    const values = page.values ?? zoneFormValuesOf(hunt, hallKey);
    const nonce = pageContext(c, deps).nonce;
    return renderPage(c, deps, {
      title: ui.titleZone,
      section: "hunts",
      status: page.status,
      body: (
        <>
          {header}
          <ErrorList errors={page.errors.general} />
          <div class="flex flex-col gap-4">
            <Card>
              <div class="hall-svg dark:hidden">{raw(renderHallSvg(view.hall, view.occupancy, view.analysis, view.rule, { ...options, theme: "light" }))}</div>
              <div class="hall-svg hidden dark:block">{raw(renderHallSvg(view.hall, view.occupancy, view.analysis, view.rule, { ...options, theme: "dark" }))}</div>
            </Card>
            <Card title={ui.titleZone}>
              <form method="post" action={`/hunts/${hunt.id}/zone`} class="flex flex-col gap-4" data-hall-picker>
                <input type="hidden" name="performance" value={`${localId}-${performanceId}`} />
                <p class="text-sm text-muted">{ui.zonePage.pick}</p>
                <FormGrid>
                  <Wide>
                    <TextField name="rows" label={ui.zonePage.rows} value={values.rows} hint={ui.zonePage.rowsHint} error={page.errors.fields["rows"]} />
                  </Wide>
                  <TextField name="seatFrom" label={ui.zonePage.seatFrom} value={values.seatFrom} type="number" min={1} error={page.errors.fields["seatFrom"]} />
                  <TextField name="seatTo" label={ui.zonePage.seatTo} value={values.seatTo} type="number" min={1} error={page.errors.fields["seatTo"]} />
                </FormGrid>
                <div>
                  <Button label={ui.actions.save} icon="check" variant="primary" />
                </div>
              </form>
            </Card>
          </div>
          <script src="/assets/hall-picker.js" defer nonce={nonce}></script>
        </>
      ),
    });
  }

  app.get("/hunts/:id/zone", (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    return zonePage(c, { hunt, performance: c.req.query("performance") ?? "", values: null, errors: noErrors(), status: 200 });
  });

  app.post("/hunts/:id/zone", async (c) => {
    const hunt = findHunt(c.req.param("id"));
    if (!hunt) return c.notFound();
    const body = await c.req.parseBody({ all: true });
    const performance = bodyText(body, "performance");
    const match = PERFORMANCE.exec(performance);
    if (!match) return c.notFound();
    const values: ZoneFormValues = { rows: bodyText(body, "rows"), seatFrom: bodyText(body, "seatFrom"), seatTo: bodyText(body, "seatTo") };
    let screenId: number;
    try {
      screenId = (await watcher.services.hall(Number(match[1]), Number(match[2]), hunt.id)).performance.screenId;
    } catch {
      return zonePage(c, { hunt, performance, values, errors: noErrors(), status: 500 });
    }
    const hallKey = `${match[1] ?? ""}-${screenId}`;
    const config = watcher.config();
    const index = config.hunts.findIndex((item) => item.id === hunt.id);
    const zone = { kind: "absolute" as const, rows: splitList(values.rows), seatFrom: nullableNumber(values.seatFrom), seatTo: nullableNumber(values.seatTo) };
    const next: Config = {
      ...config,
      hunts: config.hunts.map((item) => (item.id === hunt.id ? { ...item, hallZones: { ...item.hallZones, [hallKey]: zone } } : item)),
    };
    const result = await watcher.saveConfig(next);
    if (result.ok) {
      await watcher.confirmHallZone(hunt.id, hallKey);
      return c.redirect(`/hunts/${hunt.id}`, 303);
    }
    return zonePage(c, { hunt, performance, values, errors: splitErrors(result.errors, `hunts[${index}].hallZones.${hallKey}`, zoneFieldOf), status: 400 });
  });
}
