import type { Child } from "hono/jsx";
import type { Zone } from "../../types.js";
import { cx, Field, inputClass } from "../components.js";

export type FormBody = Record<string, string | File | Array<string | File>>;

export function bodyValues(body: FormBody, name: string): string[] {
  const value = body[name];
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.flatMap((item) => (typeof item === "string" ? [item] : []));
}

export function bodyText(body: FormBody, name: string): string {
  return bodyValues(body, name)[0]?.trim() ?? "";
}

export function splitList(text: string): string[] {
  return text
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function numberOf(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

export function nullableNumber(text: string): number | null {
  return text.trim() === "" ? null : Number(text);
}

export function optionalText(text: string): string | null {
  return text === "" ? null : text;
}

export interface FieldErrors {
  fields: Record<string, string>;
  general: string[];
}

export function splitErrors(errors: string[], prefix: string, fieldOf: (rest: string) => string | null): FieldErrors {
  const result: FieldErrors = { fields: {}, general: [] };
  for (const error of errors) {
    const separator = error.indexOf(": ");
    const path = separator === -1 ? error : error.slice(0, separator);
    const message = separator === -1 ? error : error.slice(separator + 2);
    const field = path.startsWith(prefix) ? fieldOf(path.slice(prefix.length)) : null;
    if (field === null) result.general.push(error);
    else result.fields[field] ??= message;
  }
  return result;
}

export function noErrors(): FieldErrors {
  return { fields: {}, general: [] };
}

export interface ZoneValues {
  from: string;
  to: string;
  center: string;
}

export function zoneValuesOf(zone: Zone): ZoneValues {
  if (zone.kind === "absolute") return { from: "", to: "", center: "" };
  return { from: String(zone.rowsFromPercent), to: String(zone.rowsToPercent), center: String(zone.centerPercent) };
}

export function zoneFromValues(values: ZoneValues, base: Zone): Zone {
  if (values.from === "" && values.to === "" && values.center === "") return base;
  return { kind: "relative", rowsFromPercent: numberOf(values.from), rowsToPercent: numberOf(values.to), centerPercent: numberOf(values.center) };
}

export function zoneValuesFromBody(body: FormBody, prefix: string): ZoneValues {
  return { from: bodyText(body, `${prefix}From`), to: bodyText(body, `${prefix}To`), center: bodyText(body, `${prefix}Center`) };
}

export function absoluteSummary(zone: Zone): { rows: string; seats: string } | null {
  if (zone.kind !== "absolute") return null;
  return { rows: zone.rows.join(", "), seats: `${zone.seatFrom ?? "…"}-${zone.seatTo ?? "…"}` };
}

export function FormGrid(props: { children: Child; class?: string }) {
  return <div class={cx("grid min-w-0 gap-4 sm:grid-cols-2", props.class)}>{props.children}</div>;
}

export function Wide(props: { children: Child }) {
  return <div class="min-w-0 sm:col-span-2">{props.children}</div>;
}

export function TextField(props: {
  name: string;
  label: string;
  value: string;
  type?: "text" | "number" | "date" | "time" | "url" | "password";
  hint?: string;
  error?: string | undefined;
  placeholder?: string;
  min?: number;
  max?: number;
  autocomplete?: string;
}) {
  return (
    <Field label={props.label} for={props.name} hint={props.hint} error={props.error}>
      <input
        id={props.name}
        name={props.name}
        type={props.type ?? "text"}
        value={props.type === "password" ? undefined : props.value}
        placeholder={props.placeholder}
        min={props.min}
        max={props.max}
        autocomplete={props.autocomplete}
        inputmode={props.type === "number" ? "numeric" : undefined}
        aria-invalid={props.error ? "true" : undefined}
        class={inputClass}
      />
    </Field>
  );
}

export function CheckBox(props: { name: string; value: string; label: string; checked: boolean }) {
  return (
    <label class="flex min-w-0 items-center gap-2 text-sm">
      <input type="checkbox" name={props.name} value={props.value} checked={props.checked} class="size-4 shrink-0 accent-primary" />
      <span class="min-w-0">{props.label}</span>
    </label>
  );
}

export function Radio(props: { name: string; value: string; label: string; checked: boolean }) {
  return (
    <label class="flex items-center gap-2 text-sm">
      <input type="radio" name={props.name} value={props.value} checked={props.checked} class="size-4 shrink-0 accent-primary" />
      <span>{props.label}</span>
    </label>
  );
}

export function Group(props: { legend: string; hint?: string; error?: string | undefined; children: Child }) {
  return (
    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="mb-1.5 text-sm font-semibold">{props.legend}</legend>
      {props.children}
      {props.hint ? <p class="text-xs text-muted">{props.hint}</p> : null}
      {props.error ? <p class="text-xs font-semibold text-danger">{props.error}</p> : null}
    </fieldset>
  );
}

export function ZoneFields(props: { prefix: string; values: ZoneValues; labels: { from: string; to: string; center: string }; error?: string | undefined; kept?: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-2">
      <div class="grid grid-cols-3 gap-3">
        <TextField name={`${props.prefix}From`} label={props.labels.from} value={props.values.from} type="number" min={0} max={100} />
        <TextField name={`${props.prefix}To`} label={props.labels.to} value={props.values.to} type="number" min={0} max={100} />
        <TextField name={`${props.prefix}Center`} label={props.labels.center} value={props.values.center} type="number" min={1} max={100} />
      </div>
      {props.kept ? <p class="text-xs text-muted">{props.kept}</p> : null}
      {props.error ? <p class="text-xs font-semibold text-danger">{props.error}</p> : null}
    </div>
  );
}
