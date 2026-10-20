import type { Hono } from "hono";
import { createHunt } from "../../config.js";
import { copy } from "../../copy.js";
import { SLUG } from "../../keys.js";
import type { Config, Hunt } from "../../model.js";
import type { Theatre } from "../../types.js";
import { pageContext, renderPage, type AppDeps, type AppEnv } from "../app.js";
import { LinkButton, Notice, PageHeader } from "../components.js";
import { absoluteSummary, bodyText, noErrors, splitErrors, type FieldErrors } from "../parts/forms.js";
import { ErrorList, HuntFormBody, huntFieldOf, huntOfValues, preferListed, valuesOfBody, valuesOfHunt, valuesOfQuery, type HuntValues } from "../parts/hunt-form.js";
import { StatusCards } from "../parts/hunt-status.js";
import { listedMovies, MAX_MOVIE_THEATRES } from "../parts/movies.js";
import { backHref, fromOf, withFrom } from "../parts/navigation.js";

type PageContext = Parameters<typeof renderPage>[0];

const ui = copy.ui.hunts;
const common = copy.ui.common;

async function loadTheatres(deps: AppDeps): Promise<Theatre[] | null> {
  try {
    return await deps.watcher.services.theatres();
  } catch {
    return null;
  }
}

export function registerHuntsRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const watcher = deps.watcher;

  function findHunt(id: string): Hunt | null {
    return watcher.huntById(id);
  }

  function blankHunt(): Hunt {
    return createHunt({ name: "", theatres: [], movie: { kind: "slug", slugs: [] } }, watcher.config().settings);
  }

  async function huntPage(c: PageContext, page: { hunt: Hunt | null; base: Hunt; values: HuntValues; errors: FieldErrors; status: 200 | 400; restore?: boolean }) {
    const theatres = await loadTheatres(deps);
    const movies = await listedMovies(deps, page.values.theatres);
    const values = page.status === 200 ? preferListed(page.values, movies) : page.values;
    const theatreNames = Object.fromEntries((theatres ?? []).map((theatre) => [theatre.slug, theatre.name]));
    const zone = absoluteSummary(page.base.zone);
    const { hunt } = page;
    const restore = hunt !== null && hunt.archivedAt !== null && (page.restore === true || c.req.query("restore") === "dates");
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
            actions={<LinkButton href={backHref(c, "/")} label={common.actions.back} icon="arrowLeft" variant="outline" />}
          />
          <ErrorList errors={page.errors.general} />
          {hunt && c.req.query("sent") === "ok" ? <Notice tone="success">{ui.sent.ok}</Notice> : null}
          {hunt && c.req.query("sent") === "fail" ? <Notice tone="danger">{ui.sent.fail}</Notice> : null}
          {restore ? <Notice tone="gold">{ui.restoreDates}</Notice> : null}
          {hunt ? (
            <div class="mb-4 flex flex-col gap-4">
              <StatusCards hunt={hunt} state={watcher.state().hunts[hunt.id]} theatreNames={theatreNames} />
            </div>
          ) : null}
          <HuntFormBody
            values={values}
            errors={page.errors}
            theatres={theatres}
            settings={watcher.config().settings}
            movies={movies}
            zoneKept={zone ? ui.fields.zoneKept(zone.rows, zone.seats) : undefined}
            action={withFrom(hunt ? `/hunts/${hunt.id}` : "/hunts", fromOf(c))}
            restore={restore}
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
    const restore = bodyText(body, "restore") === "1";
    const built = restore ? { ...huntOfValues(values, base), archivedAt: null } : huntOfValues(values, base);
    const index = hunt ? config.hunts.findIndex((item) => item.id === hunt.id) : config.hunts.length;
    const next: Config = {
      ...config,
      hunts: hunt ? config.hunts.map((item) => (item.id === hunt.id ? built : item)) : [...config.hunts, built],
    };
    const result = await watcher.saveConfig(next);
    if (result.ok) return c.redirect("/", 303);
    return huntPage(c, { hunt, base, values, errors: splitErrors(result.errors, `hunts[${index}].`, huntFieldOf), status: 400, restore });
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

}
