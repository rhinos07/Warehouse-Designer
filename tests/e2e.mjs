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
// 8. The order workflows: flow and status diagrams of each order type, new
//    rules through the data tab's forms, validated by OrderOrchestration's
//    validate.py and flagged in the diagram.
// 9. The language switch: English for an English browser, German on a
//    click, kept across a reload; findings in the tools' own English.
// 10. AutomationML export of an edited hall: the new elements are in it, and
//     every reference in the file resolves (checked with the browser's XML parser).
// 11. AutomationML import: this page's export of the AutoStore hall comes back
//     as a new hall that passes validate.py and is saved into the folder; a
//     planner's file with standard roles becomes a skeleton; undo removes an
//     import in one step.
// 12. Material flow: hall 3's reachability (physical path and movement rules)
//     and a simulated 8 h run of the default flows, on the hall plan and on
//     the flow diagram; turning the rules off lets a flow into the
//     explicit_only HBR run.
// 13. The hall plan: hall 3 in top view with HBR's 48 bays, a bay's levels
//     with its blocked place, and the AutoStore hall. Hall 3 stands as its
//     layout data says; a hall without layout data is calculated, then its
//     layout is adopted, a storage type dragged and the hall's size set.
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

/** Problems of a CAEX file: XML errors, duplicate ids, links to missing ports, unknown roles. Runs in the page. */
function amlProblems(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) return ["not well-formed XML"];
  const problems = [];
  const ids = new Map();
  for (const e of doc.querySelectorAll("[ID]")) {
    if (ids.has(e.getAttribute("ID"))) problems.push(`duplicate ID ${e.getAttribute("ID")}`);
    ids.set(e.getAttribute("ID"), e);
  }
  const classes = new Set();
  const walk = (node, prefix) => {
    for (const c of node.children) {
      if (["RoleClass", "InterfaceClass", "SystemUnitClass", "AttributeType"].includes(c.localName)) {
        classes.add(`${prefix}/${c.getAttribute("Name")}`);
        walk(c, `${prefix}/${c.getAttribute("Name")}`);
      }
    }
  };
  for (const lib of doc.documentElement.children) if (lib.localName.endsWith("Lib")) walk(lib, lib.getAttribute("Name"));
  for (const e of doc.querySelectorAll("RoleRequirements, SupportedRoleClass, ExternalInterface")) {
    const ref = e.getAttribute("RefBaseRoleClassPath") ?? e.getAttribute("RefRoleClassPath") ?? e.getAttribute("RefBaseClassPath");
    if (!classes.has(ref)) problems.push(`unknown class ${ref}`);
  }
  for (const e of doc.querySelectorAll("InternalElement[RefBaseSystemUnitPath]")) {
    const ref = e.getAttribute("RefBaseSystemUnitPath");
    if (!classes.has(ref) && !ids.has(ref)) problems.push(`unknown system unit or master ${ref}`);
  }
  for (const link of doc.querySelectorAll("InternalLink")) {
    for (const side of ["RefPartnerSideA", "RefPartnerSideB"]) {
      const [owner, ...name] = link.getAttribute(side).split(":");
      const ports = [...(ids.get(owner)?.children ?? [])].filter((c) => c.localName === "ExternalInterface").map((c) => c.getAttribute("Name"));
      if (!ports.includes(name.join(":"))) problems.push(`link ${link.getAttribute("Name")}: no port ${link.getAttribute(side)}`);
    }
  }
  return problems;
}

async function openHall(page, hall) {
  await page.getByRole("tab", { name: "Topologie" }).click();
  const select = page.locator(".topo-toolbar select");
  await select.waitFor({ state: "visible", timeout: TIMEOUT });
  await select.selectOption({ label: (await select.locator("option").allTextContents()).find((h) => h.includes(hall)) });
}

