// End-to-end test against the production build (`npm run build` first).
// 1. The repos' own example data passes every check.
// 2. A folder with a broken split rule fails exactly that check, read through
//    the <input webkitdirectory> fallback (the folder picker cannot be scripted).
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

function brokenOrchestrationFolder() {
  const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "designer-e2e-")), "OrderOrchestration-as-Code");
  for (const [rel, text] of Object.entries(specs.repos["OrderOrchestration-as-Code"].files)) {
    if (!rel.startsWith("customers/")) continue;
    const broken = rel.endsWith("b2c_standard/strategies/split_rules.yaml")
      ? text.replace('condition: "storage_technology_split"', 'condition: "no_such_reason"')
      : text;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), broken);
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

  const examples = page.getByRole("button", { name: "Beispieldaten der Repos prüfen" });
  await examples.waitFor({ state: "visible" });
  await page.waitForFunction((b) => !b.disabled, await examples.elementHandle(), { timeout: TIMEOUT });
  let started = Date.now();
  await examples.click();
  let result = await states(page);
  console.log(`example data: ${result.length} checks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  check(result.length >= 10, `example data runs at least 10 checks (got ${result.length})`);
  check(result.some(([id]) => id === "Warehouse-as-Code/sites"), "cross-repo site check runs");
  for (const [id, state, text] of result) check(state === "ok", `${id} passes${state === "ok" ? "" : `: ${text}`}`);

  const folder = brokenOrchestrationFolder();
  await page.locator('input[type="file"]').setInputFiles(folder);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  started = Date.now();
  result = await states(page);
  console.log(`broken folder: ${result.length} checks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  const byId = Object.fromEntries(result.map(([id, state, text]) => [id, { state, text }]));
  const broken = byId["OrderOrchestration-as-Code/example_customer"];
  check(broken?.state === "failed", "broken split rule fails its customer's check");
  check(broken?.text.includes("no_such_reason"), "the error names the broken reference");
  check(byId["OrderOrchestration-as-Code/example_3pl"]?.state === "ok", "the untouched customer still passes");
  check(!Object.keys(byId).some((id) => !id.startsWith("OrderOrchestration-as-Code/")), "only the folder's repo is checked");
} catch (error) {
  failures.push(String(error));
  console.log(`FAIL ${error}`);
} finally {
  await browser?.close();
  server.kill();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall e2e checks passed");
process.exit(failures.length ? 1 : 0);
