import type { CatalogMovie } from "./types.js";
import { normalizeTitle } from "./uci.js";

const EXACT = 3;
const PREFIX = 2;
const TYPO = 1;
const MIN_WORD_LENGTH = 2;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

function typoAllowance(word: string): number {
  if (word.length >= 7) return 2;
  return word.length >= 4 ? 1 : 0;
}

function wordScore(word: string, tokens: string[]): number {
  const allowance = typoAllowance(word);
  let best = 0;
  for (const token of tokens) {
    if (token === word) return EXACT;
    if (token.startsWith(word)) best = Math.max(best, PREFIX);
    else if (allowance > 0 && Math.abs(token.length - word.length) <= allowance && editDistance(word, token) <= allowance) best = Math.max(best, TYPO);
  }
  return best;
}

export function searchMovies(catalog: CatalogMovie[], query: string): CatalogMovie[] {
  const words = normalizeTitle(query)
    .split(" ")
    .filter((word) => word.length >= MIN_WORD_LENGTH);
  if (words.length === 0) return [];
  const matches = catalog.flatMap((movie) => {
    const tokens = normalizeTitle(movie.title).split(" ");
    let score = 0;
    for (const word of words) {
      const points = wordScore(word, tokens);
      if (points === 0) return [];
      score += points;
    }
    return [{ movie, score, size: tokens.length }];
  });
  return matches
    .sort((a, b) => b.score - a.score || a.size - b.size || a.movie.title.localeCompare(b.movie.title, "it"))
    .map((match) => match.movie);
}