async function editTests(browser) {
  const page = await browser.newPage({ locale: "de-DE" });
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

  // AutomationML export of the edited hall.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "AutomationML exportieren" }).click()]);
  const xml = fs.readFileSync(await download.path(), "utf8");
  check(download.suggestedFilename() === "example_customer_PA11_hall_3.aml", `the export is named after the hall (${download.suggestedFilename()})`);
  const problems = await page.evaluate(amlProblems, xml);
  check(problems.length === 0, `the AutomationML file is well-formed and every reference in it resolves${problems.length ? `: ${problems.slice(0, 5).join("; ")}` : ""}`);
  check(xml.includes('<InternalElement Name="DOOR_04"') && xml.includes('<InternalElement Name="MAN_DOOR_04_TO_STAGING"') && xml.includes('<InternalElement Name="WC_QUALITY_CHECK_01"'),
    "the export contains the unsaved new door, connection and work center");
  check((xml.match(/<InternalElement Name="HBR\.[^"]+"/g) ?? []).length > 100, "storage points are exported one by one");
  check(/Bewegungsregeln sind nicht enthalten/.test(await page.locator("[data-aml-result]").textContent()), "the page says what the export leaves out");

  await page.getByLabel("ohne Lagerplätze").check();
  const [slimDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "AutomationML exportieren" }).click()]);
  const slim = fs.readFileSync(await slimDownload.path(), "utf8");
  const slimProblems = await page.evaluate(amlProblems, slim);
  check(slimDownload.suggestedFilename() === "example_customer_PA11_hall_3_without_storage_points.aml" && slimProblems.length === 0,
    `"ohne Lagerplätze" gives a valid file of its own name${slimProblems.length ? `: ${slimProblems.slice(0, 5).join("; ")}` : ""}`);
  check(slim.length * 10 < xml.length && slim.includes('<InternalElement Name="DOOR_04"') && slim.includes('Name="storage_point_count"'),
    `without storage points the file is a tenth of the size or less (${Math.round(slim.length / 1024)} vs. ${Math.round(xml.length / 1024)} KB) and keeps the rest`);

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
    getFileHandle: async (n, options) => {
      if (!options?.create && !(`${prefix}${n}` in window.__fs)) throw new DOMException("not found", "NotFoundError");
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
  const page = await browser.newPage({ locale: "de-DE" });
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

async function importTests(browser) {
  const files = Object.fromEntries(Object.entries(specs.repos["Topology-as-Code"].files).filter(([p]) => p.startsWith("customers/")));
  const facility = "customers/autostore_customer/facilities/facility_as01/facility.yaml";
  const hall2 = "customers/autostore_customer/facilities/facility_as01/buildings/hall_2";
  const page = await browser.newPage({ locale: "de-DE" });
  await page.addInitScript(fakeFolder, files);
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  const open = page.getByRole("button", { name: "Ordner öffnen …" });
  await page.waitForFunction((b) => !b.disabled, await open.elementHandle(), { timeout: TIMEOUT });
  await open.click();
  await page.locator("[data-source]", { hasText: "Topology-as-Code" }).waitFor();
  await openHall(page, "/ AS01 /");
  await page.locator('[data-node="WC_PORT_01"]').waitFor({ state: "visible", timeout: TIMEOUT });
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "AutomationML exportieren" }).click()]);
  const exported = await download.path();

  await page.locator("[data-aml-import-file]").setInputFiles({ name: "autostore.aml", mimeType: "application/xml", buffer: fs.readFileSync(exported) });
  await page.locator("[data-aml-import]").waitFor({ timeout: 10_000 });
  check((await page.getByLabel("Hallen-Id (Ordnername)").inputValue()) === "hall_2", "the import proposes the next free hall id, hall_2");
  check((await page.getByLabel("Standort").inputValue()) === facility, "the import picks the facility the file names (AS01)");
  check(/1 × Lagertyp.*6 × Arbeitsplatz.*4 × Meldepunkt/.test(await page.locator("[data-import-counts]").textContent()), "the preview counts what will be created");
  let state = await editAndValidate(page, () => page.getByRole("button", { name: "Halle anlegen" }).click());
  check(state === "ok", "this page's own export, imported as a new hall, passes validate.py");
  check((await page.locator(".topo-toolbar select").inputValue()) === `${hall2}/warehouse.yaml`, "the diagram switches to the new hall");
  check(await page.locator('[data-node="WC_PORT_01"]').isVisible() && await page.locator('[data-node="AUTOSTORE_GRID"]').isVisible(), "the new hall's places are in the diagram");
  check(await page.locator(`[data-file="Topology-as-Code/${hall2}/structure/storage.yaml"] .tag`).isVisible(), "the changes list the new files as new");
  check((await page.locator("[data-changes] .change-log li").count()) === 1, "an import is one entry in the change log");

  await page.getByRole("button", { name: "In Ordner speichern" }).click();
  await page.locator("[data-saved]").waitFor({ timeout: TIMEOUT });
  const disk = await page.evaluate(() => window.__fs);
  check(["warehouse.yaml", "structure/storage.yaml", "structure/wcs.yaml", "structure/lanes.yaml"].every((f) => disk[`${hall2}/${f}`]?.includes("imported from autostore.aml")),
    "saving writes the new hall's files into the folder");
  check(disk[facility].includes('- "buildings/hall_2/warehouse.yaml"') && disk[facility].startsWith(files[facility].slice(0, files[facility].indexOf("buildings/hall_1"))),
    "saving adds the hall to facility.yaml and keeps the rest of it");

  await page.locator("[data-aml-import-file]").setInputFiles("tests/fixtures/layout-planner.aml");
  await page.locator("[data-aml-import]").waitFor({ timeout: 10_000 });
  check((await page.getByLabel("Hallen-Id (Ordnername)").inputValue()) === "halle_7", "a planner's area name becomes the proposed hall id");
  check((await page.getByLabel("Feuerlöscher 3 übernehmen als").inputValue()) === "ignore" && (await page.getByLabel("Tor 1 übernehmen als").inputValue()) === "door",
    "elements without a known role are proposed as not taken over; a Gate becomes a door");
  check(/staging_section/.test(await page.locator(".import-notes").textContent()), "the preview says the door's staging section is missing");
  state = await editAndValidate(page, () => page.getByRole("button", { name: "Halle anlegen" }).click());
  check(state === "failed", "the planner's skeleton is checked at once, and fails on what the file could not give");
  check(await page.locator('[data-node="HOCHREGAL_1"]').isVisible() && await page.locator('[data-node="TOR_1"]').isVisible(), "the skeleton's places are in the diagram");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await page.locator("[data-changes]").waitFor({ state: "detached", timeout: TIMEOUT });
  await waitForCompile(page);
  check(!(await page.locator(".topo-toolbar select option").allTextContents()).some((o) => o.includes("Halle 7")), "undo removes the whole import in one step");
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
  const page = await browser.newPage({ locale: "de-DE" });
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
  const finding = page.locator("[data-validation] .finding").first();
  check(
    (await finding.locator(".f-text").textContent()) === "Lagerbedingung „frozen_xyz“ ist im Katalog „storage_conditions“ nicht vorhanden." &&
      (await finding.locator(".f-subject").textContent()) === "Artikel ITEM_003" &&
      (await finding.locator(".f-location").textContent()).includes("Kategorie beverages"),
    "the finding reads in project language: where, what and why",
  );
  check((await finding.locator(".f-original code").textContent()).includes("not found in elements/storage_conditions.yaml"), "the tool's original line stays available");
  check(await page.locator('[data-entry="ITEM_003"].flagged').isVisible(), "the item with the finding is marked");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await waitForData(page);

  await list.selectOption({ label: "Suchregeln (Auslagerung) – example_customer / facility_pa11 / hall_3" });
  await page.getByRole("button", { name: "+ Neuer Eintrag" }).click();
  await page.locator(".data-form > .sf-object > [data-field=\"id\"] input").fill("SEARCH_TEST");
  await page.locator('[data-field="zone"] [data-field="id"] input').fill("HBR");
  await page.locator('[data-field="selection_strategy"] input').fill("FIFO");
  state = await applyAndValidate(page, "Anlegen");
  check(state === "failed" && (await page.locator("[data-validation]").textContent()).includes("Nur eine Regel je Halle darf die Standardregel sein"), "a second default search rule fails Allocation's validate.py, explained in German");
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

