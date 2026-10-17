import type { Hono } from "hono";
import { raw } from "hono/html";
import { copy } from "../../copy.js";
import { renderHallSvg } from "../../hall-svg.js";
import { HALL_KEY, hallKey, SHOWING_KEY, showingKey } from "../../keys.js";
import type { Config, Hunt } from "../../model.js";
import { pageContext, renderPage, type AppDeps, type AppEnv } from "../app.js";
import { Button, Card, LinkButton, Notice, PageHeader } from "../components.js";
import { bodyText, FormGrid, noErrors, nullableNumber, splitErrors, splitList, TextField, Wide, type FieldErrors } from "../parts/forms.js";
import { ErrorList } from "../parts/hunt-form.js";
import { movieTitleFor } from "../parts/titles.js";

type PageContext = Parameters<typeof renderPage>[0];

const ui = copy.ui.hunts;
const common = copy.ui.common;

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

function zoneFormValuesOf(hunt: Hunt, key: string): ZoneFormValues {
  const zone = hunt.hallZones[key] ?? (hunt.zone.kind === "absolute" ? hunt.zone : null);
  if (zone === null) return { rows: "", seatFrom: "", seatTo: "" };
  return {
    rows: zone.rows.join(", "),
    seatFrom: zone.seatFrom === null ? "" : String(zone.seatFrom),
    seatTo: zone.seatTo === null ? "" : String(zone.seatTo),
  };
}

export function registerHuntZoneRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const watcher = deps.watcher;

  function findHunt(id: string): Hunt | null {
    return watcher.huntById(id);
  }

  app.post("/hunts/:id/zones/:hallKey/delete", async (c) => {
    const hunt = findHunt(c.req.param("id"));
    const zoneKey = c.req.param("hallKey");
    if (!hunt || !HALL_KEY.test(zoneKey)) return c.notFound();
    const hallZones = Object.fromEntries(Object.entries(hunt.hallZones).filter(([key]) => key !== zoneKey));
    const config = watcher.config();
    await watcher.saveConfig({ ...config, hunts: config.hunts.map((item) => (item.id === hunt.id ? { ...item, hallZones } : item)) });
    await watcher.confirmHallZone(hunt.id, zoneKey);
    return c.redirect(`/hunts/${hunt.id}`, 303);
  });

  async function zonePage(
    c: PageContext,
    page: { hunt: Hunt; performance: string; values: ZoneFormValues | null; errors: FieldErrors; status: 200 | 400 | 500 },
  ) {
    const match = SHOWING_KEY.exec(page.performance);
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
    const viewHallKey = hallKey(view.performance.localId, view.performance.screenId);
    const options = {
      title: await movieTitleFor(deps, showingKey(view.performance.localId, view.performance.performanceId), view.performance.title, hunt.theatres),
      subtitle: ui.zonePage.hallSubtitle(hunt.name, view.performance.screenName),
      labels: copy.hall.labels,
    };
    const values = page.values ?? zoneFormValuesOf(hunt, viewHallKey);
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
                <input type="hidden" name="performance" value={showingKey(localId, performanceId)} />
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
    const match = SHOWING_KEY.exec(performance);
    if (!match) return c.notFound();
    const values: ZoneFormValues = { rows: bodyText(body, "rows"), seatFrom: bodyText(body, "seatFrom"), seatTo: bodyText(body, "seatTo") };
    let screenId: number;
    try {
      screenId = (await watcher.services.hall(Number(match[1]), Number(match[2]), hunt.id)).performance.screenId;
    } catch {
      return zonePage(c, { hunt, performance, values, errors: noErrors(), status: 500 });
    }
    const savedHallKey = hallKey(Number(match[1]), screenId);
    const config = watcher.config();
    const index = config.hunts.findIndex((item) => item.id === hunt.id);
    const zone = { kind: "absolute" as const, rows: splitList(values.rows), seatFrom: nullableNumber(values.seatFrom), seatTo: nullableNumber(values.seatTo) };
    const next: Config = {
      ...config,
      hunts: config.hunts.map((item) => (item.id === hunt.id ? { ...item, hallZones: { ...item.hallZones, [savedHallKey]: zone } } : item)),
    };
    const result = await watcher.saveConfig(next);
    if (result.ok) {
      await watcher.confirmHallZone(hunt.id, savedHallKey);
      return c.redirect(`/hunts/${hunt.id}`, 303);
    }
    return zonePage(c, { hunt, performance, values, errors: splitErrors(result.errors, `hunts[${index}].hallZones.${savedHallKey}`, zoneFieldOf), status: 400 });
  });
}
