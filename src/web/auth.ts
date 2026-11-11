import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";

const LOCK_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;
const COMPARE_SALT = randomBytes(16);
const COMPARE_LENGTH = 32;
const TAG_LENGTH = 32;
const MAX_TRACKED = 1000;

export async function loadSecret(dataDir: string): Promise<string> {
  const file = join(dataDir, "secret");
  try {
    const existing = (await readFile(file, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {
    return createSecret(file);
  }
  return createSecret(file);
}

async function createSecret(file: string): Promise<string> {
  const secret = randomBytes(32).toString("hex");
  await writeFile(file, secret, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => undefined);
  return secret;
}

function stretched(password: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, COMPARE_SALT, COMPARE_LENGTH, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function createPasswordCheck(expected: string): (given: string) => Promise<boolean> {
  const target = stretched(expected);
  return async (given) => timingSafeEqual(await stretched(given), await target);
}

function passwordTag(secret: string, password: string): string {
  return createHmac("sha256", secret).update(password).digest("hex").slice(0, TAG_LENGTH);
}

export function sessionValue(secret: string, password: string, expiresAt: number): string {
  return `${expiresAt}.${passwordTag(secret, password)}`;
}

export function sessionValid(value: string | false | undefined, secret: string, password: string, at: number): boolean {
  if (typeof value !== "string") return false;
  const [expires, tag, ...rest] = value.split(".");
  if (expires === undefined || tag === undefined || rest.length > 0 || !/^\d+$/.test(expires)) return false;
  const expected = Buffer.from(passwordTag(secret, password));
  const given = Buffer.from(tag);
  return Number(expires) > at && given.length === expected.length && timingSafeEqual(given, expected);
}

const PRIVATE_SUFFIXES = [".local", ".lan", ".internal", ".home.arpa", ".localhost"];

export function hostAllowed(hostname: string, publicUrl: string | null): boolean {
  const host = hostname.toLowerCase();
  if (host.startsWith("[") || isIP(host) !== 0) return true;
  if (!host.includes(".") || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  return publicUrl !== null && new URL(publicUrl).hostname.toLowerCase() === host;
}

export function createLockout(now: () => number) {
  const attempts = new Map<string, { failures: number; until: number; seenAt: number }>();
  function forget(): void {
    const at = now();
    for (const [ip, entry] of attempts) {
      if (entry.until <= at && entry.seenAt + LOCK_MS <= at) attempts.delete(ip);
    }
    for (const ip of attempts.keys()) {
      if (attempts.size < MAX_TRACKED) break;
      attempts.delete(ip);
    }
  }
  return {
    locked(ip: string): boolean {
      const entry = attempts.get(ip);
      return entry !== undefined && entry.until > now();
    },
    fail(ip: string): void {
      forget();
      const failures = (attempts.get(ip)?.failures ?? 0) + 1;
      const seenAt = now();
      attempts.delete(ip);
      attempts.set(ip, failures >= LOCK_ATTEMPTS ? { failures: 0, until: seenAt + LOCK_MS, seenAt } : { failures, until: 0, seenAt });
    },
    succeed(ip: string): void {
      attempts.delete(ip);
    },
    tracked: (): number => attempts.size,
  };
}
