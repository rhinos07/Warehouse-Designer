// Unit tests for the YAML text edits, against the repos' own files
// (`npm run bundle` first). Run with `npm run test:unit`.
import fs from "node:fs";
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

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall unit checks passed");
process.exit(failures.length ? 1 : 0);
