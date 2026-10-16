import type { AppDeps } from "../app.js";

export async function movieTitleFor(deps: AppDeps, key: string, fallback: string, theatres: string[]): Promise<string> {
  for (const hunt of Object.values(deps.watcher.state().hunts)) {
    const known = hunt.showings[key];
    if (known) return known.movieTitle;
  }
  for (const theatre of theatres) {
    try {
      for (const showings of (await deps.watcher.services.programming(theatre)).values()) {
        const found = showings.find((showing) => showing.key === key);
        if (found) return found.movie.title;
      }
    } catch {
      continue;
    }
  }
  return fallback;
}
