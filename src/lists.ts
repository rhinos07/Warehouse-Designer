// The lists the data tab edits: which file and key, and the schema each entry
// validates against - the same pairs the repos' tools/validate.py uses.
import type { RepoName, UserFile } from "./types";
import { readYaml } from "./yamlEdit";

export interface ListDef {
  repo: RepoName;
  file: string; // file name, as validate.py finds it among a building's or category's imports
  key: string;
  schema: string; // schemas/<file>#<pointer> of one entry
  label: string;
  /** The key holds one object rather than a list of entries (e.g. shortage_policy). */
  single?: boolean;
}

export const LISTS: ListDef[] = [
  { repo: "MasterData-as-Code", file: "items.yaml", key: "items", schema: "schemas/item.schema.json", label: "Artikel" },
  { repo: "MasterData-as-Code", file: "packaging.yaml", key: "packaging", schema: "schemas/packaging.schema.json", label: "Verpackungen" },
  { repo: "MasterData-as-Code", file: "sourcing.yaml", key: "sourcing", schema: "schemas/sourcing.schema.json", label: "Beschaffung" },
  { repo: "MasterData-as-Code", file: "lifecycle.yaml", key: "lifecycle", schema: "schemas/lifecycle.schema.json", label: "Lebenszyklus" },
  { repo: "Allocation-as-Code", file: "search_rules.yaml", key: "search_rules", schema: "schemas/search-rule.schema.json", label: "Suchregeln (Auslagerung)" },
  { repo: "Allocation-as-Code", file: "putaway_rules.yaml", key: "putaway_rules", schema: "schemas/putaway-rule.schema.json", label: "Einlagerregeln" },
  { repo: "Allocation-as-Code", file: "fixed_bin_assignments.yaml", key: "fixed_bin_assignments", schema: "schemas/fixed-bin-assignment.schema.json", label: "Festplätze" },
  { repo: "Allocation-as-Code", file: "area_assignments.yaml", key: "area_assignments", schema: "schemas/area-assignment.schema.json", label: "Bereichszuordnungen" },
  { repo: "Topology-as-Code", file: "storage.yaml", key: "storage_types", schema: "schemas/storage-type.schema.json", label: "Lagertypen" },
  { repo: "Topology-as-Code", file: "storage.yaml", key: "activity_areas", schema: "schemas/storage.schema.json#/properties/activity_areas/items", label: "Aktivitätsbereiche" },
  { repo: "Topology-as-Code", file: "storage.yaml", key: "work_centers", schema: "schemas/storage.schema.json#/properties/work_centers/items", label: "Arbeitsplätze" },
  { repo: "Topology-as-Code", file: "storage.yaml", key: "doors", schema: "schemas/door.schema.json", label: "Tore" },
  { repo: "Topology-as-Code", file: "wcs.yaml", key: "controller_definitions", schema: "schemas/wcs.schema.json#/properties/controller_definitions/items", label: "Steuerungen" },
  { repo: "Topology-as-Code", file: "wcs.yaml", key: "reporting_points", schema: "schemas/wcs.schema.json#/properties/reporting_points/items", label: "Meldepunkte" },
  { repo: "Topology-as-Code", file: "wcs.yaml", key: "equipment", schema: "schemas/wcs.schema.json#/properties/equipment/items", label: "Geräte" },
  { repo: "Topology-as-Code", file: "lanes.yaml", key: "connections", schema: "schemas/lanes.schema.json#/properties/connections/items", label: "Verbindungen" },
  { repo: "Topology-as-Code", file: "lanes.yaml", key: "lanes", schema: "schemas/lanes.schema.json#/properties/lanes/items", label: "Fahrwege" },
  { repo: "Topology-as-Code", file: "lanes.yaml", key: "conveyor_segments", schema: "schemas/lanes.schema.json#/properties/conveyor_segments/items", label: "Förderabschnitte" },
  { repo: "Topology-as-Code", file: "movement_rules.yaml", key: "movement_rules", schema: "schemas/movement-rule.schema.json", label: "Bewegungsregeln" },
  { repo: "OrderOrchestration-as-Code", file: "split_rules.yaml", key: "split_rules", schema: "schemas/split-rule.schema.json", label: "Split-Regeln" },
  { repo: "OrderOrchestration-as-Code", file: "workflow_triggers.yaml", key: "workflow_triggers", schema: "schemas/workflow-trigger.schema.json", label: "Workflow-Trigger" },
  { repo: "OrderOrchestration-as-Code", file: "completion_rules.yaml", key: "completion_rules", schema: "schemas/completion-rule.schema.json", label: "Abschlussregeln" },
  { repo: "OrderOrchestration-as-Code", file: "status.yaml", key: "statuses", schema: "schemas/status.schema.json#/properties/statuses/items", label: "Status" },
  { repo: "OrderOrchestration-as-Code", file: "status.yaml", key: "transitions", schema: "schemas/status.schema.json#/properties/transitions/items", label: "Statusübergänge" },
  { repo: "OrderOrchestration-as-Code", file: "shortage_policy.yaml", key: "shortage_policy", schema: "schemas/shortage-policy.schema.json#/properties/shortage_policy", label: "Fehlmengen-Regel", single: true },
  { repo: "OrderOrchestration-as-Code", file: "fields.yaml", key: "fields", schema: "schemas/fields.schema.json#/properties/fields", label: "Felder", single: true },
  { repo: "Topology-as-Code", file: "replenishment.yaml", key: "replenishment_strategies", schema: "schemas/replenishment-strategy.schema.json", label: "Nachschub" },
];

/** One list in one file of the user's data. */
export interface ListRef {
  def: ListDef;
  path: string; // inside the repo
  customer: string;
  scope: string; // the part between customer and file, e.g. facility_pa11/hall_3 or beverages
}

export const listKey = (ref: { def: ListDef; path: string }) => `${ref.def.repo}/${ref.path}#${ref.def.key}`;

/** Every editable list in the data, sorted by repo, customer and place. */
export function findLists(files: UserFile[]): ListRef[] {
  const found: ListRef[] = [];
  for (const file of files) {
    const parts = file.path.split("/");
    if (parts[0] !== "customers" || parts.length < 3) continue;
    for (const def of LISTS) {
      if (def.repo !== file.repo || parts[parts.length - 1] !== def.file) continue;
      let data: Record<string, unknown>;
      try {
        data = readYaml(file.text);
      } catch {
        continue;
      }
      if (!(def.key in data)) continue;
      const scope = parts
        .slice(2, -1)
        .filter((p) => !["facilities", "buildings", "categories", "structure", "strategies", "channels", "order_types"].includes(p))
        .join(" / ");
      found.push({ def, path: file.path, customer: parts[1], scope });
    }
  }
  const order = (r: ListRef) => [r.def.repo, r.customer, r.scope, String(LISTS.indexOf(r.def)).padStart(3, "0")].join("|");
  return found.sort((a, b) => order(a).localeCompare(order(b)));
}

/** A short name for a list entry: its id, else its first identifying field. */
export function entryLabel(entry: unknown, index: number): string {
  if (!entry || typeof entry !== "object") return `#${index + 1}`;
  const e = entry as Record<string, unknown>;
  if (typeof e.id === "string") return e.id;
  const parts = ["item_id", "storage_point", "zone", "owner"].filter((k) => e[k] !== undefined).map((k) => {
    const v = e[k];
    return typeof v === "object" ? Object.values(v as object).join(":") : String(v);
  });
  return parts.length ? parts.join(" · ") : `#${index + 1}`;
}
