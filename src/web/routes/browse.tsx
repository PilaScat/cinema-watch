import type { Context, Hono } from "hono";
import { copy } from "../../copy.js";
import { formatDay, formatEur, formatGroup } from "../../format.js";
import { renderHallSvg } from "../../hall-svg.js";
import type { HistoryPoint } from "../../history.js";
import type { HallView } from "../../watcher.js";
import type { CatalogMovie, IsoDay, Showing, Theatre } from "../../types.js";
import { normalizeTitle } from "../../uci.js";
import { searchMovies } from "../../movie-search.js";
import { pageContext, renderPage, type AppDeps, type AppEnv } from "../app.js";
import { Badge, buttonClass, Card, Empty, Field, inputClass, LinkButton, Notice, PageHeader } from "../components.js";
import { DayTabs, HallPair, MovieCard, ShowingRow, Stat, TheatreGroup, TrendSection } from "../parts/browse.js";
import { movieTitleFor } from "../parts/titles.js";
import { ISO_DAY, showingKey, SLUG } from "../../keys.js";

const NUMERIC = /^\d+$/;
const MAX_SHOWINGS = 12;
const MAX_QUERY = 100;

function validDay(value: string): boolean {
  return ISO_DAY.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

async function loadTheatres(deps: AppDeps): Promise<Theatre[] | null> {
  try {
    return await deps.watcher.services.theatres();
  } catch {
    return null;
  }
}

async function loadProgramming(deps: AppDeps, slug: string): Promise<Map<IsoDay, Showing[]> | null> {
  try {
    return await deps.watcher.services.programming(slug);
  } catch {
    return null;
  }
}

async function hallOf(deps: AppDeps, localId: number, performanceId: number, huntId?: string): Promise<HallView | null> {
  try {
    return await deps.watcher.services.hall(localId, performanceId, huntId);
  } catch {
    return null;
  }
}

async function loadHistory(deps: AppDeps, key: string): Promise<HistoryPoint[]> {
  try {
    return await deps.watcher.history(key);
  } catch {
    return [];
  }
}

function groupByRegion(theatres: Theatre[]): Array<[string, Theatre[]]> {
  const groups = new Map<string, Theatre[]>();
  for (const theatre of theatres) {
    const region = theatre.region ?? copy.ui.theatres.otherRegion;
    groups.set(region, [...(groups.get(region) ?? []), theatre]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "it"))
    .map(([region, items]) => [region, items.sort((a, b) => a.name.localeCompare(b.name, "it"))]);
}

function movieShowings(programming: Map<IsoDay, Showing[]>, movie: string): Array<[IsoDay, Showing[]]> {
  return [...programming.entries()]
    .map(([day, showings]): [IsoDay, Showing[]] => [day, showings.filter((showing) => showing.movie.slug === movie)])
    .filter(([, showings]) => showings.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function queryString(values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, value);
  return params.toString();
}

function TheatresPage(props: { theatres: Theatre[] | null; query: string }) {
  const ui = copy.ui.theatres;
  const needle = normalizeTitle(props.query);
  const shown = (props.theatres ?? []).filter((theatre) => needle === "" || normalizeTitle(`${theatre.name} ${theatre.city}`).includes(needle));
  return (
    <>
      <PageHeader title={ui.title} description={ui.description} />
      <form method="get" action="/theatres" class="mb-6 flex flex-wrap items-end gap-3">
        <div class="w-full max-w-sm">
          <Field label={ui.filterLabel} for="q">
            <input id="q" name="q" type="search" value={props.query} placeholder={ui.filterPlaceholder} maxlength={MAX_QUERY} class={inputClass} />
          </Field>
        </div>
        <button type="submit" class={buttonClass("secondary")}>
          {ui.filterButton}
        </button>
      </form>
      {props.theatres === null ? <Notice tone="danger">{ui.loadError}</Notice> : null}
      {shown.length === 0 ? <Empty text={ui.empty} /> : groupByRegion(shown).map(([region, items]) => <TheatreGroup region={region} theatres={items} />)}
    </>
  );
}

async function loadCatalog(deps: AppDeps): Promise<CatalogMovie[] | null> {
  try {
    return await deps.watcher.services.movies();
  } catch {
    return null;
  }
}

async function loadMovieTheatres(deps: AppDeps, movie: string): Promise<Array<{ slug: string; name: string }>> {
  try {
    return (await deps.watcher.services.movieTheatres(movie)).map((item) => ({ slug: item.slug, name: item.name })).sort((a, b) => a.name.localeCompare(b.name, "it"));
  } catch {
    return [];
  }
}

export function registerBrowseRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const theatresUi = copy.ui.theatres;
  const searchUi = copy.ui.search;

  app.get("/theatres", async (c) => {
    const query = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
    const theatres = await loadTheatres(deps);
    return renderPage(c, deps, { title: theatresUi.title, section: "theatres", body: <TheatresPage theatres={theatres} query={query} /> });
  });

  app.get("/theatres/:slug", async (c) => {
    const slug = c.req.param("slug");
    if (!SLUG.test(slug)) return c.notFound();
    const theatres = await loadTheatres(deps);
    const theatre = theatres?.find((item) => item.slug === slug);
    if (theatres !== null && !theatre) return c.notFound();
    const programming = await loadProgramming(deps, slug);
    const movies = new Map<string, { title: string; poster: string | null; formats: Set<string>; days: Set<IsoDay> }>();
    for (const [day, showings] of [...(programming?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b))) {
      for (const showing of showings) {
        const entry = movies.get(showing.movie.slug) ?? { title: showing.movie.title, poster: showing.movie.poster, formats: new Set<string>(), days: new Set<IsoDay>() };
        entry.formats.add(showing.formatGroup);
        entry.days.add(day);
        movies.set(showing.movie.slug, entry);
      }
    }
    const name = theatre?.name ?? slug;
    return renderPage(c, deps, {
      title: name,
      section: "theatres",
      body: (
        <>
          <PageHeader title={name} description={theatresUi.programmingDescription} actions={<LinkButton href="/theatres" label={copy.ui.common.actions.back} icon="arrowLeft" variant="outline" />} />
          {programming === null ? <Notice tone="danger">{theatresUi.programmingError}</Notice> : null}
          {movies.size === 0 ? (
            <Empty text={theatresUi.emptyMovies} />
          ) : (
            <div class="grid gap-3 md:grid-cols-2">
              {[...movies.entries()].map(([movie, entry]) => (
                <MovieCard
                  href={`/theatres/${slug}/movies/${movie}`}
                  title={entry.title}
                  poster={entry.poster}
                  formats={[...entry.formats]}
                  detail={[theatresUi.days(entry.days.size), theatresUi.firstDay(formatDay([...entry.days][0] ?? ""))].join(" · ")}
                />
              ))}
            </div>
          )}
        </>
      ),
    });
  });

  app.get("/theatres/:slug/movies/:movie", async (c) => {
    const slug = c.req.param("slug");
    const movie = c.req.param("movie");
    const dayParam = c.req.query("day");
    if (!SLUG.test(slug) || !SLUG.test(movie) || (dayParam !== undefined && !validDay(dayParam))) return c.notFound();
    const theatres = await loadTheatres(deps);
    const theatre = theatres?.find((item) => item.slug === slug);
    if (theatres !== null && !theatre) return c.notFound();
    const programming = await loadProgramming(deps, slug);
    const days = programming ? movieShowings(programming, movie) : [];
    const selected = days.find(([day]) => day === dayParam) ?? days[0];
    const ordered = [...(selected?.[1] ?? [])].sort((a, b) => a.time.localeCompare(b.time) || a.room.localeCompare(b.room));
    const shown = ordered.slice(0, MAX_SHOWINGS);
    const analyses = await Promise.all(shown.map(async (showing) => (await hallOf(deps, showing.localId, showing.performanceId))?.analysis ?? null));
    const title = days[0]?.[1][0]?.movie.title ?? movie;
    const huntQuery = queryString({ theatre: slug, movie });
    return renderPage(c, deps, {
      title,
      section: "theatres",
      body: (
        <>
          <PageHeader
            title={title}
            description={theatre?.name ?? slug}
            actions={
              <>
                <LinkButton href={`/theatres/${slug}`} label={copy.ui.common.actions.back} icon="arrowLeft" variant="outline" />
                <LinkButton href={`/hunts/new?${huntQuery}`} label={theatresUi.addHunt} icon="plus" variant="primary" />
              </>
            }
          />
          {programming === null ? <Notice tone="danger">{theatresUi.programmingError}</Notice> : null}
          {selected ? (
            <>
              <DayTabs days={days.map(([day]) => ({ day, label: formatDay(day) }))} selected={selected[0]} />
              <div class="grid gap-3">
                {shown.map((showing, index) => (
                  <ShowingRow href={`/performances/${showing.localId}/${showing.performanceId}?${huntQuery}`} showing={showing} analysis={analyses[index] ?? null} />
                ))}
              </div>
              {ordered.length > shown.length ? <p class="mt-3 text-sm text-muted">{theatresUi.cap(MAX_SHOWINGS)}</p> : null}
            </>
          ) : (
            <Empty text={theatresUi.emptyShowings} />
          )}
        </>
      ),
    });
  });

  app.get("/search", async (c) => {
    const query = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
    const chosen = c.req.query("movie");
    if (chosen !== undefined && !SLUG.test(chosen)) return c.notFound();
    const catalog = query === "" && chosen === undefined ? [] : await loadCatalog(deps);
    const results = catalog === null || query === "" ? [] : searchMovies(catalog, query);
    const [only] = results;
    const exactSlug = normalizeTitle(query).replaceAll(" ", "-");
    const selected = chosen ?? (catalog === null && exactSlug !== "" ? exactSlug : results.length === 1 && only ? only.slug : undefined);
    const selectedTitle = (catalog ?? []).find((movie) => movie.slug === selected)?.title ?? selected ?? "";
    const theatres = selected === undefined ? [] : await loadMovieTheatres(deps, selected);
    const guessed = catalog === null && chosen === undefined;
    const showTheatres = selected !== undefined && !(guessed && theatres.length === 0);
    return renderPage(c, deps, {
      title: searchUi.title,
      section: "search",
      body: (
        <>
          <PageHeader title={searchUi.title} description={searchUi.description} />
          <form method="get" action="/search" class="mb-6 flex flex-wrap items-end gap-3">
            <div class="w-full max-w-sm">
              <Field label={searchUi.label} for="q">
                <input id="q" name="q" type="search" value={query} placeholder={searchUi.placeholder} maxlength={MAX_QUERY} class={inputClass} />
              </Field>
            </div>
            <button type="submit" class={buttonClass("primary")}>
              {searchUi.button}
            </button>
          </form>
          {catalog === null ? <Notice tone="danger">{searchUi.catalogUnavailable}</Notice> : null}
          <div class="grid gap-6">
            {showTheatres ? (
              <Card title={searchUi.theatresTitle(selectedTitle)}>
                {theatres.length === 0 ? (
                  <p class="text-sm text-muted">{searchUi.noTheatres}</p>
                ) : (
                  <ul class="grid gap-2 sm:grid-cols-2">
                    {theatres.map((item) => (
                      <li>
                        <a href={`/theatres/${item.slug}/movies/${selected}`} class="font-semibold hover:text-primary">
                          {item.name}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : null}
            {results.length > 0 ? (
              <Card title={searchUi.resultsTitle}>
                <div class="grid gap-3 md:grid-cols-2">
                  {results.map((movie) => (
                    <MovieCard
                      href={`/search?${queryString({ q: query, movie: movie.slug })}`}
                      title={movie.title}
                      poster={movie.poster}
                      formats={movie.formats}
                      detail={searchUi.dates(movie.firstDay === null ? null : formatDay(movie.firstDay), movie.lastDay === null ? null : formatDay(movie.lastDay))}
                    />
                  ))}
                </div>
              </Card>
            ) : null}
            {query !== "" && results.length === 0 && !showTheatres ? <Empty text={searchUi.empty} hint={searchUi.emptyHint} /> : null}
          </div>
        </>
      ),
    });
  });

  app.get("/performances/:localId/:performanceId", (c) => performancePage(c, deps));
}

async function performancePage(c: Context<AppEnv>, deps: AppDeps) {
  const ui = copy.ui.performance;
  const localParam = c.req.param("localId") ?? "";
  const performanceParam = c.req.param("performanceId") ?? "";
  const movie = c.req.query("movie");
  const theatre = c.req.query("theatre");
  if (!NUMERIC.test(localParam) || !NUMERIC.test(performanceParam)) return c.notFound();
  if ((movie !== undefined && !SLUG.test(movie)) || (theatre !== undefined && !SLUG.test(theatre))) return c.notFound();
  const localId = Number(localParam);
  const performanceId = Number(performanceParam);
  const huntParam = c.req.query("hunt");
  const huntId = huntParam !== undefined && deps.watcher.huntById(huntParam) !== null ? huntParam : undefined;
  const view = await hallOf(deps, localId, performanceId, huntId);
  if (!view) {
    return renderPage(c, deps, {
      title: ui.hallTitle,
      section: "theatres",
      body: (
        <>
          <PageHeader title={ui.hallTitle} />
          <Notice tone="danger">{ui.hallError}</Notice>
        </>
      ),
    });
  }
  const { performance, hall, occupancy, analysis, rule } = view;
  const day = performance.startTime.slice(0, 10);
  const time = performance.startTime.slice(11, 16);
  const subtitle = ui.subtitle(performance.screenName, formatDay(day), time);
  const movieTitle = await movieTitleFor(deps, showingKey(localId, performanceId), performance.title, theatre ? [theatre] : []);
  const svgOptions = { title: movieTitle, subtitle, labels: copy.hall.labels };
  const light = renderHallSvg(hall, occupancy, analysis, rule, { ...svgOptions, theme: "light" });
  const dark = renderHallSvg(hall, occupancy, analysis, rule, { ...svgOptions, theme: "dark" });
  const history = await loadHistory(deps, showingKey(localId, performanceId));
  let format: string | undefined;
  if (theatre && movie) {
    const programming = await loadProgramming(deps, theatre);
    const key = showingKey(localId, performanceId);
    format = [...(programming?.values() ?? [])].flat().find((showing) => showing.key === key)?.formatGroup;
  }
  const buyUrl = movie ? `https://ucicinemas.it/movies/${movie}/acquista/${localId}/${performance.eventId}/${performanceId}` : null;
  const huntHref = theatre && movie ? `/hunts/new?${queryString({ theatre, movie, format, from: day, to: day })}` : null;
  const backHref = theatre && movie ? `/theatres/${theatre}/movies/${movie}?day=${day}` : null;
  return renderPage(c, deps, {
    title: movieTitle,
    section: "theatres",
    body: (
      <>
        <PageHeader
          title={movieTitle}
          description={performance.priceFrom === null ? subtitle : `${subtitle} · ${ui.priceFrom(formatEur(performance.priceFrom))}`}
          actions={
            <>
              {backHref ? <LinkButton href={backHref} label={copy.ui.common.actions.back} icon="arrowLeft" variant="outline" /> : null}
              {huntHref ? <LinkButton href={huntHref} label={ui.addHunt} icon="plus" variant="outline" /> : null}
              {buyUrl ? <LinkButton href={buyUrl} label={copy.ui.common.actions.buy} icon="externalLink" variant="primary" external /> : null}
            </>
          }
        />
        <div class="grid gap-6">
          <dl class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label={ui.free} value={analysis.free} />
            <Stat label={ui.freeGood} value={analysis.freeInZone} />
            <div class="col-span-2 rounded-lg bg-surface-2 px-3 py-2 sm:col-span-1">
              <dt class="text-xs text-muted">{ui.best}</dt>
              <dd class="mt-1 flex flex-wrap gap-1.5">
                {analysis.best.length === 0 ? <span class="text-sm text-muted">{ui.noBest}</span> : analysis.best.map((group) => <Badge tone="gold">{formatGroup(group)}</Badge>)}
              </dd>
            </div>
          </dl>
          <Card title={ui.hallTitle}>
            <HallPair dark={dark} light={light} />
          </Card>
          <TrendSection points={history} />
        </div>
        {history.length >= 2 ? <script src="/assets/chart.js" defer nonce={pageContext(c, deps).nonce}></script> : null}
      </>
    ),
  });
}
