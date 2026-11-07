// End-to-end test against the production build (`npm run build` first).
// 1. The repos' own example data passes every check.
// 2. The topology tab draws the example halls as a flow diagram.
// 3. A folder with a broken split rule fails exactly that check, read through
//    the <input webkitdirectory> fallback (the folder picker cannot be scripted).
// 4. A topology finding marks the node it names in the diagram.
// 5. Editing the example data: add elements and a connection, each validated
//    by Topology's validate.py at once; delete; undo.
// 7. The data tab: forms from the repos' JSON Schemas for master data, rules
//    and topology attributes, validated by each repo's validate.py.
// 6. Saving into an opened folder (a scripted folder picker), and refusing to
//    overwrite a file that changed on disk meanwhile.
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


async function waitForCompile(page) {
  await page.locator('[data-topology="fresh"]').waitFor({ timeout: TIMEOUT });
}

/** Applies one edit through the UI and waits until the page recompiled and revalidated. */
async function editAndValidate(page, action) {
  const before = await page.locator("[data-changes] .change-log li").count();
  await action();
  await page.waitForFunction((n) => document.querySelectorAll("[data-changes] .change-log li").length === n + 1, before, { timeout: TIMEOUT });
  await waitForCompile(page);
  return page.locator("[data-validation]").getAttribute("data-validation");
}

async function openHall(page, hall) {
  await page.getByRole("tab", { name: "Topologie" }).click();
  const select = page.locator(".topo-toolbar select");
  await select.waitFor({ state: "visible", timeout: TIMEOUT });
  await select.selectOption({ label: (await select.locator("option").allTextContents()).find((h) => h.includes(hall)) });
}

async function editTests(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => delete window.showDirectoryPicker);
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  await openHall(page, "/ PA11 /");
  await page.locator('[data-node="HBR"]').waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByLabel("Bearbeiten").check();

  let state = await editAndValidate(page, async () => {
    await page.getByRole("button", { name: "+ Tor" }).click();
    await page.getByLabel("Art").selectOption({ label: "Ausgang" });
    await page.getByRole("button", { name: "Hinzufügen" }).click();
  });
  check(state === "ok", "a new door passes validate.py");
  check((await page.locator("[data-changes]").textContent()).includes('staging_section: "STAGING.SEC_STAGING_OUT"'), "an outbound door stages in the outbound section");
  check(await page.locator('[data-node="DOOR_04"]').isVisible(), "the door gets the next id, DOOR_04, and appears in the diagram");
  check(await page.locator('[data-details="DOOR_04"]').isVisible(), "the new door is selected");

  const edges = await page.locator(".react-flow__edge").count();
  state = await editAndValidate(page, async () => {
    await page.getByRole("button", { name: "Verbindung hinzufügen …" }).click();
    await page.getByLabel("Nach").selectOption("STAGING");
    await page.getByLabel("Transportart").selectOption({ label: "Stapler" });
    await page.getByLabel("Fahrzeit in Minuten (optional)").fill("3");
    await page.getByRole("button", { name: "Hinzufügen" }).click();
  });
  check(state === "ok", "a new connection passes validate.py");
  // React Flow draws edges once their nodes are measured: wait for this one.
  await page.locator(".react-flow__edge[data-id^='can:MAN_DOOR_04_TO_STAGING']").waitFor({ timeout: 10_000 }).catch(() => {});
  check((await page.locator(".react-flow__edge").count()) > edges, "the connection appears in the diagram");

  await page.locator('[data-node="DOOR_04"]').click();
  check(await page.getByRole("button", { name: "DOOR_04 löschen" }).isDisabled(), "a door still connected cannot be deleted");

  state = await editAndValidate(page, async () => {
    await page.getByRole("button", { name: "+ Arbeitsplatz" }).click();
    await page.getByLabel("Prozessschritt").fill("quality_check");
    await page.getByRole("button", { name: "Hinzufügen" }).click();
  });
  check(state === "ok" && (await page.locator('[data-node="WC_QUALITY_CHECK_01"]').isVisible()), "a new work center passes validate.py");

  state = await editAndValidate(page, async () => {
    await page.getByRole("button", { name: "+ Meldepunkt" }).click();
    await page.getByRole("button", { name: "Hinzufügen" }).click();
  });
  check(state === "ok" && (await page.locator('[data-node="RP_01"]').isVisible()), "a new reporting point passes validate.py");

  const diff = await page.locator("[data-changes]").textContent();
  check(diff.includes("4 ungespeicherte Änderungen in 3 Dateien"), "the changes panel counts edits and files");
  for (const text of ['- id: "DOOR_04"', '- id: "MAN_DOOR_04_TO_STAGING"', 'expected_duration: {value: 3, unit: "min"}', '- id: "WC_QUALITY_CHECK_01"', '- id: "RP_01"']) {
    check(diff.includes(text), `the diff shows ${text}`);
  }
  check((await page.locator("[data-changes] a[download]").count()) === 3, "without a writable folder, each changed file can be downloaded");

  // The edge's SVG path has no layout box Playwright can click; dispatch the click it would send.
  await page.locator(".react-flow__edge[data-id='can:MAN_DOOR_04_TO_STAGING:DOOR_04:STAGING'] .react-flow__edge-interaction").dispatchEvent("click");
  await page.locator('[data-edge="MAN_DOOR_04_TO_STAGING"]').waitFor();
  await editAndValidate(page, () => page.getByRole("button", { name: "MAN_DOOR_04_TO_STAGING löschen" }).click());
  check(!(await page.locator(".react-flow__edge[data-id^='can:MAN_DOOR_04_TO_STAGING']").count()), "a clicked connection can be deleted");
  await page.locator('[data-node="DOOR_04"]').click();
  await editAndValidate(page, () => page.getByRole("button", { name: "DOOR_04 löschen" }).click());
  check(!(await page.locator('[data-node="DOOR_04"]').count()), "an unconnected door can be deleted");

  for (let i = 0; i < 6; i++) {
    await page.getByRole("button", { name: "Rückgängig" }).click();
    await waitForCompile(page);
  }
  check(!(await page.locator("[data-changes]").count()), "undo takes back every edit");
  check(!(await page.locator('[data-node="RP_01"], [data-node="DOOR_04"]').count()), "after undo the diagram shows the data as read");
  await page.close();
}

