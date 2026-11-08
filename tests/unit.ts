// Unit tests for the YAML text edits, against the repos' own files
// (`npm run bundle` first). Run with `npm run test:unit`.
import fs from "node:fs";
import { describePath, explain } from "../src/findings";
import { TEXTS } from "../src/i18n";
import { LISTS } from "../src/lists";
import { child, kindOf, resolve, schemaAt, unresolved, type Located } from "../src/schema";
import { appendItem, getItem, readYaml, removeItem, updateItem, type Item } from "../src/yamlEdit";

const specs = JSON.parse(fs.readFileSync("public/specs.json", "utf8"));
const topology: Record<string, string> = specs.repos["Topology-as-Code"].files;
const hall3 = "customers/example_customer/facilities/facility_pa11/buildings/hall_3/structure/";
const failures: string[] = [];
function check(ok: boolean, message: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${message}`);
  if (!ok) failures.push(message);
}
const ids = (text: string, key: string) => ((readYaml(text)[key] as { id: string }[]) ?? []).map((i) => i.id);
const changedLines = (a: string, b: string) => {
  const [x, y] = [a.split("\n"), b.split("\n")];
  return y.filter((line) => !x.includes(line)).length + x.filter((line) => !y.includes(line)).length;
};

// Every list item of every Topology file: removing it changes only that item.
let removals = 0;
for (const [path, text] of Object.entries(topology)) {
  if (!path.startsWith("customers/") || !path.endsWith(".yaml")) continue;
  const data = readYaml(text);
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value) || value.length < 2 || !value.every((v) => v && typeof v === "object" && "id" in v)) continue;
    for (const { id } of value) {
      const out = removeItem(text, key, id);
      const left = ids(out, key);
      const expected = value.map((v) => v.id).filter((v) => v !== id);
      if (JSON.stringify(left) !== JSON.stringify(expected)) check(false, `${path}: remove ${key}/${id} keeps the others`);
      const restored = readYaml(out);
      for (const other of Object.keys(data)) {
        if (other !== key && JSON.stringify(restored[other]) !== JSON.stringify(data[other])) {
          check(false, `${path}: removing ${key}/${id} leaves ${other} unchanged`);
        }
      }
      removals++;
    }
  }
}
check(removals > 50, `removing any one of ${removals} list items keeps every other item and section`);

const lanes = topology[`${hall3}lanes.yaml`];
const added = appendItem(lanes, "connections", {
  id: "MAN_DOOR_03_TO_STAGING", from: "DOOR_03", to: "STAGING", direction: "one_way",
  transport_mode: "forklift", expected_duration: { value: 3, unit: "min" },
});
check(added.startsWith(lanes.slice(0, lanes.indexOf("\nlanes:"))), "append keeps everything before the insertion");
check(added.endsWith(lanes.slice(lanes.indexOf("\nlanes:"))), "append keeps everything after the insertion");
check(added.includes(`\n\n  - id: "MAN_DOOR_03_TO_STAGING"\n    from: "DOOR_03"\n`), "the new item follows the file's style");
check(added.includes(`expected_duration: {value: 3, unit: "min"}`), "small maps are written inline");
check(JSON.stringify(ids(added, "connections")) === JSON.stringify(["MAN_HBR_TO_FIX", "MAN_PACK_TO_STAGING", "MAN_DOOR_03_TO_STAGING"]), "the item is appended");
check(removeItem(added, "connections", "MAN_DOOR_03_TO_STAGING") === lanes, "removing the new item restores the file byte for byte");

const fresh = appendItem("# comment\nlanes:\n  - id: \"L\"\n    connects: [\"A\", \"B\"]\n", "connections", {
  id: "C", from: "A", to: "B", direction: "bidirectional", transport_mode: "walking",
});
check(fresh.startsWith("# comment\nlanes:") && ids(fresh, "connections")[0] === "C", "a missing list is created at the end");
const single = removeItem(fresh, "connections", "C");
check(JSON.stringify(readYaml(single).connections) === "[]", "removing the last item leaves an empty list");
check(ids(appendItem(single, "connections", { id: "D", from: "A", to: "B", direction: "one_way", transport_mode: "amr" }), "connections")[0] === "D", "an empty list can be appended to");

const storage = topology[`${hall3}storage.yaml`];
const withoutExit = removeItem(storage, "work_centers", "EXIT");
check(!withoutExit.includes("AutoStore port exit"), "the comment above a removed item goes with it");
check(changedLines(storage, withoutExit) <= 6, "removing EXIT touches only its own lines");
const wcs = topology[`${hall3}wcs.yaml`];
const withoutMiddle = removeItem(wcs, "reporting_points", "RP_C02");
check(/capacity: 1\n\n  - id: "RP_C03"/.test(withoutMiddle), "removing a middle item keeps one blank line between its neighbors");
const withoutFirst = removeItem(storage, "doors", "DOOR_01");
check(withoutFirst.includes("doors:\n  - id: \"DOOR_02\""), "removing the first item closes the gap below the list key");

// ---- updateItem: field by field ----
const repoFiles = (repo: string): Record<string, string> => specs.repos[repo].files;
const lists: [string, string, string][] = []; // repo, path, key
for (const repo of ["Topology-as-Code", "Allocation-as-Code", "MasterData-as-Code", "OrderOrchestration-as-Code"]) {
  for (const [path, text] of Object.entries(repoFiles(repo))) {
    if (!path.startsWith("customers/") || !path.endsWith(".yaml")) continue;
    for (const [key, value] of Object.entries(readYaml(text))) {
      if (Array.isArray(value) && value.length && value.every((v) => v && typeof v === "object" && !Array.isArray(v))) lists.push([repo, path, key]);
    }
  }
}
/** Every string leaf changed, so each scalar is spliced once. */
const touch = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(touch) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === "id" ? x : touch(x)])) : typeof v === "string" ? `${v}X` : v;
let items = 0, unchanged = 0, correct = 0, sameLines = 0;
for (const [repo, path, key] of lists) {
  const text = repoFiles(repo)[path];
  for (const [index, entry] of (readYaml(text)[key] as Item[]).entries()) {
    const id = typeof entry.id === "string" ? entry.id : index; // lists without ids: by position
    items++;
    const item = getItem(text, key, id);
    if (updateItem(text, key, id, item) === text) unchanged++;
    const changed = touch(item) as Item;
    const out = updateItem(text, key, id, changed);
    if (JSON.stringify(getItem(out, key, id)) === JSON.stringify(changed)) correct++;
    else console.log(`  ${repo}/${path} ${key}/${id}`);
    if (out.split("\n").length === text.split("\n").length) sameLines++;
  }
}
check(unchanged === items, `an unchanged item leaves the file byte for byte (${unchanged}/${items})`);
check(correct === items, `changing every text field of an item gives exactly the new values (${correct}/${items})`);
check(sameLines === items, `changing values in place keeps every line where it was (${sameLines}/${items})`);

const md = repoFiles("MasterData-as-Code");
const itemsPath = Object.keys(md).find((p) => p.endsWith("beverages/structure/items.yaml"))!;
const itemsText = md[itemsPath];
const item3 = getItem(itemsText, "items", "ITEM_003");
const longer = updateItem(itemsText, "items", "ITEM_003", { ...item3, tracking: { expiry: { ...(item3.tracking as any).expiry, total_shelf_life_days: 300 } } });
check(changedLines(itemsText, longer) === 2 && longer.includes("Shorter shelf life than the category default"), "a nested number changes on its line, the comments around it stay");
const { storage_condition, ...noCondition } = item3;
const cold = updateItem(itemsText, "items", "ITEM_003", noCondition as Item);
check(!cold.includes("storage_condition") && !cold.includes("Needs refrigeration") && changedLines(itemsText, cold) === 2, "a removed field takes its comment along, nothing else");
const item1 = getItem(itemsText, "items", "ITEM_001");
const ambient = updateItem(itemsText, "items", "ITEM_001", { ...item1, storage_condition: "ambient", dimensions: { ...(item1.dimensions as any), width: { value: 95, unit: "mm" } } });
check(ambient.includes(`    weight: { value: 1.55, unit: "kg" }\n    storage_condition: "ambient"\n`), "a new field is added at the end of the item, in the file's quoting");
check(ambient.includes(`width: { value: 95, unit: "mm" }`), "a value inside an inline map changes in place, padding kept");

const alloc = repoFiles("Allocation-as-Code");
const rulesPath = Object.keys(alloc).find((p) => p.endsWith("hall_3/strategies/search_rules.yaml"))!;
const rules = alloc[rulesPath];
const def = getItem(rules, "search_rules", "SEARCH_DEFAULT") as Item & { steps: any[] };
const moreSteps = updateItem(rules, "search_rules", "SEARCH_DEFAULT", { ...def, steps: [...def.steps, { zone: { type: "storage_type", id: "BLK" }, selection_strategy: "FIFO" }] });
check(moreSteps.includes(`        selection_strategy: "FIFO"\n      - zone: { type: "storage_type", id: "BLK" }\n        selection_strategy: "FIFO"\n`), "a new list entry inside an item follows the list's indentation and style");
check(changedLines(rules, moreSteps) <= 2 && moreSteps.includes("Found by WMS-POC actually running this rule"), "adding a step touches only the new lines");
const fewerSteps = updateItem(rules, "search_rules", "SEARCH_DEFAULT", { ...def, steps: def.steps.slice(0, 2) });
check(JSON.stringify((getItem(fewerSteps, "search_rules", "SEARCH_DEFAULT") as any).steps) === JSON.stringify(def.steps.slice(0, 2)), "a list entry inside an item can be removed");
const scoped = updateItem(rules, "search_rules", "SEARCH_DEFAULT", { ...def, applies_to: { category_id: "beverages" } } as Item);
check(JSON.stringify(getItem(scoped, "search_rules", "SEARCH_DEFAULT")) === JSON.stringify({ ...def, applies_to: { category_id: "beverages" } }), "a new nested field is written correctly");

// ---- Every list's schema resolves into a form ----
const catalog = Object.fromEntries(
  Object.entries(specs.repos as Record<string, { files: Record<string, string> }>).map(([repo, { files }]) => [
    repo,
    Object.fromEntries(Object.entries(files).filter(([p]) => p.startsWith("schemas/") || p.startsWith("elements/"))),
  ]),
);
let fields = 0;
function walk(at: Located, depth: number) {
  const { schema } = resolve(catalog, at);
  fields++;
  if (depth > 8) return;
  for (const sub of Object.values((schema.properties ?? {}) as Record<string, object>)) walk(child(at, sub), depth + 1);
  if (schema.items && !Array.isArray(schema.items)) walk(child(at, schema.items), depth + 1);
}
const topKinds = LISTS.map((def) => {
  const at = schemaAt(catalog, def.repo, def.schema);
  walk(at, 0);
  return kindOf(at.schema);
});
check(topKinds.every((k) => k === "object"), `every list entry's schema is a form (${LISTS.length} lists)${topKinds.some((k) => k !== "object") ? `: not ${LISTS.filter((_, i) => topKinds[i] !== "object").map((d) => d.key).join(", ")}` : ""}`);
check(unresolved.size === 0, `every $ref in their ${fields} fields resolves${unresolved.size ? `: ${[...unresolved].join("; ")}` : ""}`);

// ---- Findings in project language ----
// tests/findings-corpus.json: one real finding per kind, collected by scripts/collect-findings.py.
const corpus: string[] = JSON.parse(fs.readFileSync("tests/findings-corpus.json", "utf8"));
const untranslated = corpus.filter((line) => !explain(line).translated);
check(untranslated.length === 0, `every kind of finding in the corpus is translated (${corpus.length - untranslated.length}/${corpus.length})${untranslated.length ? `:\n    ${untranslated.slice(0, 10).join("\n    ")}` : ""}`);
const english = corpus.filter((line) => / (is|are|not|found|missing|must|has|does) /.test(explain(line).text));
check(english.length === 0, `no translated finding keeps English phrasing${english.length ? `:\n    ${english.slice(0, 5).map((l) => explain(l).text).join("\n    ")}` : ""}`);
const example = explain(
  "MasterData-as-Code/customers/example_customer/categories/beverages/structure/items.yaml: item 'ITEM_003': storage_condition 'frozen_xyz' not found in elements/storage_conditions.yaml",
);
check(
  example.location === "Stammdaten · example_customer · Kategorie beverages · Artikelstamm" &&
    example.subject === "Artikel ITEM_003" &&
    example.text === "Lagerbedingung „frozen_xyz“ ist im Katalog „storage_conditions“ nicht vorhanden.",
  `a catalog reference reads in project language (${JSON.stringify(example)})`,
);
const schema = explain("Topology-as-Code/customers/example_customer/facilities/facility_pa11/buildings/hall_3/structure/storage.yaml: storage_types[0].routing: 'aisles' is a required property");
check(schema.location === "Topologie · example_customer · PA11 · Halle 3 · Lagerstruktur" && schema.text.endsWith("Pflichtfeld „aisles“ fehlt."), `a schema finding names the field (${schema.text})`);
check(describePath("Warehouse-as-Code/sites/example_customer/pa11.yaml") === "Standorte · example_customer · Standort PA11", "a site manifest is named by its site");
// Findings the corpus cannot produce (rules that compare two fields), in the tools' own wording.
const fromSource = [
  "MasterData-as-Code/customers/c/categories/k/structure/items.yaml: item 'ITEM_003': tracking.expiry.min_remaining_at_receipt_days (60) exceeds total_shelf_life_days (20) - no delivery could ever be accepted",
  "MasterData-as-Code/customers/c/categories/k/structure/packaging.yaml: packaging 'ITEM_001' uom_hierarchy[0]: GTIN '4006381333931' has a wrong check digit",
  "MasterData-as-Code/customers/c/categories/k/structure/items.yaml: item 'ITEM_001': owner 'acme' not declared in company.yaml owners",
  "Allocation-as-Code/customers/c/facilities/f/buildings/b/strategies/fixed_bin_assignments.yaml: fixed_bin_assignments[0] (ITEM_001 @ FIX.FIX-01-01): min_qty (10) exceeds max_qty (5)",
  "Allocation-as-Code/customers/c/facilities/f/buildings/b/strategies/putaway_rules.yaml: putaway_rule 'PUT_A' steps[1]: zone 'HBR' already covered by steps[0] for the same load unit types and constraints - this step is unreachable",
  "Allocation-as-Code/customers/c/facilities/f/buildings/b/strategies/putaway_rules.yaml: putaway_rule 'PUT_A' steps[0]: zone 'RACK' is reserved for owners owner_alpha but the rule has no applies_to.owner",
  "OrderOrchestration-as-Code/customers/c/channels/w/order_types/t/strategies/completion_rules.yaml: completion_rule 'C1': action.supersedes_parent is true but structure/status.yaml has no 'superseded' status",
  "Topology-as-Code/customers/c/facilities/f/buildings/b/structure/storage.yaml: storage_type 'HBR': automation_level 'conveyor_automated' implies movement_policy 'explicit_only', found 'default_allow'",
  "Topology-as-Code/customers/c/facilities/f/buildings/b/structure/storage.yaml: storage_type 'HBR' aisle 1 bay 2: shelf_max_weight 900 kg exceeds bay_max_weight 800 kg",
  "Topology-as-Code/customers/c/facilities/f/buildings/b/structure/storage.yaml: door 'DOOR_01': staging_section 'STAGING.SEC_X': section 'SEC_X' not found in storage_type 'STAGING'",
  "Topology-as-Code/customers/c/facilities/f/buildings/b/warehouse.yaml: File is empty or invalid.",
];
const sourceMisses = fromSource.filter((line) => !explain(line).translated || / (is|are|not|found|must|has|exceeds) /.test(explain(line).text));
check(sourceMisses.length === 0, `findings from rules that compare fields are translated${sourceMisses.length ? `:\n    ${sourceMisses.map((l) => explain(l).text).join("\n    ")}` : ""}`);
const unknown = explain("customers/x/company.yaml: something entirely new happened");
check(!unknown.translated && unknown.text === "something entirely new happened" && unknown.location === "x · Firma", "an unknown finding keeps its text, with a readable location");

// ---- German and English texts ----
const deKeys = Object.keys(TEXTS.de).sort();
const enKeys = Object.keys(TEXTS.en).sort();
check(JSON.stringify(deKeys) === JSON.stringify(enKeys), `German and English have the same ${deKeys.length} texts`);
const placeholders = (text: string) => JSON.stringify((text.match(/\{\w+\}/g) ?? []).sort());
const mismatched = deKeys.filter((k) => placeholders(TEXTS.de[k]) !== placeholders(TEXTS.en[k]));
check(mismatched.length === 0, `both languages fill in the same placeholders${mismatched.length ? `: ${mismatched.join(", ")}` : ""}`);
const germanInEnglish = enKeys.filter((k) => /[äöüÄÖÜß„]/.test(TEXTS.en[k]));
check(germanInEnglish.length === 0, `no German letters in the English texts${germanInEnglish.length ? `: ${germanInEnglish.join(", ")}` : ""}`);
// Every key the code asks for exists (literal keys; t(`...${x}`) is checked through its prefix).
const used = new Set<string>();
for (const file of fs.readdirSync("src").filter((f) => /\.tsx?$/.test(f))) {
  const code = fs.readFileSync(`src/${file}`, "utf8");
  for (const m of code.matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
  for (const m of code.matchAll(/\btn\("([\w.]+)"/g)) used.add(`${m[1]}_one`).add(`${m[1]}_other`);
  for (const m of code.matchAll(/\bt\(`([\w.]+)\.\$\{/g)) used.add(`${m[1]}.*`);
  for (const m of code.matchAll(/\btl\("([\w]+)"/g)) used.add(`${m[1]}.*`);
}
const missing = [...used].filter((k) => (k.endsWith(".*") ? !deKeys.some((d) => d.startsWith(k.slice(0, -1))) : !(k in TEXTS.de)));
check(missing.length === 0, `every text the code uses exists (${used.size} keys)${missing.length ? `: ${missing.join(", ")}` : ""}`);

const englishFinding = explain(
  "MasterData-as-Code/customers/example_customer/categories/beverages/structure/items.yaml: item 'ITEM_003': storage_condition 'frozen_xyz' not found in elements/storage_conditions.yaml",
  "en",
);
check(
  englishFinding.location === "Master data · example_customer · Category beverages · Items" &&
    englishFinding.subject === "Item ITEM_003" &&
    englishFinding.text === "storage_condition 'frozen_xyz' not found in elements/storage_conditions.yaml",
  `in English a finding keeps the tool's words, with location and subject in English (${JSON.stringify(englishFinding)})`,
);
check(corpus.every((line) => explain(line, "en").text.length > 0), "every finding of the corpus has an English text");

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall unit checks passed");
process.exit(failures.length ? 1 : 0);
