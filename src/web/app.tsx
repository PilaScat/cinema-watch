import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getSignedCookie, setSignedCookie, deleteCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { NONCE, secureHeaders } from "hono/secure-headers";
import type { Child } from "hono/jsx";
import { copy } from "../copy.js";
import type { Watcher } from "../watcher.js";
import { createLockout, loadSecret, samePassword } from "./auth.js";
import { Button, Card, Field, inputClass, Notice } from "./components.js";
import { Layout, type PageContext, type Section } from "./layout.js";
import { registerBrowseRoutes } from "./routes/browse.js";
import { registerHomeRoutes } from "./routes/home.js";
import { registerHuntZoneRoutes } from "./routes/hunt-zone.js";
import { registerHuntsRoutes } from "./routes/hunts.js";
import { registerLogRoutes } from "./routes/log.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { statusOf } from "./status.js";

export interface AppDeps {
  watcher: Watcher;
  version: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  now?: () => number;
  publicDir?: string;
  assetsDir?: string;
}

export interface AppEnv {
  Variables: {
    secureHeadersNonce?: string;
  };
}

const BODY_LIMIT = 1024 * 1024;
const SESSION_COOKIE = "cw_session";
const SESSION_DAYS = 30;
const OPEN_PATHS = [/^\/health$/, /^\/api\/status$/, /^\/assets\//, /^\/manifest\.webmanifest$/, /^\/login$/];
const ASSET_NAME = /^[A-Za-z0-9-]+\.(png|svg|ttf|css|js)$/;
const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
};

const defaultPublicDir = fileURLToPath(new URL("../public/", import.meta.url));
const defaultAssetsDir = fileURLToPath(new URL("../../assets/", import.meta.url));

export function pageContext(c: Context<AppEnv>, deps: AppDeps): PageContext {
  return {
    nonce: c.get("secureHeadersNonce") ?? "",
    version: deps.version,
    latestVersion: deps.watcher.state().latestVersion,
  };
}

export function renderPage(c: Context<AppEnv>, deps: AppDeps, page: { title: string; section: Section; body: Child; status?: 200 | 400 | 404 | 500 }) {
  return c.html(
    <Layout title={page.title} section={page.section} context={pageContext(c, deps)}>
      {page.body}
    </Layout>,
    page.status ?? 200,
  );
}

export function backTo(c: Context<AppEnv>, fallback = "/"): Response {
  const referer = c.req.header("referer");
  let target = fallback;
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === new URL(c.req.url).host) target = `${url.pathname}${url.search}`;
    } catch {
      target = fallback;
    }
  }
  return c.redirect(target, 303);
}

function arrivedOverHttps(c: Context<AppEnv>, publicUrl: string | null): boolean {
  const url = new URL(c.req.url);
  if (url.protocol === "https:" || c.req.header("x-forwarded-proto") === "https") return true;
  if (publicUrl === null) return false;
  const configured = new URL(publicUrl);
  return configured.protocol === "https:" && configured.host === url.host;
}

function clientIp(c: Context<AppEnv>, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "local";
}

function LoginPage(props: { error?: string }) {
  const ui = copy.ui.common.login;
  return (
    <div class="mx-auto max-w-sm">
      <Card title={ui.title}>
        {props.error ? <Notice tone="danger">{props.error}</Notice> : null}
        <form method="post" action="/login" class="flex flex-col gap-4">
          <Field label={ui.password} for="password">
            <input id="password" name="password" type="password" required autocomplete="current-password" class={inputClass} />
          </Field>
          <Button label={ui.submit} icon="logIn" variant="primary" />
        </form>
      </Card>
    </div>
  );
}