async function workflowTests(browser) {
  const page = await browser.newPage({ locale: "de-DE" });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  const open = page.getByRole("button", { name: "Ordner öffnen …" });
  await page.waitForFunction((b) => !b.disabled, await open.elementHandle(), { timeout: TIMEOUT });
  const showOrderType = async () => {
    await page.getByRole("tab", { name: "Aufträge" }).click();
    await page.locator('[data-workflow="fresh"]').waitFor({ timeout: TIMEOUT });
    await page.locator(".workflow .topo-toolbar select").selectOption({ label: "example_customer / web / b2c_standard" });
  };
  await showOrderType();
  for (const id of ["order", "split:SPLIT_TO_AUTOSTORE", "split:SPLIT_TO_MANUAL_WAREHOUSE", "trigger:TRIGGER_AUTOSTORE_PICK", "completion:CONSOLIDATE_AFTER_BOTH_SUBORDERS", "action:CONSOLIDATE_AFTER_BOTH_SUBORDERS"]) {
    check(await page.locator(`[data-flow="${id}"]`).isVisible(), `b2c_standard's flow shows ${id}`);
  }
  check(await page.locator('[data-flow="status:completed"].terminal').isVisible(), "terminal statuses are marked");

  await page.locator('[data-flow="completion:CONSOLIDATE_AFTER_BOTH_SUBORDERS"]').click();
  check((await page.locator('[data-flow-details="completion:CONSOLIDATE_AFTER_BOTH_SUBORDERS"]').textContent()).includes("spawn_order_type: b2c_standard"), "a rule's details show its settings");
  await page.getByRole("button", { name: "Bearbeiten …", exact: true }).click();
  await page.locator('[data-form-entry="CONSOLIDATE_AFTER_BOTH_SUBORDERS"]').waitFor();
  check(true, "a rule opens its form in the data tab");

  await showOrderType();
  await page.getByRole("button", { name: "+ Split-Regel" }).click();
  await page.locator('[data-form-entry="new"]').waitFor();
  await page.locator(".data-form > .sf-object > [data-field=\"id\"] input").fill("SPLIT_TO_SHUTTLE");
  await page.locator('[data-field="condition"] input').fill("no_such_reason");
  let state = await applyAndValidate(page, "Anlegen");
  check(state === "failed" && (await page.locator("[data-validation]").textContent()).includes("no_such_reason"), "a split rule with an unknown reason fails validate.py");
  await showOrderType();
  check(await page.locator('[data-flow="split:SPLIT_TO_SHUTTLE"].has-findings').isVisible(), "the new split rule shows in the flow, marked with its finding");

  await page.locator('[data-flow="split:SPLIT_TO_SHUTTLE"]').click();
  await page.getByRole("button", { name: "Bearbeiten …", exact: true }).click();
  await page.locator('[data-form-entry="SPLIT_TO_SHUTTLE"]').waitFor();
  await page.locator('[data-field="condition"] input').fill("storage_technology_split");
  await page.locator(".data-form > .sf-object > .sf-add").selectOption("split_by");
  await page.locator('[data-field="split_by"] input').fill("storage_technology");
  await page.locator(".data-form > .sf-object > .sf-add").selectOption("when");
  const when = page.locator('[data-field="when"]');
  if (!(await when.locator('[data-field="dimension_value"]').count())) await when.locator(".sf-add").selectOption("dimension_value");
  await page.locator('[data-field="dimension_value"] input').fill("shuttle");
  state = await applyAndValidate(page, "Übernehmen");
  check(state === "ok", "completed, the split rule passes validate.py");
  const diff = await page.locator("[data-changes]").textContent();
  check(diff.includes('- id: "SPLIT_TO_SHUTTLE"') && diff.includes('dimension_value: "shuttle"'), "the split rule is written to split_rules.yaml");

  await showOrderType();
  await page.getByRole("button", { name: "Fehlmengen-Regel bearbeiten …" }).click();
  await page.locator('[data-form-entry="Fehlmengen-Regel"]').waitFor();
  await page.locator('[data-field="allow_substitution"] input').check();
  state = await applyAndValidate(page, "Übernehmen");
  check(state === "ok" && (await page.locator("[data-changes]").textContent()).includes("allow_substitution: true"), "the shortage policy is edited as one object");
  await page.close();
}

