import { raw } from "hono/html";
import { romeMidnightsBetween } from "../../dates.js";
import type { HistoryPoint } from "../../history.js";
import { renderTrendSvg } from "../../chart-svg.js";
import type { SeatAnalysis, Showing, Theatre } from "../../types.js";
import { Badge, Card, cx, displayClass, Icon, linkTileClass, PreviewButton, PreviewPanel, SectionTitle } from "../components.js";
import { copy, formatDayOf, formatDayTime, formatKm } from "../i18n.js";

const TREND_WIDTH = 640;
const TREND_HEIGHT = 240;

function kmLabel(city: string, km: number | null | undefined): string {
  return km === null || km === undefined ? city : [city, formatKm(km)].filter((part) => part !== "").join(" · ");
}

export function TheatreGroup(props: { region: string; theatres: Theatre[]; distances?: Map<string, number | null> }) {
  const ui = copy.ui.theatres;
  return (
    <section class="mb-8">
      <SectionTitle>{props.region}</SectionTitle>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {props.theatres.map((theatre) => (
          <a href={`/theatres/${theatre.slug}`} class={cx("block p-4", linkTileClass)}>
            <div class="flex items-start justify-between gap-2">
              <span class="font-semibold">{theatre.name}</span>
              <span class="flex shrink-0 gap-1.5">
                {theatre.isLuxe ? <Badge tone="gold">{ui.luxe}</Badge> : null}
                <Badge tone="muted">{ui.chains[theatre.chain]}</Badge>
              </span>
            </div>
            <p class="mt-1 flex items-center gap-1 text-sm text-muted">
              <Icon name="mapPin" />
              {kmLabel(theatre.city, props.distances?.get(theatre.slug))}
            </p>
            <div class="mt-3 flex flex-wrap gap-1.5">
              {theatre.screens.map((screen) => (
                <Badge>{screen}</Badge>
              ))}
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

export function MovieCard(props: { href: string; title: string; poster: string | null; formats: string[]; detail: string }) {
  return (
    <a href={props.href} class={cx("flex gap-3 p-3", linkTileClass)}>
      {props.poster ? (
        <img src={props.poster} alt="" loading="lazy" class="h-28 w-20 shrink-0 rounded-md object-cover" />
      ) : (
        <div class="flex h-28 w-20 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">
          <Icon name="film" class="size-6" />
        </div>
      )}
      <div class="min-w-0">
        <p class="font-semibold">{props.title}</p>
        {props.detail === "" ? null : <p class="mt-1 text-sm text-muted">{props.detail}</p>}
        <div class="mt-2 flex flex-wrap gap-1.5">
          {props.formats.map((format) => (
            <Badge>{format}</Badge>
          ))}
        </div>
      </div>
    </a>
  );
}

export function DayTabs(props: { days: Array<{ day: string; label: string }>; selected: string; from?: string | null }) {
  return (
    <nav aria-label={copy.ui.theatres.daysLabel} class="mb-4 flex flex-wrap gap-2">
      {props.days.map((item) => (
        <a
          href={`?${new URLSearchParams({ day: item.day, ...(props.from ? { from: props.from } : {}) }).toString()}`}
          aria-current={item.day === props.selected ? "page" : undefined}
          class={cx(
            "rounded-lg border px-3 py-2 text-sm font-semibold",
            item.day === props.selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-surface-2",
          )}
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function ShowingRow(props: { href: string; previewUrl: string; showing: Showing; analysis: SeatAnalysis | null | undefined }) {
  const ui = copy.ui.theatres;
  const { showing, analysis } = props;
  return (
    <div data-preview-row class={cx("flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3", linkTileClass)}>
      <a href={props.href} class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span class={displayClass}>{showing.time}</span>
        <Badge>{showing.formatGroup}</Badge>
        {showing.language ? <span class="text-sm text-muted">{showing.language}</span> : null}
        <span class="text-sm text-muted">{showing.room}</span>
      </a>
      <span class="flex flex-wrap items-center gap-x-4 text-sm">
        {analysis ? (
          <>
            <span>{ui.free(analysis.free)}</span>
            <PreviewButton
              url={props.previewUrl}
              label={ui.freeGood(analysis.freeInZone)}
              title={ui.previewTitle}
              class={analysis.freeInZone > 0 ? "font-semibold text-gold" : "text-muted"}
            />
          </>
        ) : analysis === null ? (
          <span class="text-muted">{ui.hallUnavailable}</span>
        ) : (
          <PreviewButton url={props.previewUrl} label={ui.openHall} title={ui.previewTitle} class="text-muted" />
        )}
      </span>
      <PreviewPanel />
    </div>
  );
}

export function HallPreview(props: { dark: string; light: string; analysis: SeatAnalysis; best: string[]; tiers: string[] }) {
  const ui = copy.ui.theatres;
  return (
    <div class="mt-3 rounded-lg border border-border bg-background p-3">
      <p class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span>{ui.free(props.analysis.free)}</span>
        <span class={props.analysis.freeInZone > 0 ? "font-semibold text-gold" : "text-muted"}>{ui.freeGood(props.analysis.freeInZone)}</span>
        {props.tiers.map((tier) => (
          <span class="text-muted">{tier}</span>
        ))}
      </p>
      <HallPair dark={props.dark} light={props.light} />
      {props.best.length > 0 ? (
        <p class="mt-2 flex flex-wrap gap-1.5">
          {props.best.map((group) => (
            <Badge tone="gold">{group}</Badge>
          ))}
        </p>
      ) : null}
    </div>
  );
}

export function HallPair(props: { dark: string; light: string }) {
  return (
    <>
      <div class="hall-svg dark:hidden">{raw(props.light)}</div>
      <div class="hall-svg hidden dark:block">{raw(props.dark)}</div>
    </>
  );
}

export function TrendSection(props: { points: HistoryPoint[] }) {
  const ui = copy.ui.performance;
  if (props.points.length < 2) {
    return (
      <Card title={ui.trendTitle}>
        <p class="text-sm text-muted">{ui.trendWaiting}</p>
      </Card>
    );
  }
  const times = props.points.map((point) => point.t);
  const svg = renderTrendSvg(props.points, {
    width: TREND_WIDTH,
    height: TREND_HEIGHT,
    labels: { free: ui.legendFree, freeGood: ui.legendGood, time: formatDayTime },
    dayMarks: romeMidnightsBetween(Math.min(...times), Math.max(...times)).map((t) => ({ t, label: formatDayOf(t) })),
  });
  return (
    <Card title={ui.trendTitle}>
      <div data-trend>
        <ul class="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <li class="flex items-center gap-2">
            <span class="chart-swatch-1 inline-block size-3 rounded-full"></span>
            {ui.legendFree}
          </li>
          <li class="flex items-center gap-2">
            <span class="chart-swatch-2 inline-block size-3 rounded-full"></span>
            {ui.legendGood}
          </li>
        </ul>
        <div class="[&_svg]:h-auto [&_svg]:w-full">{raw(svg)}</div>
        <p hidden role="status" data-trend-tooltip data-free-label={ui.legendFree} data-good-label={ui.legendGood} class="mt-2 text-sm"></p>
        <details class="mt-3">
          <summary class="cursor-pointer text-sm text-muted">{ui.tableSummary}</summary>
          <table class="mt-2 w-full text-left text-sm">
            <thead>
              <tr class="text-muted">
                <th class="py-1 pr-4 font-semibold">{ui.columnTime}</th>
                <th class="py-1 pr-4 font-semibold">{ui.legendFree}</th>
                <th class="py-1 font-semibold">{ui.legendGood}</th>
              </tr>
            </thead>
            <tbody>
              {props.points.map((point) => (
                <tr>
                  <td class="py-1 pr-4">{formatDayTime(point.t)}</td>
                  <td class="py-1 pr-4">{point.free}</td>
                  <td class="py-1">{point.freeGood}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
    </Card>
  );
}
