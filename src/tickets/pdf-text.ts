import { inflateSync } from "node:zlib";

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_STREAMS = 2000;
const MAX_STREAM_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_DICTIONARY_BYTES = 4096;
const STREAM_KEYWORD = /stream\r?\n/g;
const SHOWN = /\[((?:[^\]\\]|\\[\s\S])*)\]\s*TJ|(\((?:[^)\\]|\\[\s\S])*\))\s*Tj/g;
const LITERAL = /\(((?:[^)\\]|\\[\s\S])*)\)/g;
const ESCAPE = /\\([0-7]{1,3}|[\s\S])/g;
const ESCAPED: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };

export type PdfProblem = "notPdf" | "tooLarge";

export class PdfError extends Error {
  override readonly name = "PdfError";

  constructor(readonly problem: PdfProblem) {
    super(problem);
  }
}

function unescape(literal: string): string {
  return literal.replace(ESCAPE, (_all, code: string) => (/^[0-7]/.test(code) ? String.fromCharCode(Number.parseInt(code, 8)) : (ESCAPED[code] ?? code)));
}

function shownStrings(content: string): string[] {
  const strings: string[] = [];
  for (const shown of content.matchAll(SHOWN)) {
    const source = shown[1] ?? shown[2] ?? "";
    strings.push([...source.matchAll(LITERAL)].map((literal) => unescape(literal[1] ?? "")).join(""));
  }
  return strings;
}

function inflated(data: Uint8Array): string | null {
  try {
    return inflateSync(data, { maxOutputLength: MAX_STREAM_BYTES }).toString("latin1");
  } catch {
    return null;
  }
}

export function pdfTextStreams(pdf: Uint8Array): string[][] {
  if (pdf.byteLength > MAX_PDF_BYTES) throw new PdfError("tooLarge");
  const buffer = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  const text = buffer.toString("latin1");
  if (!text.startsWith("%PDF-")) throw new PdfError("notPdf");
  const streams: string[][] = [];
  let scanned = 0;
  let textBytes = 0;
  for (const keyword of text.matchAll(STREAM_KEYWORD)) {
    scanned += 1;
    if (scanned > MAX_STREAMS) throw new PdfError("tooLarge");
    const start = keyword.index + keyword[0].length;
    const end = text.indexOf("endstream", start);
    if (end === -1) break;
    const dictionary = text.slice(Math.max(0, keyword.index - MAX_DICTIONARY_BYTES), keyword.index);
    const own = dictionary.slice(dictionary.lastIndexOf(" obj") + 1);
    if (!own.includes("/FlateDecode") || /\/Subtype\s*\/Image/.test(own)) continue;
    const content = inflated(buffer.subarray(start, end));
    if (content === null || !/\bBT\b/.test(content)) continue;
    textBytes += content.length;
    if (textBytes > MAX_TEXT_BYTES) throw new PdfError("tooLarge");
    const strings = shownStrings(content);
    if (strings.length > 0) streams.push(strings);
  }
  return streams;
}
