import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const skippedDirs = new Set(["node_modules", "dist", "coverage", "reports", ".stryker-tmp", ".git", ".claude", "fixtures", "__snapshots__", "fonts"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".css", ".svg", ".xml", ".sh", ".txt", ".gitattributes", ".gitignore", ".npmrc"]);
const codeExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const allowedDirective = /^(\/\/|\/\*)\s*(eslint-disable|eslint-enable|@ts-expect-error)/;

function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  if (name.startsWith(".") && !name.slice(1).includes(".")) return name;
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return skippedDirs.has(entry) ? [] : walk(path);
    return [path];
  });
}

function commentsIn(path: string): string[] {
  return commentsInText(readFileSync(path, "utf8"), path.endsWith(".tsx"));
}

function commentsInText(text: string, tsx = false): string[] {
  const kind = tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile("sample.ts", text, ts.ScriptTarget.Latest, true, kind);
  const found = new Map<number, string>();
  const collect = (ranges: ts.CommentRange[] | undefined) => {
    for (const range of ranges ?? []) found.set(range.pos, text.slice(range.pos, range.end));
  };
  const visit = (node: ts.Node) => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, node.getEnd()));
    node.getChildren(source).forEach(visit);
  };
  visit(source);
  return [...found.values()].filter((comment) => !allowedDirective.test(comment));
}

const files = walk(root);

describe("guards", () => {
  it("keeps every text file with LF line endings", () => {
    const withCr = files
      .filter((path) => textExtensions.has(extensionOf(path)))
      .filter((path) => readFileSync(path, "utf8").includes("\r"))
      .map((path) => relative(root, path));
    expect(withCr).toEqual([]);
  });

  it("never stores anything shaped like a Telegram bot token", () => {
    const tokenShaped = /\d{6,}:[A-Za-z0-9_-]{30,}/;
    const offenders = files
      .filter((path) => textExtensions.has(extensionOf(path)))
      .filter((path) => tokenShaped.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });

  it("has no comments in code, directives aside", () => {
    const offenders = files
      .filter((path) => codeExtensions.has(extensionOf(path)))
      .flatMap((path) => commentsIn(path).map((comment) => `${relative(root, path)}: ${comment.slice(0, 60)}`));
    expect(offenders).toEqual([]);
  });

  it("detects comments and spares directives and URLs in strings", () => {
    expect(commentsInText('const a = 1; // note\n/* block */\nexport const b = a;\n')).toEqual(["// note", "/* block */"]);
    expect(commentsInText('const url = "https://example.com/a//b";\nconst re = /\\/\\//;\n')).toEqual([]);
    expect(commentsInText("// eslint-disable-next-line no-console\nconsole.log(1);\n")).toEqual([]);
    expect(commentsInText("const el = <div>{/* jsx */}</div>;\n", true)).toEqual(["/* jsx */"]);
  });
});