async function materialFlowTests(browser) {
  const page = await browser.newPage({ locale: "de-DE" });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  await page.getByRole("tab", { name: "Materialfluss" }).click();
  await page.locator("[data-sim-hall]").waitFor({ timeout: TIMEOUT });
  check((await page.locator("[data-sim-hall]").getAttribute("data-sim-hall")) === "example_customer/pa11/hall_3", "the material flow tab opens with hall 3");
  const row = (move) => page.locator(`[data-move="${move}"]`);
  check((await row("DOOR_01>FIX").getAttribute("data-path")) === "yes" && (await row("DOOR_01>FIX").getAttribute("data-allowed")) === "yes",
    "DOOR_01 -> FIX: a physical path, allowed by the rules");
  check((await row("DOOR_01>HBR").getAttribute("data-path")) === "yes" && (await row("DOOR_01>HBR").getAttribute("data-allowed")) === "no",
    "DOOR_01 -> HBR: a physical path, but explicit_only and no rule names the move");
  check((await row("DOOR_01>BLK").getAttribute("data-path")) === "no", "DOOR_01 -> BLK: no physical path");
  check(await page.locator("[data-sim-unconnected]").isVisible(), "storage types without any connection are listed");
  check((await page.locator("[data-sim-canvas]").getAttribute("data-sim-canvas")) === "plan" && await page.locator('[data-plan-block="HBR"]').isVisible(),
    "hall 3 states its layout, so the material flow opens on the hall plan");
  await row("DOOR_01>FIX").click();
  check(await page.locator('[data-plan-block="HBR"]').evaluate((e) => e.classList.contains("marked")), "clicking a move marks its path in the hall plan");

  const flows = page.locator("[data-sim-flow]");
  check((await flows.count()) === 2, "two default flows: one inbound, one outbound");
  check((await page.locator('[data-sim-flow] [data-state="ok"]').count()) === 2, "both default flows can run");
  await page.locator("[data-sim-play]").click();
  await page.waitForFunction(() => document.querySelectorAll(".sim-unit").length > 0, null, { timeout: 20_000 });
  const hallBox = await page.locator(".plan-hall").first().boundingBox();
  const unitBox = await page.locator(".sim-unit").first().boundingBox();
  check(unitBox.x > hallBox.x && unitBox.x < hallBox.x + hallBox.width && unitBox.y > hallBox.y && unitBox.y < hallBox.y + hallBox.height + 20,
    "load units move inside the hall plan");
  await page.locator("[data-sim-hours]").click();
  const done = await page.$$eval("[data-done]", (els) => els.map((e) => Number(e.getAttribute("data-done"))));
  check(done.length === 2 && done.every((n) => n > 50), `after 8 h both flows have finished load units (${done.join(", ")})`);
  check((await page.locator("[data-sim-clock]").textContent()).includes("08:"), "the clock shows the simulated time");
  check(/^\d+\/24/.test(await page.locator('[data-plan-block="FIX"] .plan-title span').textContent()), "a storage type in the plan shows its stock");

  // The flow diagram is still there, with the same simulation.
  await page.locator('[data-sim-view="flow"]').click();
  await page.locator('[data-sim-node="HBR"]').waitFor();
  check(await page.locator('[data-sim-node="HBR"]').evaluate((e) => e.classList.contains("marked")), "the flow diagram shows the same marked path");
  check((await page.$$eval("[data-done]", (els) => els.map((e) => Number(e.getAttribute("data-done"))))).join() === done.join(), "switching the view keeps the simulation's state");
  await page.locator('[data-sim-view="plan"]').click();
  await page.locator('[data-plan-block="HBR"]').waitFor();

  const inbound = flows.nth(0);
  await inbound.locator("select").nth(2).selectOption("HBR");
  check((await inbound.locator('[data-state="problem"]').count()) === 1, "a flow into HBR does not run while the rules count");
  await page.locator("[data-sim-rules]").uncheck();
  check((await inbound.locator('[data-state="ok"]').count()) === 1, "without the rules, the flow into HBR runs");
  await page.close();
}

