import type { CatalogMovie } from "./types.js";
import { normalizeTitle } from "./uci.js";

export interface MovieVariant {
  slug: string;
  title: string;
}

export interface MovieGroup extends CatalogMovie {
  variants: MovieVariant[];
}

const LANGUAGE = ["it", "ita", "italiano", "en", "eng", "inglese", "de", "vos", "v o s", "o v", "v o", "vo", "ov", "sub ita", "v originale sub ita", "vers originale", "versione originale", "original version", "original language", "lingua originale"];
const FORMAT = ["2d", "3d", "4k", "in 4k", "70mm", "imax", "sala imax", "atmos", "dolby atmos", "sala atmos", "laser", "screenx", "infinity", "infinity vision", "infinity v", "i v"];
const RATING = ["v m 1[48]", "vm ?1[48]", "v m 1[48] anni"];
const ANNIVERSARY = "\\d+(?:th)? ann(?:iversario|iversary)?";
const EVENT = ["ospiti", "ospiti in sala", "ospite regista", "evento", "talk", "screen talk", "dibattito", "film cena", "con colazione", "anteprima", "ried", "riedizione", "re release", "re rel", "regista in sala", "al cinema con te", ANNIVERSARY];
const TIMING = ["h \\d \\d\\d", "\\d \\d\\d", "\\d ?h ?\\d\\d", "\\d{1,2} \\d{1,2} ore \\d\\d \\d\\d", "\\d{1,2} (?:gen|feb|mar|apr|mag|giu|lug|ago|set|ott|nov|dic)"];
const BARE = ["3d", "4k", "in 4k", "imax", "sala imax", "atmos", "dolby atmos", "sala atmos", "screenx", "laser 4k", "atmos laser 4k", "infinity vision", "infinity visi", "infinity v", "i v", "infinity vision 4k", "infinity screenx", "infinity", "laser infinity", "vers originale", ANNIVERSARY, ...RATING, "\\d{1,2} \\d{1,2} ore \\d\\d \\d\\d"];
const LEADING = ["premiere", "atmos", "energia", "70mm energia", "3d", "vos", "o\\.?v\\.?", "4senses"];

const alternatives = (wordings: string[]): string => `(?:${wordings.join("|")})`;
const WORDING = alternatives([...LANGUAGE, ...FORMAT, ...RATING, ...EVENT, ...TIMING]);
const ONLY_WORDINGS = new RegExp(`^${WORDING}(?: ${WORDING})*$`);
const BARE_TAIL = new RegExp(` ${alternatives(BARE)}$`);
const LEADING_SEGMENT = new RegExp(`^\\s*${alternatives(LEADING)}\\s*[-–]\\s+(?:atmos\\s+)?`, "i");
const LEADING_PARENTHESIS = /^\s*\(([^()]*)\)\s*/;
const TRAILING_PARENTHESIS = /\s*\(([^()]*)\)\s*$/;
const TRAILING_SEGMENT = /(?:\s+[-–|]\s*|[-–|]\s+)([^-–|()]*)$/;
const TRAILING_ABBREVIATION = /(?:\s+C\.A\.|-[Oo]\.[Vv]\.)\s*$/;
const YEAR = /^(?:19|20)\d\d$/;
const AMPERSAND = /\s*&\s*/g;
const CUT_WORDINGS = ["infinity"];
const CUT_MIN_WORDS = 3;
const CUT_MIN_LENGTH = 12;
const CUT_WORDING_MIN_LENGTH = 4;
const DISTINGUISHING = /\b(?:\d+\w*|parte|part|pt|vol|volume|capitolo|chapter|episodio|ii|iii|iv|vi|vii|viii|ix|live|action|concerto|remake)\b/;

interface TitleKey {
  text: string;
  year: string | null;
}

function withoutParenthesis(title: string): { title: string; year: string | null } | null {
  const match = TRAILING_PARENTHESIS.exec(title);
  if (!match) return null;
  const content = normalizeTitle(match[1] ?? "");
  const rest = title.slice(0, match.index);
  if (YEAR.test(content)) return { title: rest, year: content };
  if (content === "" || ONLY_WORDINGS.test(content) || !DISTINGUISHING.test(content)) return { title: rest, year: null };
  return null;
}

function withoutSegment(title: string): string | null {
  const match = TRAILING_SEGMENT.exec(title);
  if (!match || match.index === 0) return null;
  return ONLY_WORDINGS.test(normalizeTitle(match[1] ?? "")) ? title.slice(0, match.index) : null;
}

function withoutBareTail(title: string): string | null {
  const plain = normalizeTitle(title);
  const match = BARE_TAIL.exec(plain);
  if (!match) return null;
  const wanted = plain.slice(0, match.index);
  for (let length = title.length - 1; length > 0; length -= 1) {
    const kept = title.slice(0, length);
    if (normalizeTitle(kept) === wanted) return kept;
  }
  return null;
}

