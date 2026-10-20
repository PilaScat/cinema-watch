import type { Context } from "hono";

const MAX_FROM = 1000;
const BASE = "http://local.invalid";

function hasControl(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127 || char === "\\";
  });
}

export function localPath(value: string | undefined): string | null {
  if (value === undefined || value.length === 0 || value.length > MAX_FROM) return null;
  if (!value.startsWith("/") || value.startsWith("//") || hasControl(value)) return null;
  let parsed: URL;
  try {
    parsed = new URL(value, BASE);
  } catch {
    return null;
  }
  return parsed.origin === BASE ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
}

export function fromOf(c: Context): string | null {
  return localPath(c.req.query("from"));
}

export function backHref(c: Context, fallback: string): string {
  return fromOf(c) ?? fallback;
}

export function hereOf(c: Context): string {
  const url = new URL(c.req.url);
  return `${url.pathname}${url.search}`;
}

export function withFrom(href: string, from: string | null): string {
  if (from === null) return href;
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}
