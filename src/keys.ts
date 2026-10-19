export const SLUG = /^[a-z0-9-]+$/;
export const HUNT_ID = /^[a-z0-9]{8}$/;
export const HALL_KEY = /^(?:\d+-\d+|space-\d+-[a-z0-9-]+)$/;
export const SHOWING_KEY = /^(?:\d+-\d+|space-\d+-\d+)$/;
export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function showingKey(localId: number, performanceId: number): string {
  return `${localId}-${performanceId}`;
}

export function hallKey(localId: number, screenId: number): string {
  return `${localId}-${screenId}`;
}
