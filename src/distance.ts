import type { Theatre } from "./types.js";

const EARTH_RADIUS_KM = 6371;
const PRECISE_UNDER_KM = 10;

export interface Position {
  lat: number;
  lon: number;
}

export interface TheatreDistance {
  theatre: Theatre;
  km: number | null;
}

const preciseKm = new Intl.NumberFormat("it-IT", { style: "unit", unit: "kilometer", maximumFractionDigits: 1 });
const roundKm = new Intl.NumberFormat("it-IT", { style: "unit", unit: "kilometer", maximumFractionDigits: 0 });

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceKm(a: Position, b: Position): number {
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatKm(km: number): string {
  return Math.round(km * 10) / 10 < PRECISE_UNDER_KM ? preciseKm.format(km) : roundKm.format(km);
}

export function byDistance(theatres: Theatre[], home: Position, radiusKm: number | null): { near: TheatreDistance[]; far: TheatreDistance[] } {
  const measured = theatres
    .map((theatre): TheatreDistance => ({
      theatre,
      km: theatre.lat === null || theatre.lon === null ? null : distanceKm(home, { lat: theatre.lat, lon: theatre.lon }),
    }))
    .sort((a, b) => (a.km ?? Number.POSITIVE_INFINITY) - (b.km ?? Number.POSITIVE_INFINITY) || a.theatre.name.localeCompare(b.theatre.name, "it"));
  if (radiusKm === null) return { near: measured, far: [] };
  return {
    near: measured.filter((item) => item.km !== null && item.km <= radiusKm),
    far: measured.filter((item) => item.km === null || item.km > radiusKm),
  };
}