/** A scripted folder picker over an in-memory copy of Topology-as-Code's data. */
function fakeFolder(files) {
  window.__fs = files;
  const fileHandle = (path) => ({
    kind: "file",
    name: path.split("/").pop(),
    getFile: async () => ({ text: async () => window.__fs[path] }),
    createWritable: async () => {
      let text = "";
      return { write: async (t) => { text += t; }, close: async () => { window.__fs[path] = text; } };
    },
  });
  const dirHandle = (prefix, name) => ({
    kind: "directory",
    name,
    async *values() {
      const seen = new Set();
      for (const path of Object.keys(window.__fs)) {
        if (!path.startsWith(prefix)) continue;
        const [head, ...rest] = path.slice(prefix.length).split("/");
        if (seen.has(head)) continue;
        seen.add(head);
        yield rest.length ? dirHandle(`${prefix}${head}/`, head) : fileHandle(path);
      }
    },
    getDirectoryHandle: async (n) => dirHandle(`${prefix}${n}/`, n),
    getFileHandle: async (n) => {
      if (!(`${prefix}${n}` in window.__fs)) throw new DOMException("not found", "NotFoundError");
      return fileHandle(`${prefix}${n}`);
    },
    queryPermission: async () => "prompt",
    requestPermission: async () => "granted",
  });
  window.showDirectoryPicker = async () => dirHandle("", "Topology-as-Code");
}

async function saveTests(browser) {
  const files = Object.fromEntries(Object.entries(specs.repos["Topology-as-Code"].files).filter(([p]) => p.startsWith("customers/")));
  const storage = "customers/example_customer/facilities/facility_pa11/buildings/hall_3/structure/storage.yaml";
  const page = await browser.newPage();
  await page.addInitScript(fakeFolder, files);
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  const open = page.getByRole("button", { name: "Ordner öffnen …" });
  await page.waitForFunction((b) => !b.disabled, await open.elementHandle(), { timeout: TIMEOUT });
  await open.click();
  await page.locator("[data-source]", { hasText: "Topology-as-Code" }).waitFor();
  await openHall(page, "/ PA11 /");
  await page.locator('[data-node="HBR"]').waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByLabel("Bearbeiten").check();
  await editAndValidate(page, async () => {
    await page.getByRole("button", { name: "+ Tor" }).click();
    await page.getByRole("button", { name: "Hinzufügen" }).click();
  });
  await page.getByRole("button", { name: "In Ordner speichern" }).click();
  await page.locator("[data-saved]").waitFor({ timeout: TIMEOUT });
  const disk = await page.evaluate(() => window.__fs);
  check(disk[storage].includes('  - id: "DOOR_04"\n    direction: "inbound"'), "saving writes the new door into storage.yaml");
  check(disk[storage].startsWith(files[storage].slice(0, files[storage].lastIndexOf("\n    determination_group"))), "the rest of storage.yaml is unchanged, comments included");
  check(Object.keys(files).every((p) => p === storage || disk[p] === files[p]), "no other file is written");
  check(!(await page.locator("[data-changes]").count()), "after saving nothing is pending");

  await editAndValidate(page, async () => {
    await page.getByRole("button", { name: "+ Tor" }).click();
    await page.getByRole("button", { name: "Hinzufügen" }).click();
  });
  check(await page.locator('[data-node="DOOR_05"]').isVisible(), "the next door after a save is DOOR_05");
  await page.evaluate((p) => { window.__fs[p] += "# changed outside\n"; }, storage);
  await page.getByRole("button", { name: "In Ordner speichern" }).click();
  await page.getByText("wurde inzwischen außerhalb geändert").waitFor({ timeout: TIMEOUT });
  check(!(await page.evaluate((p) => window.__fs[p], storage)).includes("DOOR_05"), "a file changed on disk meanwhile is not overwritten");
  check(await page.locator("[data-changes]").isVisible(), "the refused edit stays pending");
  await page.close();
}

