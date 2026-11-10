// Unit tests for the YAML text edits, against the repos' own files
// (`npm run bundle` first). Run with `npm run test:unit`.
import fs from "node:fs";
import { addBuilding, proposeKind, readAml, toTopology } from "../src/amlImport";
import { stableId, toAutomationML } from "../src/automationml";
import { parseXml, XmlError } from "../src/xml";
import { describePath, explain } from "../src/findings";
import { adoptPlan, placeSpot, placeStorageType, setLayout } from "../src/editor";
import { floorPlan, metres } from "../src/floorplan";
import { buildGraph } from "../src/graph";
import { flowModel, reachability, seconds, verdict } from "../src/flow";
import { prepareFlow, Simulation } from "../src/simulation";
import { TEXTS } from "../src/i18n";
import { LISTS } from "../src/lists";
import { child, kindOf, resolve, schemaAt, unresolved, type Located } from "../src/schema";
import type { Building } from "../src/types";
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

// AutomationML export: a small hall, checked for structure, references and stable ids.
const amlHall: Building = {
  path: "customers/c/facilities/facility_f1/buildings/hall_1/warehouse.yaml", ok: true,
  customer: "c", facility: "F1", building: "hall_1", dataset: "c/f1/hall_1",
  entities: {
    warehouse: [{ id: "hall_1", name: "Hall <1> & \"two\"" }],
    storage_type: [{ id: "HBR", technology: "shuttle", depth: 2 }],
    section: [{ id: "HBR.SEC_A", storage_type: "HBR", local_id: "SEC_A" }],
    door: [{ id: "DOOR_01", direction: "inbound" }],
    work_center: [{ id: "WC_01", step: "packing", workstation_template: "ws_x", storage_point_ref: true }],
    equipment: [{ id: "SRM_01", type: "shuttle_4way", served_points: ["HBR"] }],
    lane: [{ id: "L1", template: "lane_y", connects: ["HBR", "DOOR_01", "WC_01"] }],
    can_edge: [
      { id: "e1", from: "DOOR_01", to: "HBR", source_type: "connection", source_id: "C1", transport_mode: "forklift", expected_duration: { value: 120, unit: "s" } },
      { id: "e2", from: "HBR", to: "DOOR_01", source_type: "connection", source_id: "C1", transport_mode: "forklift" },
      { id: "e3", from: "HBR", to: "WC_01", source_type: "lane", source_id: "L1", transport_mode: "lane" },
      { id: "e4", from: "WC_01", to: "DOOR_01", source_type: "lane", source_id: "L1", transport_mode: "lane" },
      { id: "e5", from: "DOOR_01", to: "NOWHERE", source_type: "connection", source_id: "C2", transport_mode: "walking" },
    ],
    activity_area: [{ id: "PICK", activity: "picking", bins_from: ["HBR.SEC_A", "MISSING"] }],
    movement_rule: [{ id: "R1", from: { storage_type: "HBR" }, to: { door: "DOOR_01" }, allowed: false }],
  },
  points: [
    { id: "HBR.A-01", storage_type: "HBR", section: "HBR.SEC_A", max_weight: { value: 500, unit: "kg" }, allowed_load_unit_types: ["pallet_euro"], blocked: false },
    { id: "WC_01", ref_kind: "work_center", coordinate: "WC_01" },
  ],
};
const aml = toAutomationML(amlHall, { now: "2026-11-09T10:00:00Z" });
check(aml.xml === toAutomationML(amlHall, { now: "2026-11-09T10:00:00Z" }).xml, "exporting the same hall twice gives the same AutomationML file");
check(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(stableId("x")) && stableId("x") !== stableId("y"), "ids are version-8 UUIDs derived from the data");
check(aml.fileName === "c_F1_hall_1.aml", `the file is named after the hall (${aml.fileName})`);
check(aml.xml.includes("Hall &lt;1&gt; &amp; &quot;two&quot;") || aml.xml.includes("Hall &lt;1&gt; &amp; \"two\""), "text is escaped");
const amlIds = [...aml.xml.matchAll(/ ID="([^"]+)"/g)].map((m) => m[1]);
check(new Set(amlIds).size === amlIds.length, `every ID is unique (${amlIds.length})`);
const portsOf = new Map<string, string[]>();
for (const m of aml.xml.matchAll(/<InternalElement Name="[^"]*" ID="([^"]+)"[^>]*>([\s\S]*?)(?=<InternalElement|<\/InternalElement)/g)) {
  portsOf.set(m[1], [...m[2].matchAll(/<ExternalInterface Name="([^"]+)"/g)].map((p) => p[1]));
}
const sides = [...aml.xml.matchAll(/RefPartnerSide[AB]="([^"]+)"/g)].map((m) => m[1]);
check(sides.length === 12 && sides.every((side) => portsOf.get(side.split(":")[0])?.includes(side.slice(side.indexOf(":") + 1))),
  `every link joins two existing ports (${sides.length / 2} links)`);
const roles = new Set([...aml.xml.matchAll(/<RoleClass Name="([^"]+)" RefBaseClassPath="WarehouseAsCodeRoleClassLib|<RoleClass Name="([^"]+)"/g)].map((m) => m[1] ?? m[2]));
const required = [...aml.xml.matchAll(/RefBaseRoleClassPath="WarehouseAsCodeRoleClassLib\/([^"]+)"/g)].map((m) => m[1]);
check(required.length > 0 && required.every((r) => roles.has(r)), "every role an element requires is defined");
check(aml.counts.elements === 7 && aml.counts.connections === 3 && aml.counts.mirrors === 1 && aml.counts.templates === 3,
  `structure, places, connections, mirrors and templates are counted (${JSON.stringify(aml.counts)})`);
check(JSON.stringify(aml.skipped) === JSON.stringify(["connection C2: NOWHERE", "activity_area PICK: MISSING"]), `missing targets are reported (${aml.skipped})`);
check(!aml.xml.includes("R1") && !aml.xml.includes('Name="WC_01" ID="' + stableId("c/f1/hall_1", "storage_point", "WC_01")),
  "movement rules and the storage-point twin of a work center are not exported");
check(aml.xml.includes('<Attribute Name="max_weight" Unit="kg" AttributeDataType="xs:double">') && aml.xml.includes('<Attribute Name="depth" AttributeDataType="xs:int">'),
  "measures keep their unit, integers their type");
check(/<InternalElement Name="HBR\.SEC_A"[^>]*>[\s\S]*?<InternalElement Name="HBR\.A-01"/.test(aml.xml), "a storage point is nested in its section");
const slim = toAutomationML(
  { ...amlHall, point_counts: { HBR: 2 }, points: [...amlHall.points!, { id: "HBR.A-02", storage_type: "HBR", section: "HBR.SEC_A" }],
    entities: { ...amlHall.entities, can_edge: [...amlHall.entities!.can_edge, { id: "e6", from: "DOOR_01", to: "HBR.A-02", source_type: "connection", source_id: "C3", transport_mode: "walking" }] } },
  { now: "2026-11-09T10:00:00Z", points: false },
);
check(slim.fileName === "c_F1_hall_1_without_storage_points.aml", `without storage points the file says so in its name (${slim.fileName})`);
check(!slim.xml.includes('Name="HBR.A-01"') && slim.xml.includes('Name="HBR.A-02"') && slim.counts.points === 1,
  "without storage points only those a connection ends at stay");
check(/<Attribute Name="storage_point_count" AttributeDataType="xs:int">\s*<Value>2<\/Value>/.test(slim.xml), "a storage type then states how many storage points it has");
check(aml.counts.points === 1 && !aml.xml.includes("storage_point_count"), "with storage points every one is exported and no count is added");
check(aml.xml.indexOf("<SystemUnitClassLib") < aml.xml.indexOf("<AttributeTypeLib") && aml.xml.indexOf("<RoleClassLib") < aml.xml.indexOf("<SystemUnitClassLib"),
  "libraries come in the order CAEX 3.0 requires");

// AutomationML import: the XML reader, a round trip of the small hall, and a planner's file with standard roles.
const xmlDoc = parseXml('<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><b><![CDATA[<raw>]]></b><c:d xmlns:c="u" c:y="&#228;">t &lt; u</c:d><e/></a>');
check(xmlDoc.name === "a" && xmlDoc.attrs.x === "1 & 2" && xmlDoc.children[0].text === "<raw>" && xmlDoc.children[1].name === "d" &&
  xmlDoc.children[1].attrs.y === "ä" && xmlDoc.children[1].text === "t < u" && xmlDoc.children.length === 3, "the XML reader handles entities, CDATA, comments and prefixes");
let xmlFailed = "";
try { parseXml("<a><b></a>"); } catch (e) { xmlFailed = e instanceof XmlError ? e.message : ""; }
check(/does not match/.test(xmlFailed), `the XML reader rejects mismatched tags (${xmlFailed})`);
check(proposeKind("WarehouseAsCodeRoleClassLib/Door") === "door" && proposeKind("AutomationMLDMIRoleClassLib/DMIRoleClassLib/Gate") === "door" &&
  proposeKind("AutomationMLExtendedRoleClassLib/WorkCenter") === "ignore" && proposeKind("") === "ignore",
  "kinds follow this project's roles and the crosswalk's standard roles; the false friend WorkCenter is not taken");

const importCatalog: Record<string, Record<string, string>> = {};
for (const [repo, info] of Object.entries<{ files: Record<string, string> }>(specs.repos)) {
  importCatalog[repo] = Object.fromEntries(Object.entries(info.files).filter(([p]) => p.startsWith("schemas/") || p.startsWith("elements/")));
}
const facilityPath = "customers/c/facilities/facility_f1/facility.yaml";
const facilityText = 'facility:\n  id: "F1"\n  name: "Site"\n\n  buildings:\n    # the halls\n    - "buildings/hall_1/warehouse.yaml"\n\nextra: 1\n';
check(addBuilding(facilityText, "buildings/hall_2/warehouse.yaml") ===
  facilityText.replace('hall_1/warehouse.yaml"\n', 'hall_1/warehouse.yaml"\n    - "buildings/hall_2/warehouse.yaml"\n'),
  "a new building is added to facility.yaml's list, the rest unchanged");
const target = { customer: "c", facilityPath, facility: "F1", building: "hall_2" };
const back = toTopology(readAml(aml.xml), {}, target, facilityText, importCatalog, "c_F1_hall_1.aml");
const backFile = (name: string) => readYaml(back.files.find((f) => f.path.endsWith(name))!.text) as Record<string, any>;
const backStorage = backFile("structure/storage.yaml");
const backLanes = backFile("structure/lanes.yaml");
const hbr = backStorage.storage_types[0];
check(hbr.id === "HBR" && hbr.technology === "shuttle" && hbr.depth === 2 && hbr.sections[0].id === "SEC_A" &&
  JSON.stringify(hbr.storage_points[0]) === JSON.stringify({ coordinate: "A-01", max_weight: { value: 500, unit: "kg" }, blocked: false, section: "SEC_A", allowed_load_unit_types: ["pallet_euro"] }),
  `round trip: the storage type keeps its fields, section and storage point (${JSON.stringify(hbr)})`);
check(backStorage.work_centers[0].workstation_template === "ws_x" && backFile("structure/wcs.yaml").equipment[0].type === "shuttle_4way",
  "round trip: templates come back from the system unit classes");
check(JSON.stringify(backStorage.activity_areas[0].bins_from) === '["HBR.SEC_A"]', "round trip: an activity area takes its bins from its mirror objects' masters");
check(JSON.stringify(backLanes.connections) === JSON.stringify([{ id: "C1", from: "DOOR_01", to: "HBR", direction: "bidirectional", transport_mode: "forklift", expected_duration: { value: 120, unit: "s" } }]) &&
  JSON.stringify(backLanes.lanes) === JSON.stringify([{ id: "L1", template: "lane_y", connects: ["HBR", "WC_01", "DOOR_01"] }]),
  `round trip: a connection both ways and a lane come back (${JSON.stringify(backLanes)})`);
const backWarehouse = backFile("warehouse.yaml");
check(backWarehouse.target.building === "hall_2" && backWarehouse.metadata.dataset_id === "c/f1/hall_2" && backWarehouse.warehouse.name === 'Hall <1> & "two"' &&
  JSON.stringify(backWarehouse.warehouse.imports) === '["structure/storage.yaml","structure/wcs.yaml","structure/lanes.yaml"]',
  "round trip: warehouse.yaml names the new building and imports its files");
check(back.files.some((f) => f.path === facilityPath && f.text.includes("buildings/hall_2/warehouse.yaml")), "round trip: the facility lists the new building");
check(back.notes.some((n) => n.code === "tooFewEnds" && n.element === "C2"), "round trip: a connection with one known end is reported, not written");

const planner = readAml(fs.readFileSync("tests/fixtures/layout-planner.aml", "utf8"));
const proposed = Object.fromEntries(planner.elements.map((e) => [e.name, e.proposed]));
check(proposed["Hochregal 1"] === "storage_type" && proposed["Fach 01"] === "storage_point" && proposed["Tor 1"] === "door" &&
  proposed["Förderer 1"] === "connection" && proposed["Feuerlöscher 3"] === "ignore" && proposed["Roboter A"] === "ignore" && proposed["Halle 7"] === "building",
  `a planner's standard roles get kinds (${JSON.stringify(proposed)})`);
const planned = toTopology(planner, {}, target, facilityText, importCatalog, "layout-planner.aml");
const plannedStorage = readYaml(planned.files.find((f) => f.path.endsWith("storage.yaml"))!.text) as Record<string, any>;
const plannedLanes = readYaml(planned.files.find((f) => f.path.endsWith("lanes.yaml"))!.text) as Record<string, any>;
check(plannedStorage.storage_types.map((x: { id: string }) => x.id).join() === "HOCHREGAL_1,KOMMISSIONIERZONE" &&
  JSON.stringify(plannedStorage.storage_types[1].storage_points) === '[{"coordinate":"KOMMISSIONIERZONE"}]',
  "free names become schema-conform ids; a storage type without points gets one place");
check(JSON.stringify(plannedLanes.connections) === JSON.stringify([
  { id: "FOERDERER_1", from: "HOCHREGAL_1", to: "KOMMISSIONIERZONE", direction: "one_way", transport_mode: "conveyor" },
  { id: "TOR_1_TO_KOMMISSIONIERZONE", from: "TOR_1", to: "KOMMISSIONIERZONE", direction: "bidirectional", transport_mode: "walking" },
]), `a conveyor element's port directions give a one-way connection; a direct link a two-way one (${JSON.stringify(plannedLanes.connections)})`);
const codes = planned.notes.map((n) => n.code);
check(planned.notes.some((n) => n.code === "filled" && n.field === "staging_section") && codes.includes("renamed") && codes.includes("directLink") &&
  codes.includes("assumedMode") && codes.includes("addedPoint") && planned.notes.some((n) => n.code === "ignored" && n.count === 2) &&
  planned.notes.some((n) => n.code === "dropped" && n.fields.includes("height")),
  `what the import assumed or left out is reported (${codes.join(", ")})`);
const pickId = planner.elements.find((e) => e.name === "Kommissionierzone")!.id;
const without = toTopology(planner, { [pickId]: "ignore" }, target, facilityText, importCatalog);
check(!without.files.some((f) => f.path.endsWith("lanes.yaml")) && without.notes.some((n) => n.code === "unknownEnd"),
  "a changed kind changes the result: without the pick zone, no connection has two ends");

// Material flow: a small hall built by hand. IN (inbound door) -> BUF (manual)
// -> PACK (work center, 60/h) -> OUT (outbound door); AUTO (explicit_only)
// hangs off BUF on a conveyor segment; LOOSE has no connection.
const flowHall = {
  path: "flow-test", ok: true,
  point_counts: { BUF: 10, AUTO: 10, LOOSE: 5 },
  entities: {
    door: [{ id: "IN", direction: "inbound" }, { id: "OUT", direction: "outbound" }],
    storage_type: [
      { id: "BUF", movement_policy: "default_allow" },
      { id: "AUTO", movement_policy: "explicit_only" },
      { id: "LOOSE", movement_policy: "default_allow" },
    ],
    work_center: [{ id: "PACK", throughput_capacity: 60 }],
    can_edge: [
      { id: "connection:C1:IN:BUF", from: "IN", to: "BUF", source_type: "connection", source_id: "C1", transport_mode: "forklift", expected_duration: { value: 2, unit: "min" } },
      { id: "connection:C2:BUF:PACK", from: "BUF", to: "PACK", source_type: "connection", source_id: "C2", transport_mode: "walking" },
      { id: "connection:C3:PACK:OUT", from: "PACK", to: "OUT", source_type: "connection", source_id: "C3", transport_mode: "walking", expected_duration: { value: 30, unit: "s" } },
      { id: "conveyor_segment:S1:BUF:AUTO", from: "BUF", to: "AUTO", source_type: "conveyor_segment", source_id: "S1", transport_mode: "conveyor", capacity: 1 },
    ],
    movement_rule: [
      { id: "NO_IN_TO_PACK", from: { door: "IN" }, to: { work_center: "PACK" }, allowed: false },
      { id: "BUF_TO_AUTO", from: { storage_type: "BUF" }, to: { storage_type: "AUTO", section: "S_A" }, allowed: true },
    ],
  },
} as unknown as Building;
const fm = flowModel(flowHall);
check(seconds({ value: 4, unit: "min" }) === 240 && seconds({ value: 3 }) === 3 && seconds("x") === undefined, "durations are read in seconds");
const reach = reachability(fm);
const inBuf = reach.inbound.find((m) => m.from === "IN" && m.to === "BUF")!;
check(inBuf.path?.length === 1 && inBuf.seconds === 120 && inBuf.verdict.allowed, "IN -> BUF: one connection, 2 min, allowed by default");
const inAuto = reach.inbound.find((m) => m.to === "AUTO")!;
check(inAuto.path?.map((l) => l.to).join(">") === "BUF>AUTO" && !inAuto.verdict.allowed && inAuto.verdict.reason === "explicit_missing",
  "IN -> AUTO has a path, but explicit_only needs a rule naming the move");
const bufAuto = verdict(fm, "BUF", "AUTO");
check(bufAuto.allowed && bufAuto.rule === "BUF_TO_AUTO" && bufAuto.partial === "section S_A", "a rule naming both sides allows an explicit_only move, noting its section");
check(verdict(fm, "IN", "PACK").reason === "forbidden", "a rule with allowed: false forbids");
check(reach.unconnected.join() === "LOOSE" && reach.inbound.find((m) => m.to === "LOOSE")!.path === null, "a storage type without connections is unreachable");
const outFlow = prepareFlow(fm, { from: "BUF", via: "PACK", to: "OUT", perHour: 10 }, true);
check(!outFlow.problems.length && outFlow.nodes.join(">") === "BUF>PACK>OUT", "an outbound flow via a work center runs through it");
check(prepareFlow(fm, { from: "IN", to: "AUTO", perHour: 10 }, true).problems[0]?.problem === "forbidden" &&
  !prepareFlow(fm, { from: "IN", to: "AUTO", perHour: 10 }, false).problems.length, "without the rules, only the physical path counts");

const run = (perHour: number, fill = 0.5) => {
  const sim = new Simulation(fm, flowHall.point_counts!, { flows: [{ from: "IN", to: "BUF", perHour }, { from: "BUF", via: "PACK", to: "OUT", perHour }], rules: true, fill, seed: 7 });
  sim.advance(8 * 3600);
  return sim.snapshot();
};
const calm = run(20);
const fingerprint = (s: ReturnType<typeof run>) => JSON.stringify([s.flows, [...s.nodes.values()], [...s.links.entries()]]);
check(fingerprint(calm) === fingerprint(run(20)), "the same seed gives the same result");
check(calm.flows[0].done > 100 && calm.flows[1].done > 100, `both flows move load units (${calm.flows[0].done} in, ${calm.flows[1].done} out)`);
const pack = calm.nodes.get("PACK")!;
check(pack.utilization > 0.25 && pack.utilization < 0.45, `20 per hour at 60 per hour keeps the work center about a third busy (${pack.utilization.toFixed(2)})`);
const buf = calm.nodes.get("BUF")!;
check(buf.stock! >= 0 && buf.stock! <= buf.capacity!, "stock stays within the storage points");
const busy = run(90);
check(busy.bottleneck?.id === "PACK" && busy.bottleneck.utilization > 0.95, `90 per hour jams the 60-per-hour work center (${busy.bottleneck?.id})`);
const empty = new Simulation(fm, flowHall.point_counts!, { flows: [{ from: "BUF", to: "OUT", perHour: 30 }], rules: true, fill: 0, seed: 1 });
empty.advance(3600);
check(empty.snapshot().flows[0].done === 0 && empty.snapshot().flows[0].waitingToStart > 0, "an empty storage type sends nothing; the orders wait");
const full = new Simulation(fm, flowHall.point_counts!, { flows: [{ from: "IN", to: "BUF", perHour: 60 }], rules: true, fill: 1, seed: 1 });
full.advance(3600);
check(full.snapshot().flows[0].done === 0 && full.snapshot().nodes.get("IN")!.queue > 0, "a full storage type takes nothing; load units wait at the door");

// Layout findings of Topology-as-Code's validate.py, in project language.
const layoutFile = "Topology-as-Code/customers/example_customer/facilities/facility_pa11/buildings/hall_3/structure/storage.yaml";
const layoutFindings = [
  "storage_type 'HBR': footprint (2..22 m, 4..44 m) lies outside warehouse.layout (20 m x 50 m)",
  "storage_type 'HBR_FLEX': footprint overlaps the footprint of storage_type 'HBR'",
  "door 'DOOR_01': position (61 m, 0 m) lies outside warehouse.layout (60 m x 50 m)",
  "storage_type 'HBR': exception '01-01-06': position (20 m, 3 m) lies outside the storage_type's footprint (2..14 m, 4..44 m)",
].map((line) => explain(`${layoutFile}: ${line}`, "de"));
check(layoutFindings.every((f) => f.translated) && layoutFindings[1].text === "Die Fläche überlappt die Fläche des Lagertyps „HBR“." && layoutFindings[1].subject === "Lagertyp HBR_FLEX",
  `the layout findings are translated (${layoutFindings.map((f) => f.text).join(" | ")})`);

// Hall plan: a rack with 2 rows of 2 bays (2 levels, 2 places side by side),
// a block storage type without bays or sizes, a door and a connection.
const rackPoint = (aisle: number, bay: number, level: number, pos: number, extra = {}) => ({
  id: `RACK.${aisle}-${bay}-${level}-${pos}`, storage_type: "RACK", coordinate: `${aisle}-${bay}-${level}-${pos}`,
  bay: `RACK.F${aisle}-${bay}`, shelf: `RACK.F${aisle}-${bay}-L0${level}`, storage_condition: "chilled",
  size: { width: { value: 120, unit: "cm" }, depth: { value: 1, unit: "m" }, height: { value: 0.4, unit: "m" } }, ...extra,
});
const rackPoints = [1, 2].flatMap((aisle) => [1, 2].flatMap((bay) => [1, 2].flatMap((level) => [1, 2].map((pos) =>
  rackPoint(aisle, bay, level, pos, aisle === 2 && bay === 1 && level === 1 && pos === 2 ? { blocked: true, blocked_reason: "OBSTRUCTION" } : {})))));
const planHall = {
  path: "plan-test", ok: true,
  points: [...rackPoints, ...[1, 2, 3].map((n) => ({ id: `FLOOR.B${n}`, storage_type: "FLOOR", coordinate: `B${n}` }))],
  point_counts: { RACK: 16, FLOOR: 3 },
  entities: {
    storage_type: [{ id: "RACK", access_model: "rack" }, { id: "FLOOR", access_model: "block" }],
    door: [{ id: "GATE", direction: "inbound" }],
    bay: [1, 2].flatMap((aisle) => [1, 2].map((bay) => ({ id: `RACK.F${aisle}-${bay}`, storage_type: "RACK", aisle, bay }))),
    shelf: [1, 2].flatMap((aisle) => [1, 2].flatMap((bay) => [1, 2].map((level) => ({ id: `RACK.F${aisle}-${bay}-L0${level}`, bay: `RACK.F${aisle}-${bay}`, level })))),
    can_edge: [{ id: "connection:C1:GATE:RACK", from: "GATE", to: "RACK", source_type: "connection", source_id: "C1", transport_mode: "forklift" }],
  },
} as unknown as Building;
const plan = floorPlan(planHall, buildGraph(planHall));
check(metres({ value: 120, unit: "cm" }) === 1.2 && metres({ value: 0, unit: "m" }) === undefined, "lengths are read in metres");
const rack = plan.blocks.find((b) => b.id === "RACK")!;
const floor = plan.blocks.find((b) => b.id === "FLOOR")!;
check(rack.cells.length === 4 && rack.rows.length === 2 && !rack.flat, "a rack is drawn as its rows and bays");
const firstBay = rack.cells.find((c) => c.id === "RACK.F1-1")!;
check(firstBay.levels === 2 && firstBay.positions === 2 && firstBay.points.length === 4, "a bay knows its levels, places side by side and places");
check(firstBay.width === Math.round(2 * 1.2 * 26) && firstBay.height === 26 && !firstBay.assumed, "a bay's footprint follows the places' size");
check(firstBay.condition === "chilled" && rack.cells.find((c) => c.id === "RACK.F2-1")!.blocked === 1, "a bay carries its storage condition and blocked places");
check(floor.flat && floor.cells.length === 3 && floor.cells.every((c) => c.assumed) && plan.assumed === 3, "places without bay and size are drawn one by one, at the assumed size");
check(plan.flatRacks.length === 0, "a block storage type without bays is not reported as a rack without bays");
const inside = (b: { x: number; y: number; width: number; height: number }) =>
  b.x >= 0 && b.y >= 0 && b.x + b.width <= plan.hall.width && b.y + b.height <= plan.hall.height;
const apart = (a: typeof rack, b: typeof rack) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
check(plan.blocks.every(inside) && apart(rack, floor), "the blocks lie inside the hall and do not overlap");
check(rack.cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.width <= rack.width && c.y + c.height <= rack.height), "the bays lie inside their block");
const gate = plan.spots.find((s) => s.id === "GATE")!;
check(gate.kind === "door" && gate.y < plan.hall.height && gate.y + gate.height > plan.hall.height, "a door sits in the hall's wall");
check(plan.links.length === 1 && plan.links[0].from === "GATE" && plan.links[0].to === "RACK", "a physical connection is drawn between its ends");
check(!plan.real && !plan.waiting && plan.blocks.every((b) => !b.placed), "without layout data the plan is calculated");

