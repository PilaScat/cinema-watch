import type { Child } from "hono/jsx";
import { raw } from "hono/html";
import { copy } from "../copy.js";
import { Badge, cx, Icon } from "./components.js";
import type { IconName } from "./icon-set.js";
import { isNewerVersion } from "./version.js";

export type Section = "hunts" | "theatres" | "search" | "log" | "settings" | "none";

export interface PageContext {
  nonce: string;
  version: string;
  latestVersion: string | null;
}

const THEME_BOOT =
  "(function(){var t='system';try{t=localStorage.getItem('cinema-watch-theme')||'system'}catch(e){}" +
  "var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);" +
  "document.documentElement.classList.toggle('dark',d)})();";

const nav: Array<{ section: Exclude<Section, "none">; href: string; icon: IconName }> = [
  { section: "hunts", href: "/", icon: "ticket" },
  { section: "theatres", href: "/theatres", icon: "film" },
  { section: "search", href: "/search", icon: "search" },
  { section: "log", href: "/log", icon: "scrollText" },
  { section: "settings", href: "/settings", icon: "settings" },
];

const themes: Array<{ choice: "light" | "dark" | "system"; icon: IconName }> = [
  { choice: "light", icon: "sun" },
  { choice: "dark", icon: "moon" },
  { choice: "system", icon: "monitor" },
];

export function Layout(props: { title: string; section: Section; context: PageContext; children: Child }) {
  const ui = copy.ui.common;
  return (
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>{`${props.title} · ${ui.appName}`}</title>
        <script nonce={props.context.nonce}>{raw(THEME_BOOT)}</script>
        <link rel="stylesheet" href="/assets/app.css" />
        <link rel="icon" href="/assets/logo.svg" type="image/svg+xml" />
        <link rel="icon" href="/assets/icons/favicon-32.png" sizes="32x32" type="image/png" />
        <link rel="apple-touch-icon" href="/assets/icons/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#121014" />
        <script src="/assets/app.js" defer nonce={props.context.nonce}></script>
      </head>
      <body class="min-h-screen antialiased">
        <header class="border-b border-border bg-surface">
          <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <a href="/" class="flex items-center gap-2">
              <img src="/assets/logo.svg" alt="" width="32" height="32" class="size-8" />
              <span class="font-display text-2xl tracking-wide">{ui.appName}</span>
            </a>
            <nav aria-label={ui.nav.label} class="order-3 -mx-1 flex w-full gap-1 overflow-x-auto [scrollbar-width:none] sm:order-none sm:w-auto sm:flex-1">
              {nav.map((item) => (
                <a
                  href={item.href}
                  aria-current={props.section === item.section ? "page" : undefined}
                  class={cx(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold",
                    props.section === item.section ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground",
                  )}
                >
                  <Icon name={item.icon} />
                  {ui.nav[item.section]}
                </a>
              ))}
            </nav>
            <div class="ml-auto flex rounded-lg border border-border p-0.5" role="group" aria-label={ui.theme.label}>
              {themes.map((theme) => (
                <button
                  type="button"
                  data-theme-choice={theme.choice}
                  title={ui.theme[theme.choice]}
                  aria-label={ui.theme[theme.choice]}
                  class="rounded-md p-1.5 text-muted hover:text-foreground aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                >
                  <Icon name={theme.icon} />
                </button>
              ))}
            </div>
          </div>
        </header>
        <main class="mx-auto max-w-6xl px-4 py-6 sm:py-8">{props.children}</main>
        <footer class="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pb-8 text-xs text-muted">
          <span>{ui.version.current(props.context.version)}</span>
          {isNewerVersion(props.context.latestVersion, props.context.version) && props.context.latestVersion ? (
            <a href="https://github.com/PilaScat/cinema-watch/releases" target="_blank" rel="noopener noreferrer">
              <Badge tone="gold">{ui.version.update(props.context.latestVersion)}</Badge>
            </a>
          ) : null}
        </footer>
      </body>
    </html>
  );
}
