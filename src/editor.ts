// Topology edits on a building's source files. Each edit returns the changed
// file; the page then recompiles and revalidates with the repo's own tools.
import { t } from "./i18n";
import type { Building } from "./types";
import { appendItem, EditError, readYaml, removeItem, type Item } from "./yamlEdit";

export { EditError };

/** Topology-as-Code files, by path inside the repo. */
export type Files = Record<string, string>;

export interface Change {
  path: string;
  text: string;
  summary: string;
  /** Node to select after the change, e.g. the element just added. */
  select?: string;
}

// Enums from Topology-as-Code's schemas (lanes, door, wcs).
export const TRANSPORT_MODES = ["walking", "forklift", "tugger", "amr", "conveyor"];
export const DIRECTIONS = ["bidirectional", "one_way"];
export const DOOR_DIRECTIONS = ["inbound", "outbound", "returns"];
export const REPORTING_POINT_TYPES = ["identification_point", "aisle_decision_point", "clarification_point"];
export const COMMON_STEPS = ["goods_receipt", "induction", "picking", "packing", "goods_dispatch"];

/** Node kinds a connection may join (validate.py: connection.from/to). */
export const ENDPOINT_KINDS = ["storage_type", "door", "work_center", "reporting_point"];

const MODE_PREFIX: Record<string, string> = { walking: "MAN", forklift: "MAN", tugger: "TUG", amr: "AMR", conveyor: "CONV" };

/** Where each element kind lives: file name (as compile.py finds it) and list key. */
export const HOME: Record<string, [file: string, key: string]> = {
  door: ["storage.yaml", "doors"],
  work_center: ["storage.yaml", "work_centers"],
  reporting_point: ["wcs.yaml", "reporting_points"],
  connection: ["lanes.yaml", "connections"],
  lane: ["lanes.yaml", "lanes"],
  conveyor_segment: ["lanes.yaml", "conveyor_segments"],
};

function source(building: Building, files: Files, name: string): [path: string, text: string] {
  const path = building.sources?.[name];
  if (!path || files[path] === undefined) throw new EditError(t("editor.noImport", { file: name }));
  return [path, files[path]];
}

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];