// The same hall with a layout: the rack has a footprint, the door a position; the floor storage has none.
const len = (value: number) => ({ value, unit: "m" });
const realHall = JSON.parse(JSON.stringify(planHall)) as Building;
realHall.entities!.warehouse = [{ id: "h", layout: { width: len(40), depth: len(20) } }];
realHall.entities!.storage_type[0].footprint = { position: { x: len(2), y: len(4) }, width: len(10), depth: { value: 600, unit: "cm" } };
realHall.entities!.door[0].position = { x: len(20), y: len(20) };
const real = floorPlan(realHall, buildGraph(realHall));
const realRack = real.blocks.find((b) => b.id === "RACK")!;
check(real.real && real.layout?.width === 40 && real.hall.width === 40 * 26 && real.hall.height === 20 * 26, "the hall takes its size from warehouse.layout");
check(realRack.placed && realRack.x === 52 && realRack.y === 104 && realRack.width === 260 && realRack.height === 156, "a storage type is drawn at its footprint");
check(realRack.cells.length === 4 && realRack.cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.width <= realRack.width + 0.5 && c.y + c.height <= realRack.height + 0.5),
  "its bays are spread over the footprint");
const realGate = real.spots.find((sp) => sp.id === "GATE")!;
check(realGate.placed && realGate.x + realGate.width / 2 === 520 && realGate.y + realGate.height / 2 === 520, "a door is drawn centered on its position");
const realFloor = real.blocks.find((b) => b.id === "FLOOR")!;
check(!realFloor.placed && real.waiting !== undefined && realFloor.x >= real.hall.width && realFloor.x >= real.waiting.x, "a storage type without footprint waits beside the hall");