async function hallPlanTests(browser) {
  const page = await browser.newPage({ locale: "de-DE" });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  await page.getByRole("tab", { name: "Topologie" }).click();
  const hall = page.locator(".topo-toolbar select").first();
  await hall.waitFor({ timeout: TIMEOUT });
  const pick = async (part) => hall.selectOption({ label: (await hall.locator("option").allTextContents()).find((h) => h.includes(part)) });
  await pick("/ PA11 /");
  await page.locator('[data-view="plan"]').click();
  await page.locator('[data-plan-block="HBR"]').waitFor();
  check((await page.locator('[data-plan-block="HBR"] [data-plan-cell]').count()) === 48, "the hall plan draws HBR's 48 bays");
  check((await page.locator('[data-plan-block="COLD_ZONE_B"] .plan-cell.cond-chilled').count()) === 36, "the cold zone's 36 places are drawn as chilled");
  check((await page.locator('[data-plan-block="HAZMAT_A"] .plan-cell.hazmat').count()) === 8, "hazardous goods places are marked");
  check((await page.locator("[data-plan-spot]").count()) === 8, "doors, work centers and reporting points are in the plan");
  check((await page.locator("[data-plan-link]").count()) > 5, "the physical connections are drawn");
  check(await page.locator('[data-plan-cell="HBR.F03-02"]').evaluate((e) => e.classList.contains("blocked")), "the bay with a blocked place is marked");
  await page.locator('[data-plan-cell="HBR.F03-02"]').click();
  const details = page.locator('[data-plan-details="HBR.F03-02"]');
  check((await details.locator("[data-plan-level]").count()) === 6, "a bay shows its 6 levels");
  check(await details.locator('[data-plan-place="HBR.03-04-01"]').evaluate((e) => e.classList.contains("blocked")), "the blocked place is red in the side view");
  await page.locator('[data-plan-block="HBR"] .plan-title').click();
  check(await page.locator('[data-details="HBR"]').isVisible(), "clicking a block shows the storage type's data");
  check((await page.locator('[data-placed="true"]').count()) === 17 && (await page.locator('[data-placed="false"]').count()) === 0,
    "hall 3's 9 storage types and 8 doors and stations stand where the data places them");
  check((await page.locator("[data-plan-note]").textContent()).includes("Lage aus den Daten"), "the plan says that the layout comes from the data");
  const hbr = await page.locator('[data-plan-block="HBR"]').boundingBox();
  const flex = await page.locator('[data-plan-block="HBR_FLEX"]').boundingBox();
  check(Math.abs(hbr.height / hbr.width - 40 / 12) < 0.05 && flex.x > hbr.x + hbr.width, "HBR is drawn 12 x 40 m, with HBR_FLEX to its right");

  // A hall without layout data: calculated, then adopted and edited.
  await pick("/ LP01 /");
  await page.locator("[data-plan-block]").first().waitFor();
  check((await page.locator("[data-plan-note]").textContent()).includes("berechnet"), "a hall without layout data says that the arrangement is calculated");
  const elements = await page.locator("[data-placed]").count();
  check((await page.locator('[data-placed="true"]').count()) === 0, "nothing is placed there yet");
  await page.getByLabel("Bearbeiten").check();
  const adopted = await editAndValidate(page, () => page.locator("[data-plan-adopt]").click());
  check((await page.locator('[data-placed="true"]').count()) === elements, "adopting the layout places every element");
  check(adopted === "ok", "the adopted layout passes validate.py");
  const first = page.locator("[data-plan-block]").first();
  const firstId = await first.getAttribute("data-plan-block");
  await first.scrollIntoViewIfNeeded();
  const handle = await first.locator(".plan-title").boundingBox();
  const before = await first.boundingBox();
  // To the right, into the gap to the next block: far enough for the 0.5 m grid at any zoom.
  await editAndValidate(page, async () => {
    await page.mouse.move(handle.x + 8, handle.y + 4);
    await page.mouse.down();
    await page.mouse.move(handle.x + 8 + 24, handle.y + 4, { steps: 6 });
    await page.mouse.up();
  });
  const after = await page.locator(`[data-plan-block="${firstId}"]`).boundingBox();
  check(after.x > before.x + 3, `dragging moves ${firstId} in the plan`);
  check((await page.locator("[data-changes]").textContent()).includes(`${firstId} im Hallenplan platziert`), "the move is in the change log");
  await page.locator("[data-plan-hall-width]").fill("5");
  await page.locator("[data-plan-hall-depth]").fill("5");
  const small = await editAndValidate(page, () => page.locator("[data-plan-set-hall]").click());
  check(small === "failed" && (await page.locator("[data-validation]").textContent()).includes("außerhalb der Halle"),
    "a hall that is too small fails validate.py, in project language");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await waitForCompile(page);

  await pick("/ AS01 /");
  await page.locator("[data-plan-block]").first().waitFor();
  check((await page.locator("[data-plan-block]").count()) > 0, "the AutoStore hall has a plan too");
  await page.locator('[data-view="flow"]').click();
  await page.locator("[data-node]").first().waitFor();
  check(true, "the flow diagram comes back");
  await page.close();
}

