import { copy } from "../../copy.js";
import { formatDay } from "../../format.js";
import type { IsoDay } from "../../types.js";
import type { AppDeps } from "../app.js";

export const MAX_MOVIE_THEATRES = 3;

export interface ListedMovie {
  slug: string;
  title: string;
  formats: string[];
  firstDay: IsoDay;
  label: string;
}

async function programmingOf(deps: AppDeps, theatre: string) {
  try {
    return await deps.watcher.services.programming(theatre);
  } catch {
    return null;
  }
}

export async function listedMovies(deps: AppDeps, theatres: string[]): Promise<ListedMovie[] | null> {
  const picked = theatres.slice(0, MAX_MOVIE_THEATRES);
  const movies = new Map<string, { title: string; formats: string[]; firstDay: IsoDay }>();
  let read = 0;
  for (const theatre of picked) {
    const programming = await programmingOf(deps, theatre);
    if (programming === null) continue;
    read += 1;
    for (const [day, showings] of [...programming.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const showing of showings) {
        const entry = movies.get(showing.movie.slug) ?? { title: showing.movie.title, formats: [], firstDay: day };
        if (!entry.formats.includes(showing.formatGroup)) entry.formats.push(showing.formatGroup);
        if (day < entry.firstDay) entry.firstDay = day;
        movies.set(showing.movie.slug, entry);
      }
    }
  }
  if (picked.length > 0 && read === 0) return null;
  return [...movies.entries()]
    .map(([slug, entry]) => ({ slug, ...entry, label: copy.ui.hunts.movieOption(entry.title, entry.formats.join(", "), formatDay(entry.firstDay)) }))
    .sort((a, b) => a.title.localeCompare(b.title, "it"));
}