function withoutLeading(title: string): string | null {
  if (LEADING_SEGMENT.test(title)) return title.replace(LEADING_SEGMENT, "");
  const match = LEADING_PARENTHESIS.exec(title);
  return match && ONLY_WORDINGS.test(normalizeTitle(match[1] ?? "")) ? title.slice(match[0].length) : null;
}

export function titleKey(title: string): TitleKey {
  let current = title.replace(AMPERSAND, " e ").trim();
  let year: string | null = null;
  for (;;) {
    const parenthesis = withoutParenthesis(current);
    if (parenthesis !== null) {
      year ??= parenthesis.year;
      current = parenthesis.title;
      continue;
    }
    const next = withoutSegment(current) ?? withoutBareTail(current) ?? (TRAILING_ABBREVIATION.test(current) ? current.replace(TRAILING_ABBREVIATION, "") : null) ?? withoutLeading(current);
    if (next === null || normalizeTitle(next) === "") break;
    current = next;
  }
  const text = normalizeTitle(current);
  return { text: text === "" ? normalizeTitle(title) : text, year };
}

function wholeOfCut(key: string, keys: string[]): string | null {
  if (key.length < CUT_MIN_LENGTH || key.split(" ").length < CUT_MIN_WORDS) return null;
  const longer = keys.filter((other) => other.length > key.length && other.startsWith(key) && other[key.length] !== " ").sort((a, b) => a.length - b.length);
  const [next] = longer;
  if (next === undefined) return null;
  const oneFilm = longer.every((other, index) => index === 0 || other.startsWith(longer[index - 1] as string));
  return oneFilm && !DISTINGUISHING.test(next.slice(key.lastIndexOf(" ") + 1)) ? next : null;
}

function titleOfCutWording(key: string, keys: string[]): string | null {
  const end = key.lastIndexOf(" ");
  const wording = key.slice(end + 1);
  const cut = wording.length >= CUT_WORDING_MIN_LENGTH && CUT_WORDINGS.some((whole) => whole !== wording && whole.startsWith(wording));
  return cut && keys.includes(key.slice(0, end)) ? key.slice(0, end) : null;
}

function wholeKeys(keys: string[]): Map<string, string> {
  const next = new Map(keys.flatMap((key) => {
    const whole = wholeOfCut(key, keys) ?? titleOfCutWording(key, keys);
    return whole === null ? [] : [[key, whole] as const];
  }));
  const last = (key: string): string => {
    const whole = next.get(key);
    return whole === undefined ? key : last(whole);
  };
  return new Map(keys.map((key) => [key, last(key)]));
}

function earliest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  return b !== null && b < a ? b : a;
}

function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  return b !== null && b > a ? b : a;
}

function representative(members: CatalogMovie[], text: string): CatalogMovie {
  const plain = text.replaceAll(" ", "-");
  const ordered = [...members].sort((a, b) => a.slug.length - b.slug.length || a.slug.localeCompare(b.slug));
  return ordered.find((movie) => movie.slug === plain) ?? (ordered[0] as CatalogMovie);
}

function groupOfMembers(members: CatalogMovie[], text: string): MovieGroup {
  const lead = representative(members, text);
  return {
    slug: lead.slug,
    title: lead.title,
    poster: lead.poster ?? members.find((movie) => movie.poster !== null)?.poster ?? null,
    firstDay: members.reduce<string | null>((day, movie) => earliest(day, movie.firstDay), null),
    lastDay: members.reduce<string | null>((day, movie) => latest(day, movie.lastDay), null),
    formats: [...new Set(members.flatMap((movie) => movie.formats))],
    variants: [lead, ...members.filter((movie) => movie !== lead)].map((movie) => ({ slug: movie.slug, title: movie.title })),
  };
}

export function groupCatalog(movies: CatalogMovie[]): MovieGroup[] {
  const keyed = movies.map((movie) => ({ movie, key: titleKey(movie.title) }));
  const whole = wholeKeys([...new Set(keyed.map(({ key }) => key.text))]);
  const buckets = new Map<string, Array<{ movie: CatalogMovie; year: string | null }>>();
  for (const text of new Set(whole.values())) buckets.set(text, []);
  for (const { movie, key } of keyed) buckets.get(whole.get(key.text) ?? key.text)?.push({ movie, year: key.year });
  const groups: MovieGroup[] = [];
  for (const [text, entries] of buckets) {
    const years = new Set(entries.flatMap((entry) => (entry.year === null ? [] : [entry.year])));
    const parts = years.size <= 1 ? [entries] : [null, ...years].map((year) => entries.filter((entry) => entry.year === year));
    for (const part of parts) if (part.length > 0) groups.push(groupOfMembers(part.map((entry) => entry.movie), text));
  }
  return groups;
}

export function groupOfSlug(groups: MovieGroup[], slug: string): MovieGroup | null {
  return groups.find((group) => group.variants.some((variant) => variant.slug === slug)) ?? null;
}
