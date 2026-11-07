// Unit tests for the YAML text edits, against the repos' own files
// (`npm run bundle` first). Run with `npm run test:unit`.
import fs from "node:fs";
import { appendItem, readYaml, removeItem } from "../src/yamlEdit";

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

console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall unit checks passed");
process.exit(failures.length ? 1 : 0);
