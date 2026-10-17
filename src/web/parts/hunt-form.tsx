import { copy } from "../../copy.js";
import { ISO_DAY } from "../../keys.js";
import { byDistance, formatKm } from "../../distance.js";
import type { Hunt, NotifyFlags, Settings } from "../../model.js";
import type { Theatre } from "../../types.js";
import { Button, Card, Field, inputClass, Notice } from "../components.js";
import {
  bodyText,
  bodyValues,
  CheckBox,
  FormGrid,
  Group,
  nullableNumber,
  numberOf,
  optionalText,
  Radio,
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
} from "./forms.js";
import { MAX_MOVIE_THEATRES, type ListedMovie } from "./movies.js";

const ui = copy.ui.hunts;
const NOTIFY_KEYS: Array<keyof NotifyFlags> = ["newShowings", "seatsFreed", "lastSeats", "cancelled", "moved", "movieAppeared", "digest"];
const DEFAULT_DAYS = "30";

export interface HuntValues {
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

export function valuesOfHunt(hunt: Hunt): HuntValues {
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

export function preferListed(values: HuntValues, movies: ListedMovie[] | null): HuntValues {
  if (values.movieKind !== "slug") return values;
  const slugs = splitWords(values.movieSlugs);
  if (slugs.length === 0) return { ...values, movieKind: "listed" };
  const [slug] = slugs;
  if (slugs.length === 1 && movies?.some((movie) => movie.slug === slug)) return { ...values, movieKind: "listed", movieListed: slug ?? "", movieSlugs: "" };
  return values;
}

export function valuesOfBody(body: FormBody): HuntValues {
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

export function valuesOfQuery(base: Hunt, query: Record<string, string>): HuntValues {
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

export function huntOfValues(values: HuntValues, base: Hunt): Hunt {
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

export function huntFieldOf(rest: string): string | null {
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

function TheatreChoices(props: { title: string; theatres: Theatre[]; values: HuntValues; open: boolean; km?: Map<string, number | null> }) {
  return (
    <details open={props.open || props.theatres.some((theatre) => props.values.theatres.includes(theatre.slug))} class="rounded-lg border border-border px-3 py-2">
      <summary class="cursor-pointer text-sm font-semibold">{props.title}</summary>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        {props.theatres.map((theatre) => {
          const km = props.km?.get(theatre.slug);
          return (
            <CheckBox
              name="theatre"
              value={theatre.slug}
              label={km === null || km === undefined ? theatre.name : `${theatre.name} · ${formatKm(km)}`}
              checked={props.values.theatres.includes(theatre.slug)}
            />
          );
        })}
      </div>
    </details>
  );
}

function TheatrePicker(props: { theatres: Theatre[] | null; values: HuntValues; error: string | undefined; settings: Settings }) {
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
  const home = props.settings.home;
  const { near, far } = home === null ? { near: [], far: props.theatres.map((theatre) => ({ theatre, km: null })) } : byDistance(props.theatres, home, props.settings.radiusKm);
  const km = new Map(near.map((item) => [item.theatre.slug, item.km]));
  return (
    <Group legend={ui.fields.theatres} error={props.error}>
      <div class="flex flex-col gap-2">
        {near.length > 0 ? <TheatreChoices title={ui.nearHome} theatres={near.map((item) => item.theatre)} values={props.values} open km={km} /> : null}
        {groupByRegion(far.map((item) => item.theatre)).map(([region, list]) => (
          <TheatreChoices title={region} theatres={list} values={props.values} open={false} />
        ))}
      </div>
    </Group>
  );
}

export function ErrorList(props: { errors: string[] }) {
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

export function HuntFormBody(props: {
  values: HuntValues;
  errors: FieldErrors;
  theatres: Theatre[] | null;
  settings: Settings;
  movies: ListedMovie[] | null;
  zoneKept: string | undefined;
  action: string;
  restore: boolean;
}) {
  const { values, errors } = props;
  const fieldError = errors.fields;
  const formats = [...ui.formats, ...values.formats.filter((format) => !ui.formats.some((known) => known === format))];
  const movieError = fieldError["movie"];
  return (
    <form method="post" action={props.action} class="flex flex-col gap-4">
      {props.restore ? <input type="hidden" name="restore" value="1" /> : null}
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
        <TheatrePicker theatres={props.theatres} values={values} error={fieldError["theatres"]} settings={props.settings} />
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
