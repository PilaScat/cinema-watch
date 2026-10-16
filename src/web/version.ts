const VERSION = /^v(\d+)\.(\d+)\.(\d+)$/;

function partsOf(version: string): number[] | null {
  const match = VERSION.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewerVersion(latest: string | null, current: string): boolean {
  const next = latest === null ? null : partsOf(latest);
  const now = partsOf(current);
  if (next === null || now === null) return false;
  const index = next.findIndex((value, position) => value !== now[position]);
  return index !== -1 && (next[index] ?? 0) > (now[index] ?? 0);
}