// Layout edits on the example data's files.
const lp01 = "customers/example_3pl/facilities/facility_lp01/buildings/hall_1/";
const lpFiles: Record<string, string> = Object.fromEntries(Object.entries(topology).filter(([path]) => path.startsWith(lp01)));
const lpBuilding = {
  path: `${lp01}warehouse.yaml`, ok: true,
  sources: { "storage.yaml": `${lp01}structure/storage.yaml`, "wcs.yaml": `${lp01}structure/wcs.yaml`, "lanes.yaml": `${lp01}structure/lanes.yaml` },
} as unknown as Building;
const lpStorage = readYaml(lpFiles[`${lp01}structure/storage.yaml`]) as { storage_types: { id: string }[]; doors: { id: string }[] };
const [firstType, firstDoor] = [lpStorage.storage_types[0].id, lpStorage.doors[0].id];
const placed = placeStorageType(lpBuilding, lpFiles, firstType, { x: 3.3, y: 0.2, width: 9.1, depth: 4 });
const placedType = (readYaml(placed.text).storage_types as { id: string; footprint?: unknown }[]).find((st) => st.id === firstType)!;
check(JSON.stringify(placedType.footprint) === JSON.stringify({ position: { x: len(3.5), y: len(0) }, width: len(9.5), depth: len(4) }),
  `placing a storage type writes its footprint on the 0.5 m grid (${JSON.stringify(placedType.footprint)})`);
