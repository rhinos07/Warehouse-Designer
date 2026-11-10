// Topology edits on a building's source files. Each edit returns the changed
// file; the page then recompiles and revalidates with the repo's own tools.
import { t } from "./i18n";
import type { Building } from "./types";
import type { FloorPlan } from "./floorplan";
import { appendItem, EditError, getItem, getTop, readYaml, removeItem, updateItem, updateTop, type Item, type Value } from "./yamlEdit";

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

// Layout edits (Topology-as-Code: warehouse.layout, storage_type.footprint,
// position on doors, work centers and reporting points). Values are metres,
// snapped to GRID_M.
export const GRID_M = 0.5;
const PLAN_PX_PER_M = 26; // floorplan.ts PX_PER_M
export const snap = (m: number) => Math.max(0, Math.round(m / GRID_M) * GRID_M);
const snapUp = (m: number) => Math.max(GRID_M, Math.ceil(m / GRID_M - 1e-9) * GRID_M);
const m = (value: number): Value => ({ value, unit: "m" });

export interface Box {
  x: number;
  y: number;
  width: number;
  depth: number;
}

/** Layout values must be numbers: a NaN written to YAML breaks the compile step. */
function finite(...values: number[]) {
  if (!values.every(Number.isFinite)) throw new EditError(t("editor.badPlace"));
}

function withFootprint(text: string, id: string, box: Box): string {
  finite(box.x, box.y, box.width, box.depth);
  const item = getItem(text, "storage_types", id);
  return updateItem(text, "storage_types", id, {
    ...item,
    footprint: { position: { x: m(snap(box.x)), y: m(snap(box.y)) }, width: m(snapUp(box.width)), depth: m(snapUp(box.depth)) },
  });
}

function withPosition(text: string, key: string, id: string, at: { x: number; y: number }): string {
  finite(at.x, at.y);
  const item = getItem(text, key, id);
  const old = (item.position ?? {}) as Record<string, Value>;
  // Keep a stated height (z).
  return updateItem(text, key, id, { ...item, position: { ...old, x: m(snap(at.x)), y: m(snap(at.y)) } });
}

function withLayout(text: string, size: { width: number; depth: number }): string {
  finite(size.width, size.depth);
  return updateTop(text, "warehouse", { ...getTop(text, "warehouse"), layout: { width: m(snapUp(size.width)), depth: m(snapUp(size.depth)) } });
}

/** Sets the floor area a storage type occupies. */
export function placeStorageType(building: Building, files: Files, id: string, box: Box): Change {
  const [path, text] = source(building, files, "storage.yaml");
  return { path, text: withFootprint(text, id, box), summary: t("editor.placed", { id }), select: id };
}

/** Sets where a door, work center or reporting point stands (its center). */
export function placeSpot(building: Building, files: Files, kind: string, id: string, at: { x: number; y: number }): Change {
  const home = HOME[kind];
  if (!home || !["door", "work_center", "reporting_point"].includes(kind)) throw new EditError(t("editor.cannotPlace"));
  const [path, text] = source(building, files, home[0]);
  return { path, text: withPosition(text, home[1], id, at), summary: t("editor.placed", { id }), select: id };
}

/** Sets the hall's floor area in warehouse.yaml. */
export function setLayout(building: Building, files: Files, size: { width: number; depth: number }): Change {
  const text = files[building.path];
  if (text === undefined) throw new EditError(t("editor.noImport", { file: "warehouse.yaml" }));
  if (!(size.width > 0) || !(size.depth > 0)) throw new EditError(t("editor.needSize"));
  return { path: building.path, text: withLayout(text, size), summary: t("editor.layoutSet", { width: snapUp(size.width), depth: snapUp(size.depth) }) };
}

/**
 * Writes the plan as drawn into the files: the hall's size, a footprint for
 * every storage type and a position for every door, work center and reporting
 * point that has none yet. One change per file, to be applied together.
 */
export function adoptPlan(building: Building, files: Files, plan: FloorPlan): Change[] {
  const toM = (px: number) => px / PLAN_PX_PER_M;
  const texts = new Map<string, string>();
  const edit = (name: string, change: (text: string) => string) => {
    const [path, original] = name === "warehouse.yaml" ? [building.path, files[building.path]] : source(building, files, name);
    if (original === undefined) throw new EditError(t("editor.noImport", { file: name }));
    texts.set(path, change(texts.get(path) ?? original));
  };
  const open = [...plan.blocks, ...plan.spots].filter((e) => !e.placed);
  // Waiting elements are taken where they wait, so the hall has to reach them.
  const reach = (side: "x" | "y") =>
    Math.max(side === "x" ? plan.hall.width : plan.hall.height, ...open.map((e) => (side === "x" ? e.x + e.width : e.y + e.height)));
  const hall = { width: snapUp(toM(reach("x")) + (open.length && plan.real ? 1 : 0)), depth: snapUp(toM(reach("y"))) };
  if (!plan.layout || hall.width > plan.layout.width || hall.depth > plan.layout.depth) {
    edit("warehouse.yaml", (text) => withLayout(text, { width: Math.max(hall.width, plan.layout?.width ?? 0), depth: Math.max(hall.depth, plan.layout?.depth ?? 0) }));
  }
  for (const b of plan.blocks) {
    if (!b.placed) edit("storage.yaml", (text) => withFootprint(text, b.id, { x: toM(b.x), y: toM(b.y), width: toM(b.width), depth: toM(b.height) }));
  }
  for (const s of plan.spots) {
    if (s.placed) continue;
    const at = { x: Math.min(toM(s.x + s.width / 2), hall.width), y: Math.min(toM(s.y + s.height / 2), hall.depth) };
    edit(HOME[s.kind][0], (text) => withPosition(text, HOME[s.kind][1], s.id, at));
  }
  return [...texts].map(([path, text], i) => ({ path, text, summary: i ? "" : t("editor.adopted", { n: open.length }) }));
}
