export const SLUG = /^[a-z0-9-]+$/;
export const HUNT_ID = /^[a-z0-9]{8}$/;
export const HALL_KEY = /^(?:\d+-\d+|space-\d+-[a-z0-9-]+|t18-[a-z0-9-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const SHOWING_KEY = /^(?:\d+-\d+|space-\d+-\d+|t18-[a-z0-9-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export const T18_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,4}18tickets\.it$/;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isT18Host(host: string): boolean {
  return T18_HOST.test(host);
}

export function showingKey(localId: number, performanceId: number): string {
  return `${localId}-${performanceId}`;
}

export function hallKey(localId: number, screenId: number): string {
  return `${localId}-${screenId}`;
}
