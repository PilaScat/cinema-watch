import type { Hono } from "hono";
import { copy } from "../../copy.js";
import type { TelegramSource } from "../../config.js";
import type { Config, Settings } from "../../model.js";
import { renderPage, type AppDeps, type AppEnv } from "../app.js";
import { Button, Card, inputClass, LinkButton, Notice, PageHeader, type Tone } from "../components.js";
import {
  absoluteSummary,
  bodyText,
  bodyValues,
  CheckBox,
  FormGrid,
  noErrors,
  numberOf,
  optionalText,
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

type PageContext = Parameters<typeof renderPage>[0];

const ui = copy.ui.settings;
const EXPORT_NAME = "cinema-watch-config.json";
const TOKEN_TAIL = 4;

interface SettingsValues {
  chatId: string;
  publicUrl: string;
  interval: string;
  quietFrom: string;
  quietTo: string;
  digestEnabled: boolean;
  digestTime: string;
  albumSize: string;
  threshold: string;
  sellableTypes: string;
  zone: ZoneValues;
}

interface PageNotice {
  tone: Tone;
  text: string;
  lines?: string[];
}

function valuesOfSettings(settings: Settings): SettingsValues {
  return {
    chatId: settings.telegram.chatId ?? "",
    publicUrl: settings.publicUrl ?? "",
    interval: String(settings.defaultIntervalMinutes),
    quietFrom: settings.quietHours?.from ?? "",
    quietTo: settings.quietHours?.to ?? "",
    digestEnabled: settings.digest.enabled,
    digestTime: settings.digest.time,
    albumSize: String(settings.albumSize),
    threshold: String(settings.defaultLastSeatsThreshold),
    sellableTypes: settings.sellableTypes.join(", "),
    zone: zoneValuesOf(settings.defaultZone),
  };
}

function valuesOfBody(body: FormBody): SettingsValues {
  return {
    chatId: bodyText(body, "chatId"),
    publicUrl: bodyText(body, "publicUrl"),
    interval: bodyText(body, "interval"),
    quietFrom: bodyText(body, "quietFrom"),
    quietTo: bodyText(body, "quietTo"),
    digestEnabled: bodyValues(body, "digestEnabled").length > 0,
    digestTime: bodyText(body, "digestTime"),
    albumSize: bodyText(body, "albumSize"),
    threshold: bodyText(body, "threshold"),
    sellableTypes: bodyText(body, "sellableTypes"),
    zone: zoneValuesFromBody(body, "zone"),
  };
}

function settingsOfValues(values: SettingsValues, tokenChange: { token: string; clear: boolean }, base: Settings): Settings {
  const token = tokenChange.clear ? null : tokenChange.token === "" ? base.telegram.token : tokenChange.token;
  return {
    telegram: { token, chatId: optionalText(values.chatId) },
    publicUrl: optionalText(values.publicUrl),
    defaultIntervalMinutes: numberOf(values.interval),
    quietHours: values.quietFrom === "" && values.quietTo === "" ? null : { from: values.quietFrom, to: values.quietTo },
    digest: { enabled: values.digestEnabled, time: values.digestTime },
    albumSize: numberOf(values.albumSize),
    defaultLastSeatsThreshold: numberOf(values.threshold),
    sellableTypes: splitList(values.sellableTypes),
    defaultZone: zoneFromValues(values.zone, base.defaultZone),
  };
}

const SETTINGS_FIELDS: Record<string, string> = {
  "telegram.token": "token",
  "telegram.chatId": "chatId",
  publicUrl: "publicUrl",
  defaultIntervalMinutes: "interval",
  "quietHours.from": "quietFrom",
  "quietHours.to": "quietTo",
  quietHours: "quietFrom",
  "digest.time": "digestTime",
  albumSize: "albumSize",
  defaultLastSeatsThreshold: "threshold",
  sellableTypes: "sellableTypes",
  defaultZone: "zone",
};

function settingsFieldOf(rest: string): string | null {
  const head = rest.split("[")[0] ?? "";
  if (head.startsWith("defaultZone")) return "zone";
  return SETTINGS_FIELDS[head] ?? null;
}

interface TelegramView {
  token: string | null;
  chatId: string | null;
  source: { token: TelegramSource; chatId: TelegramSource };
}

function tokenPlaceholder(telegram: TelegramView): string {
  if (telegram.token === null) return ui.fields.tokenEmptyPlaceholder;
  const tail = telegram.token.slice(-TOKEN_TAIL);
  return telegram.source.token === "env" ? ui.fields.tokenFromEnv(tail) : ui.fields.tokenPlaceholder(tail);
}

function SettingsPage(props: {
  values: SettingsValues;
  errors: FieldErrors;
  telegram: TelegramView;
  urlRefused: boolean;
  zoneKept: string | undefined;
  notice: PageNotice | null;
}) {
  const { values } = props;
  const fieldError = props.errors.fields;
  return (
    <>
      <PageHeader title={ui.title} description={ui.description} />
      {props.notice ? (
        <Notice tone={props.notice.tone}>
          {props.notice.text}
          {props.notice.lines ? (
            <ul class="mt-1">
              {props.notice.lines.map((line) => (
                <li>{line}</li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}
      {props.errors.general.length > 0 ? (
        <Notice tone="danger">
          <ul>
            {props.errors.general.map((error) => (
              <li>{error}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <div class="flex flex-col gap-4">
        <form method="post" action="/settings" class="flex flex-col gap-4">
          <Card title={ui.sections.telegram} actions={<Button label={ui.actions.test} icon="send" size="sm" variant="outline" form="settings-test" />}>
            <FormGrid>
              <TextField
                name="token"
                label={ui.fields.token}
                value=""
                type="password"
                placeholder={tokenPlaceholder(props.telegram)}
                hint={props.telegram.source.token === "env" ? ui.fields.envHint : ui.fields.tokenHint}
                error={fieldError["token"]}
                autocomplete="off"
              />
              <TextField
                name="chatId"
                label={ui.fields.chatId}
                value={values.chatId}
                placeholder={props.telegram.source.chatId === "env" && props.telegram.chatId !== null ? ui.fields.chatIdFromEnv(props.telegram.chatId) : undefined}
                hint={props.telegram.source.chatId === "env" ? ui.fields.envHint : ui.fields.chatIdHint}
                error={fieldError["chatId"]}
              />
              <Wide>
                <CheckBox name="clearToken" value="1" label={ui.fields.clearToken} checked={false} />
              </Wide>
              <Wide>
                <TextField name="publicUrl" label={ui.fields.publicUrl} value={values.publicUrl} type="url" hint={props.urlRefused ? ui.fields.publicUrlRefused : ui.fields.publicUrlHint} error={fieldError["publicUrl"]} />
              </Wide>
            </FormGrid>
          </Card>
          <Card title={ui.sections.rounds}>
            <FormGrid>
              <TextField name="interval" label={ui.fields.interval} value={values.interval} type="number" min={1} max={1440} error={fieldError["interval"]} />
              <TextField name="albumSize" label={ui.fields.albumSize} value={values.albumSize} type="number" min={1} max={10} error={fieldError["albumSize"]} />
              <TextField name="quietFrom" label={ui.fields.quietFrom} value={values.quietFrom} type="time" error={fieldError["quietFrom"]} />
              <TextField name="quietTo" label={ui.fields.quietTo} value={values.quietTo} type="time" hint={ui.fields.quietHint} error={fieldError["quietTo"]} />
              <TextField name="digestTime" label={ui.fields.digestTime} value={values.digestTime} type="time" error={fieldError["digestTime"]} />
              <div class="flex items-end pb-2">
                <CheckBox name="digestEnabled" value="1" label={ui.fields.digestEnabled} checked={values.digestEnabled} />
              </div>
              <TextField name="threshold" label={ui.fields.threshold} value={values.threshold} type="number" min={0} error={fieldError["threshold"]} />
              <TextField
                name="sellableTypes"
                label={ui.fields.sellableTypes}
                value={values.sellableTypes}
                hint={ui.fields.sellableTypesHint}
                error={fieldError["sellableTypes"]}
              />
            </FormGrid>
          </Card>
          <Card title={ui.sections.zone}>
            <ZoneFields
              prefix="zone"
              values={values.zone}
              labels={{ from: ui.fields.zoneFrom, to: ui.fields.zoneTo, center: ui.fields.zoneCenter }}
              error={fieldError["zone"]}
              kept={props.zoneKept}
            />
          </Card>
          <div>
            <Button label={ui.actions.save} icon="check" variant="primary" />
          </div>
        </form>
        <form id="settings-test" method="post" action="/settings/test" />
        <Card title={ui.sections.backup}>
          <div class="mb-4 flex flex-wrap gap-2">
            <LinkButton href="/settings/export?token=0" label={ui.actions.exportWithout} icon="download" variant="outline" />
            <LinkButton href="/settings/export?token=1" label={ui.actions.exportWith} icon="download" variant="outline" />
          </div>
          <form method="post" action="/settings/import" enctype="multipart/form-data" class="flex flex-col gap-4">
            <div class="flex min-w-0 flex-col gap-1.5">
              <label for="config" class="text-sm font-semibold">
                {ui.backup.config}
              </label>
              <textarea id="config" name="config" rows={6} class={`${inputClass} h-auto py-2 font-mono`}></textarea>
              <p class="text-xs text-muted">{ui.backup.configHint}</p>
            </div>
            <div class="flex min-w-0 flex-col gap-1.5">
              <label for="file" class="text-sm font-semibold">
                {ui.backup.file}
              </label>
              <input id="file" name="file" type="file" accept="application/json,.json" class="text-sm" />
            </div>
            <div>
              <Button label={ui.actions.import} icon="upload" variant="outline" />
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}

export function registerSettingsRoutes(app: Hono<AppEnv>, deps: AppDeps): void {
  const watcher = deps.watcher;

  function urlRefused(config: Config): boolean {
    const check = watcher.state().publicUrlCheck;
    return check !== null && check.url === config.settings.publicUrl && !check.accepted;
  }

  function page(
    c: PageContext,
    options: { status?: 200 | 400; values?: SettingsValues; errors?: FieldErrors; notice?: PageNotice | null; importText?: string },
  ) {
    const config: Config = watcher.config();
    const zone = absoluteSummary(config.settings.defaultZone);
    return renderPage(c, deps, {
      title: ui.title,
      section: "settings",
      status: options.status ?? 200,
      body: (
        <SettingsPage
          values={options.values ?? valuesOfSettings(config.settings)}
          errors={options.errors ?? noErrors()}
          telegram={{ token: watcher.botToken(), chatId: watcher.primaryChat(), source: watcher.telegramSource() }}
          urlRefused={urlRefused(config)}
          zoneKept={zone ? ui.fields.zoneKept(zone.rows, zone.seats) : undefined}
          notice={options.notice ?? null}
        />
      ),
    });
  }

  app.get("/settings", (c) => {
    const test = c.req.query("test");
    const notice: PageNotice | null =
      test === "ok"
        ? { tone: "success", text: ui.test.ok }
        : test === "fail"
          ? { tone: "danger", text: ui.test.fail }
          : c.req.query("saved") === "1"
            ? { tone: "success", text: ui.saved }
            : null;
    return page(c, { notice });
  });

  app.post("/settings", async (c) => {
    const config = watcher.config();
    const body = await c.req.parseBody({ all: true });
    const values = valuesOfBody(body);
    const settings = settingsOfValues(values, { token: bodyText(body, "token"), clear: bodyValues(body, "clearToken").length > 0 }, config.settings);
    const result = await watcher.saveConfig({ ...config, settings });
    if (result.ok) return c.redirect("/settings?saved=1", 303);
    return page(c, { status: 400, values, errors: splitErrors(result.errors, "settings.", settingsFieldOf) });
  });

  app.post("/settings/test", async (c) => {
    const result = await watcher.sendTest();
    return c.redirect(`/settings?test=${result.ok ? "ok" : "fail"}`, 303);
  });

  app.get("/settings/export", (c) => {
    const text = watcher.exportConfig(c.req.query("token") === "1");
    return c.body(text, 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${EXPORT_NAME}"`,
      "cache-control": "no-store",
    });
  });

  app.post("/settings/import", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const upload = body["file"];
    const file = Array.isArray(upload) ? upload.find((item) => item instanceof File) : upload;
    const fromFile = file instanceof File && file.size > 0 ? await file.text() : "";
    const text = fromFile !== "" ? fromFile : bodyText(body, "config");
    if (text.trim() === "") return page(c, { status: 400, notice: { tone: "danger", text: ui.backup.empty } });
    const result = await watcher.importConfig(text);
    if (result.ok) return page(c, { notice: { tone: "success", text: ui.backup.imported } });
    return page(c, { status: 400, notice: { tone: "danger", text: ui.backup.failed, lines: result.errors } });
  });
}
