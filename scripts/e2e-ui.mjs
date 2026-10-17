import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:8792";
const huntId = process.argv[3];
const edgePath = process.env.EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9400 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "cinema-watch-e2e-"));
const edge = spawn(edgePath, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu"], { stdio: "ignore" });
const results = [];
const problems = [];

async function devtools() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error("Edge non risponde");
}

const socket = new WebSocket((await devtools()).webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
let nextId = 0;
const waiting = new Map();
socket.addEventListener("message", (message) => {
  const data = JSON.parse(message.data);
  if (data.id && waiting.has(data.id)) {
    waiting.get(data.id)(data);
    waiting.delete(data.id);
    return;
  }
  if (data.method === "Runtime.exceptionThrown") problems.push(data.params.exceptionDetails.text);
  if (data.method === "Log.entryAdded" && data.params.entry.level === "error") problems.push(data.params.entry.text);
});

function send(method, params = {}, sessionId) {
  nextId += 1;
  socket.send(JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve) => waiting.set(nextId, resolve));
}

const { result: target } = await send("Target.createTarget", { url: "about:blank" });
const { result: attached } = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
const session = attached.sessionId;
await send("Page.enable", {}, session);
await send("Runtime.enable", {}, session);
await send("Log.enable", {}, session);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, session);

async function evaluate(expression) {
  const { result } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw new Error(`${expression}: ${result.exceptionDetails.text}`);
  return result.result.value;
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await evaluate("document.readyState")) === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function open(path) {
  await send("Page.navigate", { url: base + path }, session);
  await settle();
}

async function click(selector) {
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await settle();
}

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
}

await open("/hunts/new");
await evaluate(`(() => {
  document.querySelector('input[name=name]').value = 'E2E Avengers XL';
  document.querySelectorAll('details').forEach((d) => { d.open = true; });
  const verona = document.querySelector('input[name=theatre][value=uci-cinemas-verona]');
  verona.checked = true;
  verona.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
for (let attempt = 0; attempt < 40 && !(await evaluate("[...document.querySelectorAll('select[name=movieListed] option')].some((o) => o.value === 'avengers-doomsday')")); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 150));
}
const listed = await evaluate("[...document.querySelectorAll('select[name=movieListed] option')].map((o) => o.value).filter(Boolean)");
check("menu dei film ricaricato dai cinema scelti", listed.includes("avengers-doomsday") && listed.includes("dune-parte-tre"), listed.join(", "));
await evaluate(`(() => {
  document.querySelector('select[name=movieListed]').value = 'avengers-doomsday';
  document.querySelectorAll('input[name=format]').forEach((box) => { box.checked = box.value === 'XL'; });
  document.querySelector('input[name=windowKind][value=fixed]').checked = true;
  document.querySelector('input[name=windowFrom]').value = '2026-12-16';
  document.querySelector('input[name=windowTo]').value = '2026-12-16';
})()`);
await evaluate("document.querySelector('form[action=\"/hunts\"]').requestSubmit()");
await settle();
check("aggiunta di una caccia dal form", (await evaluate("location.pathname")) === "/" && (await evaluate("document.body.innerText.includes('E2E AVENGERS XL') || document.body.innerText.includes('E2E Avengers XL')")));

const newHref = await evaluate("[...document.querySelectorAll('a')].find((a) => a.textContent.trim() === 'E2E Avengers XL')?.getAttribute('href') ?? ''");
await open(newHref);
await click("form[action$='/delete'] button[data-confirm]");
const armed = await evaluate("document.querySelector(\"form[action$='/delete'] button\").dataset.armed");
const armedLabel = await evaluate("document.querySelector(\"form[action$='/delete'] button [data-label]\").textContent");
await click("form[action$='/delete'] button[data-confirm]");
check("Elimina si arma al primo clic", armed === "true", armedLabel);
check("Elimina conferma al secondo clic", (await evaluate("location.pathname")) === "/" && !(await evaluate("document.body.innerText.includes('E2E Avengers XL')")));

if (huntId) {
  await open(`/hunts/${huntId}/zone?performance=5116-575978`);
  await evaluate("document.querySelector('.hall-svg:not(.hidden) rect[data-seat=\"G/5\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await evaluate("document.querySelector('.hall-svg:not(.hidden) rect[data-seat=\"J/16\"]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  const picked = await evaluate("({ rows: document.querySelector('input[name=rows]').value, from: document.querySelector('input[name=seatFrom]').value, to: document.querySelector('input[name=seatTo]').value })");
  check("zona scelta cliccando sulla pianta", picked.rows.replace(/\s/g, "") === "G,H,J" && picked.from === "5" && picked.to === "16", JSON.stringify(picked));
  await evaluate("document.querySelector('input[name=rows]').closest('form').requestSubmit()");
  await settle();
  check("zona salvata", (await evaluate("document.body.innerText")).includes("G, H, J") || (await evaluate("document.body.innerText")).includes("G,H,J"));

  await open("/");
  await click(`form[action='/hunts/${huntId}/mute'] button`);
  check("Silenzia dalla home", (await evaluate("document.body.innerText")).includes("Silenziata fino alle"));
  await click(`form[action='/hunts/${huntId}/resume'] button`);
  check("Riattiva dalla home", !(await evaluate("document.body.innerText")).includes("Silenziata fino alle"));
}

await open("/search?q=avenger");
const avengers = await evaluate("[...document.querySelectorAll('a')].find((a) => a.textContent.includes('Avengers: Doomsday'))?.getAttribute('href') ?? ''");
check("ricerca con parte del titolo", avengers.includes("movie=avengers-doomsday"), avengers);
await open(avengers);
check("cinema del film scelto dalla ricerca", (await evaluate("document.body.innerText")).includes("Cinema con Avengers: Doomsday") && (await evaluate("Boolean(document.querySelector('a[href=\"/theatres/uci-cinemas-verona/movies/avengers-doomsday\"]'))")));

await open("/settings");
await evaluate("document.querySelector('form[action=\"/settings\"]').requestSubmit()");
await settle();
check("Impostazioni salvate dal form", (await evaluate("location.search")) === "?saved=1", await evaluate("document.body.innerText.slice(0, 80)"));

await open("/");
await click("button[data-theme-choice=dark]");
const darkNow = await evaluate("document.documentElement.classList.contains('dark')");
await open("/settings");
check("tema scuro scelto e mantenuto dopo il cambio pagina", darkNow && (await evaluate("document.documentElement.classList.contains('dark')")));
await click("button[data-theme-choice=light]");
check("tema chiaro", !(await evaluate("document.documentElement.classList.contains('dark')")));
check("nessun errore in console", problems.length === 0, problems.join(" | "));

console.log(JSON.stringify(results, null, 1));
socket.close();
edge.kill();
process.exit(results.every((result) => result.ok) ? 0 : 1);
