import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { iconSet, type IconName } from "./icon-set.js";

export function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function Icon(props: { name: IconName; class?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={cx("size-4 shrink-0", props.class)}
    >
      {raw(iconSet[props.name])}
    </svg>
  );
}

export const displayClass = "font-display text-2xl tracking-wide";
export const tileClass = "rounded-xl border border-border bg-surface";
export const linkTileClass = `${tileClass} hover:border-primary`;
export const textLinkClass = "font-semibold text-primary hover:underline";

export function SectionTitle(props: { children: Child }) {
  return <h2 class={cx("mb-3 text-muted", displayClass)}>{props.children}</h2>;
}

export function TextLink(props: { href: string; children: Child; class?: string }) {
  return (
    <a href={props.href} class={cx(textLinkClass, props.class)}>
      {props.children}
    </a>
  );
}

export function Rows(props: { children: Child; class?: string }) {
  return <ul class={cx("flex flex-col divide-y divide-border", props.class)}>{props.children}</ul>;
}

export function FilterForm(props: { action: string; children: Child }) {
  return (
    <form method="get" action={props.action} class="mb-6 flex flex-wrap items-end gap-3">
      {props.children}
    </form>
  );
}

export function PageHeader(props: { title: string; description?: string; actions?: Child }) {
  return (
    <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <h1 class="font-display text-4xl tracking-wide sm:text-5xl">{props.title}</h1>
        {props.description ? <p class="mt-1 text-muted">{props.description}</p> : null}
      </div>
      {props.actions ? <div class="flex flex-wrap items-center gap-2">{props.actions}</div> : null}
    </div>
  );
}

export function Card(props: { title?: string; actions?: Child; children?: Child; class?: string; id?: string }) {
  return (
    <section id={props.id} class={cx(tileClass, "p-4 sm:p-5", props.class)}>
      {props.title || props.actions ? (
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          {props.title ? <h2 class={displayClass}>{props.title}</h2> : <span />}
          {props.actions ? <div class="flex items-center gap-2">{props.actions}</div> : null}
        </div>
      ) : null}
      {props.children}
    </section>
  );
}

export type Variant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type Size = "md" | "sm" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "bg-surface-2 text-foreground hover:bg-border",
  outline: "border border-border bg-transparent text-foreground hover:bg-surface-2",
  ghost: "bg-transparent text-foreground hover:bg-surface-2",
  danger: "bg-transparent text-danger hover:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  md: "h-10 px-4 text-sm",
  sm: "h-8 px-3 text-sm",
  icon: "h-8 w-8",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md"): string {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60",
    variants[variant],
    sizes[size],
  );
}

export interface ButtonProps {
  label: string;
  icon?: IconName;
  variant?: Variant;
  size?: Size;
  type?: "submit" | "button";
  name?: string;
  value?: string;
  form?: string;
  confirm?: string;
  formaction?: string;
}

export function Button(props: ButtonProps) {
  const iconOnly = props.size === "icon";
  return (
    <button
      type={props.type ?? "submit"}
      class={buttonClass(props.variant, props.size)}
      name={props.name}
      value={props.value}
      form={props.form}
      formaction={props.formaction}
      data-confirm={props.confirm}
      title={iconOnly ? props.label : undefined}
      aria-label={iconOnly ? props.label : undefined}
    >
      {props.icon ? <Icon name={props.icon} class="busy-icon" /> : null}
      {iconOnly ? null : <span data-label>{props.label}</span>}
    </button>
  );
}

export function LinkButton(props: { href: string; label: string; icon?: IconName; variant?: Variant; size?: Size; external?: boolean }) {
  const iconOnly = props.size === "icon";
  return (
    <a
      href={props.href}
      class={buttonClass(props.variant, props.size)}
      title={iconOnly ? props.label : undefined}
      aria-label={iconOnly ? props.label : undefined}
      target={props.external ? "_blank" : undefined}
      rel={props.external ? "noopener noreferrer" : undefined}
    >
      {props.icon ? <Icon name={props.icon} /> : null}
      {iconOnly ? null : <span>{props.label}</span>}
    </a>
  );
}

export function PreviewButton(props: { url: string; label: string; title: string; class?: string }) {
  return (
    <button
      type="button"
      data-preview={props.url}
      aria-expanded="false"
      title={props.title}
      class={cx(
        "inline-flex items-center gap-1 rounded-md underline decoration-dotted underline-offset-4 hover:text-primary",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        props.class,
      )}
    >
      <Icon name="armchair" class="busy-icon" />
      {props.label}
    </button>
  );
}

export function PreviewPanel() {
  return <div data-preview-panel hidden class="w-full"></div>;
}

export function ActionForm(props: { action: string; children: Child; class?: string }) {
  return (
    <form method="post" action={props.action} class={cx("inline", props.class)}>
      {props.children}
    </form>
  );
}

export type Tone = "neutral" | "success" | "gold" | "danger" | "muted";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-foreground",
  success: "bg-success-soft text-success",
  gold: "bg-gold-soft text-gold",
  danger: "bg-danger-soft text-danger",
  muted: "bg-transparent text-muted border border-border",
};

export function Badge(props: { tone?: Tone; children: Child }) {
  return (
    <span class={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[props.tone ?? "neutral"])}>
      {props.children}
    </span>
  );
}

const controlClass = "w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export const inputClass = `h-10 ${controlClass}`;
export const textareaClass = `py-2 ${controlClass}`;
export const smallSelectClass = "h-8 rounded-lg border border-border bg-background px-2 text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export function Field(props: { label: string; for: string; hint?: string; error?: string; children: Child }) {
  return (
    <div class="flex min-w-0 flex-col gap-1.5">
      <label for={props.for} class="text-sm font-semibold">
        {props.label}
      </label>
      {props.children}
      {props.hint ? <p class="text-xs text-muted">{props.hint}</p> : null}
      {props.error ? <p class="text-xs font-semibold text-danger">{props.error}</p> : null}
    </div>
  );
}

export function Stat(props: { label: string; value?: string | number; tone?: "gold"; class?: string; children?: Child }) {
  return (
    <div class={cx(tileClass, "px-4 py-3", props.class)}>
      <dt class="text-xs font-semibold uppercase tracking-wide text-muted">{props.label}</dt>
      {props.value === undefined ? null : <dd class={cx("font-display text-4xl leading-tight tracking-wide", props.tone === "gold" && "text-gold")}>{props.value}</dd>}
      {props.children ? <dd class="mt-1.5 flex flex-wrap gap-1.5">{props.children}</dd> : null}
    </div>
  );
}

export function Chips(props: { items: string[]; tone?: Tone; class?: string }) {
  return (
    <ul class={cx("flex flex-wrap gap-1.5", props.class)}>
      {props.items.map((item) => (
        <li>
          <Badge tone={props.tone}>{item}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function Empty(props: { text: string; hint?: Child }) {
  return (
    <div class="rounded-xl border border-dashed border-border p-8 text-center">
      <p class="font-semibold">{props.text}</p>
      {props.hint ? <p class="mt-1 text-sm text-muted">{props.hint}</p> : null}
    </div>
  );
}

export function Notice(props: { tone?: Tone; children: Child }) {
  return (
    <div class={cx("mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm", tones[props.tone ?? "gold"])}>
      <Icon name="circleAlert" />
      <div>{props.children}</div>
    </div>
  );
}