export async function createApp(deps: AppDeps): Promise<Hono<AppEnv>> {
  const app = new Hono<AppEnv>();
  const now = deps.now ?? Date.now;
  const password = deps.env.UI_PASSWORD?.trim() ?? "";
  const trustProxy = deps.env.TRUST_PROXY === "1";
  const secret = password ? await loadSecret(deps.dataDir) : "";
  const lockout = createLockout(now);
  const publicDir = deps.publicDir ?? defaultPublicDir;
  const assetsDir = deps.assetsDir ?? defaultAssetsDir;

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", NONCE],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https://storage.googleapis.com", "https://secure.webtic.it", "https://www.thespacecinema.it"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
      referrerPolicy: "same-origin",
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
    }),
  );
  app.use(async (c, next) => {
    await next();
    if (arrivedOverHttps(c, deps.watcher.config().settings.publicUrl)) c.res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  });
  app.use(bodyLimit({ maxSize: BODY_LIMIT }));
  app.use(csrf());

  app.use(async (c, next) => {
    if (!password || OPEN_PATHS.some((pattern) => pattern.test(c.req.path))) return next();
    const session = await getSignedCookie(c, secret, SESSION_COOKIE);
    if (session === "ok") return next();
    return c.redirect("/login", 303);
  });

  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/api/status", (c) => c.json(statusOf(deps.watcher, deps.version, now())));

  app.get("/manifest.webmanifest", (c) =>
    c.json(
      {
        name: copy.ui.common.appName,
        short_name: copy.ui.common.appName,
        start_url: "/",
        display: "standalone",
        background_color: "#121014",
        theme_color: "#121014",
        icons: [
          { src: "/assets/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/assets/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/assets/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      200,
      { "content-type": "application/manifest+json" },
    ),
  );

  app.get("/assets/:folder{(fonts|icons)}/:name", (c) => serveFile(c, join(assetsDir, c.req.param("folder")), c.req.param("name")));
  app.get("/assets/:name", (c) => {
    const name = c.req.param("name");
    return serveFile(c, name === "logo.svg" ? assetsDir : publicDir, name);
  });

  app.get("/login", (c) => (password ? renderPage(c, deps, { title: copy.ui.common.login.title, section: "none", body: <LoginPage /> }) : c.redirect("/", 303)));
  app.post("/login", async (c) => {
    if (!password) return c.redirect("/", 303);
    const ip = clientIp(c, trustProxy);
    if (lockout.locked(ip)) {
      return renderPage(c, deps, { title: copy.ui.common.login.title, section: "none", status: 400, body: <LoginPage error={copy.ui.common.login.locked} /> });
    }
    const form = await c.req.parseBody();
    const given = typeof form.password === "string" ? form.password : "";
    if (!samePassword(given, password)) {
      lockout.fail(ip);
      return renderPage(c, deps, { title: copy.ui.common.login.title, section: "none", status: 400, body: <LoginPage error={copy.ui.common.login.wrong} /> });
    }
    lockout.succeed(ip);
    await setSignedCookie(c, SESSION_COOKIE, "ok", secret, {
      httpOnly: true,
      sameSite: "Strict",
      secure: new URL(c.req.url).protocol === "https:",
      path: "/",
      maxAge: SESSION_DAYS * 24 * 60 * 60,
    });
    return c.redirect("/", 303);
  });
  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.redirect("/login", 303);
  });

  registerHomeRoutes(app, deps);
  registerHuntsRoutes(app, deps);
  registerHuntZoneRoutes(app, deps);
  registerBrowseRoutes(app, deps);
  registerLogRoutes(app, deps);
  registerSettingsRoutes(app, deps);

  app.notFound((c) =>
    renderPage(c, deps, {
      title: copy.ui.common.notFound.title,
      section: "none",
      status: 404,
      body: <Notice tone="muted">{copy.ui.common.notFound.description}</Notice>,
    }),
  );
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    deps.watcher.logger.error("web", { path: c.req.path, error: error.message });
    return renderPage(c, deps, {
      title: copy.ui.common.failure.title,
      section: "none",
      status: 500,
      body: <Notice tone="danger">{copy.ui.common.failure.description}</Notice>,
    });
  });

  return app;
}

async function serveFile(c: Context<AppEnv>, dir: string, name: string): Promise<Response> {
  if (!ASSET_NAME.test(name)) return c.notFound();
  const extension = name.split(".").pop() ?? "";
  try {
    const body = await readFile(join(dir, name));
    return c.body(new Uint8Array(body), 200, {
      "content-type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "cache-control": "public, max-age=3600",
    });
  } catch {
    return c.notFound();
  }
}