async function waitForData(page) {
  await page.locator('[data-data="fresh"]').waitFor({ timeout: TIMEOUT });
}

/** Clicks a button that changes the data, then waits for the page to revalidate. */
async function applyAndValidate(page, name) {
  const before = await page.locator("[data-changes] .change-log li").count();
  await page.getByRole("button", { name, exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-changes] .change-log li").length === n + 1, before, { timeout: TIMEOUT });
  await waitForData(page);
  return page.locator("[data-validation]").getAttribute("data-validation");
}

async function dataTests(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => delete window.showDirectoryPicker);
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  const open = page.getByRole("button", { name: "Ordner öffnen …" });
  await page.waitForFunction((b) => !b.disabled, await open.elementHandle(), { timeout: TIMEOUT });
  await page.getByRole("tab", { name: "Daten" }).click();
  const list = page.locator(".data-toolbar select");
  const options = await list.locator("option").allTextContents();
  check(["Artikel", "Suchregeln (Auslagerung)", "Lagertypen", "Tore"].every((l) => options.some((o) => o.startsWith(`${l} – `))), "master data, rules and topology lists are offered");

  await list.selectOption({ label: "Artikel – example_customer / beverages" });
  await page.locator('[data-entry="ITEM_003"]').click();
  await page.locator('[data-field="total_shelf_life_days"] input').fill("300");
  let state = await applyAndValidate(page, "Übernehmen");
  check(state === "ok", "a changed item passes MasterData's validate.py");
  const diff = await page.locator("[data-changes]").textContent();
  check(diff.includes("Artikel: ITEM_003 geändert") && diff.includes("+1 −1"), "the change is one changed line");

  await page.locator('[data-field="storage_condition"] input').fill("frozen_xyz");
  state = await applyAndValidate(page, "Übernehmen");
  check(state === "failed" && (await page.locator("[data-validation]").textContent()).includes("frozen_xyz"), "an unknown storage condition fails validate.py");
  check(await page.locator('[data-entry="ITEM_003"].flagged').isVisible(), "the item with the finding is marked");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await waitForData(page);

  await list.selectOption({ label: "Suchregeln (Auslagerung) – example_customer / facility_pa11 / hall_3" });
  await page.getByRole("button", { name: "+ Neuer Eintrag" }).click();
  await page.locator(".data-form > .sf-object > [data-field=\"id\"] input").fill("SEARCH_TEST");
  await page.locator('[data-field="zone"] [data-field="id"] input').fill("HBR");
  await page.locator('[data-field="selection_strategy"] input').fill("FIFO");
  state = await applyAndValidate(page, "Anlegen");
  check(state === "failed" && (await page.locator("[data-validation]").textContent()).includes("both omit applies_to"), "a second default search rule fails Allocation's validate.py");
  check(await page.locator('[data-entry="SEARCH_TEST"].current').isVisible(), "the new rule is selected");
  await page.locator(".data-form > .sf-object > .sf-add").selectOption("applies_to");
  await page.locator('[data-field="applies_to"]').getByLabel("Feld hinzufügen").selectOption("item_id");
  await page.locator('[data-field="item_id"] input').fill("ITEM_001");
  state = await applyAndValidate(page, "Übernehmen");
  check(state === "ok", "scoped to an item, the new rule passes");
  const rules = await page.locator("[data-changes]").textContent();
  check(rules.includes('- id: "SEARCH_TEST"') && rules.includes('item_id: "ITEM_001"') && rules.includes('- zone: { type: "storage_type", id: "HBR" }'), "the new rule is written in the file's style");

  await page.getByRole("tab", { name: "Topologie" }).click();
  await openHall(page, "/ PA11 /");
  await page.locator('[data-node="DOOR_01"]').waitFor({ state: "visible", timeout: TIMEOUT });
  await page.getByLabel("Bearbeiten").check();
  await page.locator('[data-node="DOOR_01"]').click();
  await page.getByRole("button", { name: "Alle Attribute bearbeiten …" }).click();
  await page.locator('[data-form-entry="DOOR_01"]').waitFor();
  check((await page.locator('[data-field="staging_section"] input').inputValue()) === "STAGING.SEC_STAGING_IN", "a node opens its full form in the data tab");
  await page.close();
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

  await editTests(browser);
  await saveTests(browser);
  await dataTests(browser);
} catch (error) {
  failures.push(String(error));
  console.log(`FAIL ${error}`);
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
