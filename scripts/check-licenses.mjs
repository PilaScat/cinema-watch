import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const allowed = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "MPL-2.0"]);
const exceptions = new Map();

function runtimeTree() {
  const args = ["ls", "--omit=dev", "--all", "--json"];
  const npmCli = process.env.npm_execpath;
  const output = npmCli
    ? execFileSync(process.execPath, [npmCli, ...args], { encoding: "utf8" })
    : execFileSync("npm", args, { encoding: "utf8" });
  return JSON.parse(output);
}

function collect(node, found = new Map()) {
  for (const [name, child] of Object.entries(node.dependencies ?? {})) {
    const path = child.path ?? join("node_modules", name);
    if (child.missing || found.has(name) || !existsSync(join(path, "package.json"))) continue;
    found.set(name, path);
    collect(child, found);
  }
  return found;
}

function licenseOf(path) {
  const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  if (typeof manifest.license === "string") return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  return "UNKNOWN";
}

function isAllowed(license) {
  return license
    .replace(/[()]/g, "")
    .split(/\s+OR\s+/)
    .some((part) => allowed.has(part.trim()));
}

const packages = collect(runtimeTree());
const rows = [...packages].map(([name, path]) => ({ name, license: licenseOf(path) }));
const refused = rows.filter(({ name, license }) => !isAllowed(license) && exceptions.get(name) !== license);

for (const { name, license } of rows) console.log(`${license.padEnd(16)} ${name}`);
console.log(`\n${rows.length} pacchetti di runtime, ${refused.length} con licenza non ammessa`);
if (refused.length > 0) {
  for (const { name, license } of refused) console.error(`non ammessa: ${name} (${license})`);
  process.exit(1);
}