/** Every id the building uses: compiled entities and the ids written in its files. */
export function takenIds(building: Building, files: Files): Set<string> {
  const ids = new Set<string>();
  for (const entities of Object.values(building.entities ?? {})) for (const e of entities) ids.add(String(e.id));
  for (const path of Object.values(building.sources ?? {})) {
    for (const match of (files[path] ?? "").matchAll(/\bid:\s*["']?([A-Za-z0-9_.-]+)/g)) ids.add(match[1]);
  }
  return ids;
}

/** The next free `<base>_NN`, above the highest number in use, so ids of removed elements are never reused. */
export function nextId(base: string, taken: Set<string>): string {
  const pattern = new RegExp(`^${base}_(\\d+)$`);
  let max = 0;
  for (const id of taken) max = Math.max(max, Number(pattern.exec(id)?.[1] ?? 0));
  return `${base}_${String(max + 1).padStart(2, "0")}`;
}

function unique(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

const upperId = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");

export function addConnection(
  building: Building,
  files: Files,
  input: { from: string; to: string; direction: string; transport_mode: string; minutes?: number },
): Change {
  if (input.from === input.to) throw new EditError(t("editor.sameEnds"));
  const [path, text] = source(building, files, "lanes.yaml");
  const id = unique(`${MODE_PREFIX[input.transport_mode] ?? "CON"}_${input.from}_TO_${input.to}`, takenIds(building, files));
  const item: Item = {
    id, from: input.from, to: input.to, direction: input.direction, transport_mode: input.transport_mode,
    expected_duration: input.minutes ? { value: input.minutes, unit: "min" } : undefined,
  };
  return { path, text: appendItem(text, "connections", item), summary: t("editor.added.connection", { id }) };
}

export function addDoor(
  building: Building,
  files: Files,
  input: { direction: string; staging_section: string; determination_group?: string },
): Change {
  const [path, text] = source(building, files, "storage.yaml");
  const id = nextId("DOOR", takenIds(building, files));
  const item: Item = { id, direction: input.direction, staging_section: input.staging_section, determination_group: input.determination_group || undefined };
  return { path, text: appendItem(text, "doors", item), summary: t("editor.added.door", { id }), select: id };
}

export function addWorkCenter(
  building: Building,
  files: Files,
  input: { step: string; storage_point_ref: boolean; description?: string },
): Change {
  const step = input.step.trim();
  if (!step) throw new EditError(t("editor.needStep"));
  const [path, text] = source(building, files, "storage.yaml");
  const id = nextId(`WC_${upperId(step)}`, takenIds(building, files));
  const item: Item = { id, step, storage_point_ref: input.storage_point_ref || undefined, description: input.description?.trim() || undefined };
  return { path, text: appendItem(text, "work_centers", item), summary: t("editor.added.work_center", { id }), select: id };
}

export function addReportingPoint(
  building: Building,
  files: Files,
  input: { controller: string; type: string; capacity: number; storage_point_ref: boolean; description?: string },
): Change {
  if (!input.controller) throw new EditError(t("editor.noController"));
  const [path, text] = source(building, files, "wcs.yaml");
  const id = nextId("RP", takenIds(building, files));
  const item: Item = {
    id, storage_point_ref: input.storage_point_ref, controller: input.controller, type: input.type,
    capacity: input.capacity, description: input.description?.trim() || undefined,
  };
  return { path, text: appendItem(text, "reporting_points", item), summary: t("editor.added.reporting_point", { id }), select: id };
}

const names = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)]);

/** Where a node id is still referenced in the building's connections and movement rules. */
export function usages(building: Building, files: Files, id: string): string[] {
  const found: string[] = [];
  const lanesPath = building.sources?.["lanes.yaml"];
  if (lanesPath && files[lanesPath] !== undefined) {
    const lanes = readYaml(files[lanesPath]);
    for (const c of list(lanes.connections)) if (c.from === id || c.to === id) found.push(`${t("source.connection")} ${c.id}`);
    for (const s of list(lanes.conveyor_segments)) if (s.from === id || s.to === id) found.push(`${t("source.conveyor_segment")} ${s.id}`);
    for (const l of list(lanes.lanes)) if (names(l.connects).includes(id)) found.push(`${t("source.lane")} ${l.id}`);
    const main = lanes.conveyor_main as Record<string, unknown> | undefined;
    if (main && names(main.connects).includes(id)) found.push(`${t("source.conveyor_main")} (conveyor_main)`);
  }
  const rulesPath = building.sources?.["movement_rules.yaml"];
  if (rulesPath && files[rulesPath] !== undefined) {
    for (const rule of list(readYaml(files[rulesPath]).movement_rules)) {
      const ends = [rule.from, rule.to].flatMap((end) =>
        end && typeof end === "object" ? Object.values(end as Record<string, unknown>).flatMap(names) : [],
      );
      if (ends.includes(id)) found.push(`Bewegungsregel ${rule.id}`);
    }
  }
  return found;
}

/** Removes a door, work center or reporting point - only if nothing in the building still uses it. */
export function removeNode(building: Building, files: Files, kind: string, id: string): Change {
  const home = HOME[kind];
  if (!home || !["door", "work_center", "reporting_point"].includes(kind)) throw new EditError(t("editor.cannotDeleteNode"));
  const used = usages(building, files, id);
  if (used.length) throw new EditError(t("editor.stillUsed", { id, uses: used.join(", ") }));
  const [path, text] = source(building, files, home[0]);
  return { path, text: removeItem(text, home[1], id), summary: t("editor.deleted", { id }) };
}

/** Removes an explicit connection, a lane or a conveyor segment. */
export function removeLink(building: Building, files: Files, sourceType: string, id: string): Change {
  const home = HOME[sourceType];
  if (!home || home[0] !== "lanes.yaml") throw new EditError(t("editor.cannotDeleteLink"));
  const [path, text] = source(building, files, home[0]);
  return { path, text: removeItem(text, home[1], id), summary: t("editor.deleted", { id }) };
}

/** `<storage type>.<section>` of every section in storage.yaml, for a door's staging_section. */
export function sections(building: Building, files: Files): string[] {
  const path = building.sources?.["storage.yaml"];
  if (!path || files[path] === undefined) return [];
  return list(readYaml(files[path]).storage_types).flatMap((st) => list(st.sections).map((sec) => `${st.id}.${sec.id}`));
}
