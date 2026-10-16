import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";

const LOCK_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;
const COMPARE_SALT = randomBytes(16);
const COMPARE_LENGTH = 32;

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

function stretched(password: string): Buffer {
  return scryptSync(password, COMPARE_SALT, COMPARE_LENGTH);
}

export function samePassword(given: string, expected: string): boolean {
  return timingSafeEqual(stretched(given), stretched(expected));
}

export function createLockout(now: () => number) {
  const attempts = new Map<string, { failures: number; until: number }>();
  return {
    locked(ip: string): boolean {
      const entry = attempts.get(ip);
      return entry !== undefined && entry.until > now();
    },
    fail(ip: string): void {
      const entry = attempts.get(ip) ?? { failures: 0, until: 0 };
      const failures = entry.failures + 1;
      attempts.set(ip, failures >= LOCK_ATTEMPTS ? { failures: 0, until: now() + LOCK_MS } : { failures, until: 0 });
    },
    succeed(ip: string): void {
      attempts.delete(ip);
    },
  };
}