check(changedLines(lpFiles[placed.path], placed.text) <= 6, "placing changes only the footprint's lines");
const doorMove = placeSpot(lpBuilding, lpFiles, "door", firstDoor, { x: 12.24, y: 30 });
check(JSON.stringify((readYaml(doorMove.text).doors as { id: string; position?: unknown }[]).find((d) => d.id === firstDoor)!.position) === JSON.stringify({ x: len(12), y: len(30) }),
  "placing a door writes its position");
const hallSet = setLayout(lpBuilding, lpFiles, { width: 59.6, depth: 40 });
check(JSON.stringify((readYaml(hallSet.text).warehouse as { layout?: unknown }).layout) === JSON.stringify({ width: len(60), depth: len(40) }), "the hall's size is written to warehouse.yaml");
const adopted = adoptPlan(lpBuilding, lpFiles, { ...plan, blocks: plan.blocks.map((b, i) => ({ ...b, id: lpStorage.storage_types[i].id })), spots: plan.spots.map((sp) => ({ ...sp, id: firstDoor })) });
const adoptedStorage = readYaml(adopted.find((c) => c.path.endsWith("storage.yaml"))!.text) as { storage_types: { footprint?: unknown }[]; doors: { position?: unknown }[] };
check(adopted.length === 2 && adopted.some((c) => c.path.endsWith("warehouse.yaml")) && adoptedStorage.storage_types.filter((st) => st.footprint).length === 2 && Boolean(adoptedStorage.doors[0].position),
  "adopting a calculated plan writes the hall, every footprint and every position, one change per file");

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall unit checks passed");
process.exit(failures.length ? 1 : 0);
