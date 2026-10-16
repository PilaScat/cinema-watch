import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile, optimize } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

const root = fileURLToPath(new URL("..", import.meta.url));
const input = join(root, "src", "web", "styles.css");
const out = join(root, "dist", "public");

const compiler = await compile(readFileSync(input, "utf8"), { base: join(root, "src", "web"), onDependency: () => undefined });
const scanner = new Scanner({
  sources: [{ base: join(root, "src"), pattern: "**/*.{ts,tsx}", negated: false }, ...compiler.sources],
});
const css = optimize(compiler.build(scanner.scan()), { minify: true }).code;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "app.css"), css);
cpSync(join(root, "src", "web", "public"), out, { recursive: true });
console.log(`app.css ${css.length} byte`);
