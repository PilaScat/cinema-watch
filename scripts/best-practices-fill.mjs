import { readFileSync } from "node:fs";

const REPO = "https://github.com/PilaScat/cinema-watch";
const STATUSES = new Set(["Met", "Unmet", "N/A"]);
const doc = readFileSync(new URL("../docs/best-practices.md", import.meta.url), "utf8");

function cells(line) {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

function expandRepo(text) {
  return text.replace(/(^|[\s(])R(?=[/#\s)]|$)/g, `$1${REPO}`);
}

const rows = doc
  .split("\n")
  .filter((line) => /^\| [a-z_0-9]+ \|/.test(line))
  .map(cells);
const fields = Object.fromEntries(rows.filter((row) => row.length === 2));
const criteria = rows.filter((row) => row.length === 4 && STATUSES.has(row[2])).map(([id, , status, text]) => [id, status, expandRepo(text)]);
const byHand = rows.filter((row) => row.length === 4 && !STATUSES.has(row[2])).map(([id]) => id);

const snippet = `(() => {
  const fields = ${JSON.stringify(fields)};
  const criteria = ${JSON.stringify(criteria)};
  const missing = [];
  let filled = 0;
  const fill = (element, value) => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  for (const [name, value] of Object.entries(fields)) {
    const element = document.querySelector('[name="project[' + name + ']"]');
    if (element) { fill(element, value); filled += 1; } else missing.push(name);
  }
  for (const [id, status, text] of criteria) {
    const radio = document.querySelector('input[type=radio][name="project[' + id + '_status]"][value="' + status + '"]');
    if (radio) { radio.click(); filled += 1; } else missing.push(id + "_status");
    const area = document.querySelector('[name="project[' + id + '_justification]"]');
    if (area) { fill(area, text); filled += 1; } else missing.push(id + "_justification");
  }
  console.log("Campi compilati: " + filled + ". Non trovati: " + (missing.length === 0 ? "nessuno" : missing.join(", ")));
})();
`;

process.stdout.write(snippet);
process.stderr.write(`Dati del progetto: ${Object.keys(fields).length}. Criteri: ${criteria.length}. Da valutare a mano: ${byHand.join(", ")}\n`);