async function languageTests(browser) {
  const page = await browser.newPage({ locale: "en-US" });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(URL);
  const run = page.getByRole("button", { name: "Run checks" });
  await run.waitFor({ timeout: TIMEOUT });
  check(await page.getByRole("tab", { name: "Topology" }).isVisible(), "an English browser gets the English page");
  check((await page.locator("html").getAttribute("lang")) === "en", "the page declares its language");

  await page.getByRole("tab", { name: "Data" }).click();
  await page.locator(".data-toolbar select").selectOption({ label: "Items – example_customer / beverages" });
  await page.locator('[data-entry="ITEM_003"]').click();
  await page.locator('[data-field="storage_condition"] input').fill("frozen_xyz");
  const before = await page.locator("[data-changes] .change-log li").count();
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll("[data-changes] .change-log li").length === n + 1, before, { timeout: TIMEOUT });
  await page.locator('[data-data="fresh"] [data-validation]').waitFor({ timeout: TIMEOUT });
  const finding = page.locator("[data-validation] .finding").first();
  check(
    (await finding.locator(".f-location").textContent()) === "Master data · example_customer · Category beverages · Items" &&
      (await finding.locator(".f-subject").textContent()) === "Item ITEM_003" &&
      (await finding.locator(".f-text").textContent()) === "storage_condition 'frozen_xyz' not found in elements/storage_conditions.yaml",
    "in English a finding shows the tool's words with an English location",
  );
  check((await page.locator("[data-changes]").textContent()).includes("1 unsaved change in 1 file"), "the changes panel speaks English");

  await page.getByRole("button", { name: "DE", exact: true }).click();
  check(await page.getByRole("tab", { name: "Daten" }).isVisible(), "DE switches the page to German at once");
  check(
    (await finding.locator(".f-text").textContent()) === "Lagerbedingung „frozen_xyz“ ist im Katalog „storage_conditions“ nicht vorhanden.",
    "findings switch to German with the page",
  );
  check((await page.locator("[data-changes]").textContent()).includes("1 ungespeicherte Änderung in 1 Datei"), "unsaved edits survive the switch");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "Prüfung starten" }).waitFor({ timeout: TIMEOUT });
  check(await page.getByRole("tab", { name: "Topologie" }).isVisible(), "the choice is kept across a reload");
  await page.close();
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch();
  const page = await browser.newPage({ locale: "de-DE" });
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
  await page.locator("[data-folder-input]").setInputFiles(folder);
  await page.locator("[data-source]", { hasText: "OrderOrchestration-as-Code" }).waitFor();
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
  await page.locator("[data-folder-input]").setInputFiles(topology);
  // Reading the folder is asynchronous: wait until the page shows it as the data source.
  await page.locator("[data-source]", { hasText: "Topology-as-Code" }).waitFor();
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
  await importTests(browser);
  await dataTests(browser);
  await workflowTests(browser);
  await languageTests(browser);
  await materialFlowTests(browser);
  await hallPlanTests(browser);
} catch (error) {
  failures.push(String(error));
  console.log(`FAIL ${error}`);
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failure(s):\n${failures.map((f) => `  - ${f}`).join("\n")}` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
