// End-to-end test against the production build (`npm run build` first).
// 1. The repos' own example data passes every check.
// 2. The topology tab draws the example halls as a flow diagram.
// 3. A folder with a broken split rule fails exactly that check, read through
//    the <input webkitdirectory> fallback (the folder picker cannot be scripted).
// 4. A topology finding marks the node it names in the diagram.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = 4173;
const URL = `http://localhost:${PORT}/`;
const TIMEOUT = 180_000;
const specs = JSON.parse(fs.readFileSync("public/specs.json", "utf8"));

const server = spawn("node_modules/.bin/vite", ["preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
};

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("preview server did not start");
}

async function states(page) {
  await page.waitForFunction(
    () => document.querySelectorAll("[data-check]").length > 0 && !document.querySelector('[data-state="pending"]'),
    null,
    { timeout: TIMEOUT },
  );
  return page.$$eval("[data-check]", (els) => els.map((e) => [e.getAttribute("data-check"), e.getAttribute("data-state"), e.textContent]));
}

/** A copy of a repo's customers/ folder with one file changed. */
function brokenFolder(repo, file, from, to) {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "designer-e2e-")), repo);
  for (const [rel, text] of Object.entries(specs.repos[repo].files)) {
    if (!rel.startsWith("customers/")) continue;
    const content = rel.endsWith(file) ? text.replace(from, to) : text;
    if (rel.endsWith(file) && content === text) throw new Error(`${repo}: ${file} does not contain ${from}`);
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage();
  // Force the read-only fallback so the folder can be supplied by the test.
  await page.addInitScript(() => delete window.showDirectoryPicker);
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);

  const start = page.getByRole("button", { name: "Prüfung starten" });
  await start.waitFor({ state: "visible" });
  await page.waitForFunction((b) => !b.disabled, await start.elementHandle(), { timeout: TIMEOUT });
  let started = Date.now();
  await start.click();
  let result = await states(page);
  console.log(`example data: ${result.length} checks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  check(result.length >= 10, `example data runs at least 10 checks (got ${result.length})`);
  check(result.some(([id]) => id === "Warehouse-as-Code/sites"), "cross-repo site check runs");
  for (const [id, state, text] of result) check(state === "ok", `${id} passes${state === "ok" ? "" : `: ${text}`}`);

  await page.getByRole("tab", { name: "Topologie" }).click();
  const hall = page.locator(".topo-toolbar select");
  await hall.waitFor({ state: "visible", timeout: TIMEOUT });
  const halls = await hall.locator("option").allTextContents();
  check(halls.length >= 3 && !halls.some((h) => h.includes("(Fehler)")), `every example hall compiles (${halls.join("; ")})`);
  await hall.selectOption({ label: halls.find((h) => h.includes("/ PA11 /")) });
  await page.locator('[data-node="HBR"]').waitFor({ state: "visible" });
  check(await page.locator('[data-node="DOOR_01"]').isVisible(), "PA11 shows door DOOR_01");
  check(!(await page.locator(".topo-node.has-findings").count()), "no node is flagged after a clean check");
  const physical = await page.locator(".react-flow__edge").count();
  check(physical > 5, `PA11 draws its connections (${physical} edges)`);
  await page.locator('[data-node="HBR"]').click();
  const details = page.locator('[data-details="HBR"]');
  await details.waitFor({ state: "visible" });
  check((await details.textContent()).includes("Lagerplätze"), "the details panel shows HBR's storage points");
  await page.getByLabel("Bewegungsregeln").check();
  const withRules = await page.locator(".react-flow__edge").count();
  check(withRules > physical, `movement rules add edges (${physical} → ${withRules})`);

  const folder = brokenFolder(
    "OrderOrchestration-as-Code",
    "b2c_standard/strategies/split_rules.yaml",
    'condition: "storage_technology_split"',
    'condition: "no_such_reason"',
  );
  await page.locator('input[type="file"]').setInputFiles(folder);
  await page.getByText("Der Ordner enthält keine Topology-as-Code-Daten.").waitFor({ timeout: TIMEOUT });
  check(true, "the topology tab says the folder has no topology data");
  await page.getByRole("tab", { name: "Prüfen" }).click();
  await page.getByRole("button", { name: "Prüfung starten" }).click();
  started = Date.now();
  result = await states(page);
  console.log(`broken folder: ${result.length} checks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const byId = Object.fromEntries(result.map(([id, state, text]) => [id, { state, text }]));
  const broken = byId["OrderOrchestration-as-Code/example_customer"];
  check(broken?.state === "failed", "broken split rule fails its customer's check");
  check(broken?.text.includes("no_such_reason"), "the error names the broken reference");
  check(byId["OrderOrchestration-as-Code/example_3pl"]?.state === "ok", "the untouched customer still passes");
  check(!Object.keys(byId).some((id) => !id.startsWith("OrderOrchestration-as-Code/")), "only the folder's repo is checked");

  // The extension record now claims HBR is a door: validation fails, compiling still works.
  const topology = brokenFolder(
    "Topology-as-Code",
    "hall_3/extensions/example-wms.yaml",
    'entity_type: "storage_type"\n      entity_id: "HBR"',
    'entity_type: "door"\n      entity_id: "HBR"',
  );
  await page.locator('input[type="file"]').setInputFiles(topology);
  await page.getByRole("button", { name: "Prüfung starten" }).click();
  result = Object.fromEntries((await states(page)).map(([id, state]) => [id, state]));
  check(result["Topology-as-Code/example_customer"] === "failed", "the broken extension record fails its customer's check");
  await page.getByRole("tab", { name: "Topologie" }).click();
  await hall.waitFor({ state: "visible", timeout: TIMEOUT });
  await hall.selectOption({ label: (await hall.locator("option").allTextContents()).find((h) => h.includes("/ PA11 /")) });
  await page.locator('[data-node="HBR"]').waitFor({ state: "visible" });
  check(await page.locator('[data-node="HBR"]').evaluate((e) => e.classList.contains("has-findings")), "HBR is flagged with its finding");
  check(await page.locator(".topo-node.has-findings").count() === 1, "no other node is flagged");
} catch (error) {
  failures.push(String(error));
  console.log(`FAIL ${error}`);
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
