// AutomationML (CAEX) import: a plant planner's file, or this page's own
// export, as the skeleton of a new Topology building. A prototype.
//
// Every InternalElement gets a proposed kind from its role: this project's
// roles (WarehouseAsCodeRoleClassLib, as the export writes them) map one to
// one; standard roles map where the crosswalk says they fit (Storage →
// storage type, StorageUnit → storage point, Gate → door, Conveyor/Transport
// → connection, Site/Area → facility/building). Everything else is proposed
// as "ignore"; the page lets the user change any proposal.
//
// Attributes become YAML fields where the Topology schema of that list has a
// field of that name; the rest is dropped and reported. Required fields the
// file does not give are filled with defaults and reported, so the user can
// check them - the repo's validate.py runs on the result right away.
import { stringify } from "yaml";
import { ROLE_LIB, SUC_LIB } from "./automationml";
import { emptyValue, resolve, schemaAt, type Schema } from "./schema";
import type { Catalog } from "./types";
import { childNamed, childrenNamed, parseXml, type XmlElement } from "./xml";

const TOPOLOGY = "Topology-as-Code";

export type Kind =
  | "storage_type" | "section" | "storage_point" | "door" | "work_center" | "reporting_point"
  | "controller" | "equipment" | "connection" | "activity_area"
  | "company" | "facility" | "building" | "ignore";

/** Kinds the user can choose for an element, in menu order. */
export const CHOOSABLE: Kind[] = [
  "storage_type", "section", "storage_point", "door", "work_center", "reporting_point",
  "controller", "equipment", "connection", "activity_area", "ignore",
];

const OWN_ROLES: Record<string, Kind> = {
  Company: "company", Facility: "facility", Building: "building", StorageType: "storage_type", Section: "section",
  StoragePoint: "storage_point", Door: "door", WorkCenter: "work_center", ReportingPoint: "reporting_point",
  Controller: "controller", Equipment: "equipment", Connection: "connection", ActivityArea: "activity_area",
};
// Standard roles where Warehouse-as-Code's crosswalk rates the fit good or partial.
// WorkCenter is left out on purpose: in the extended library it is a level of the hierarchy (false friend).
const STANDARD_ROLES: Record<string, Kind> = {
  Enterprise: "company", Site: "facility", Area: "building", Storage: "storage_type", StorageUnit: "storage_point",
  Gate: "door", Conveyor: "connection", Transport: "connection",
};

export function proposeKind(rolePath: string): Kind {
  const name = rolePath.split("/").pop() ?? "";
  if (rolePath.startsWith(`${ROLE_LIB}/`)) return OWN_ROLES[name] ?? "ignore";
  return STANDARD_ROLES[name] ?? "ignore";
}

export interface AmlPort {
  name: string;
  id?: string;
  direction?: string; // In, Out, InOut
}

export interface AmlElement {
  id: string; // the CAEX ID, or a made-up one if the file has none
  name: string;
  role: string; // RefBaseRoleClassPath, or the role its system unit class supports
  suc?: string; // RefBaseSystemUnitPath to a class
  mirrorOf?: string; // the master's id, for a mirror object
  parent?: string;
  depth: number;
  attrs: Record<string, unknown>;
  ports: AmlPort[];
  proposed: Kind;
}

export interface AmlModel {
  elements: AmlElement[];
  links: { a: [owner: string, port: string]; b: [owner: string, port: string] }[];
}

// ---------------------------------------------------------------- reading

const isList = (a: XmlElement) => /ListType$/.test(a.attrs.RefAttributeType ?? "");

/** A CAEX attribute as a YAML value: typed scalar, {value, unit}, map or list. */
export function attributeValue(a: XmlElement): unknown {
  const children = childrenNamed(a, "Attribute");
  const raw = childNamed(a, "Value")?.text;
  if (isList(a)) {
    return children.map((c) => {
      const v = attributeValue(c);
      // The export names list entries that are maps by their id.
      const name = c.attrs.Name ?? "";
      return v && typeof v === "object" && !Array.isArray(v) && !("id" in v) && !/^\d+$/.test(name) ? { id: name, ...v } : v;
    });
  }
  if (raw === undefined) {
    if (!children.length) return undefined;
    return Object.fromEntries(children.map((c) => [c.attrs.Name, attributeValue(c)]).filter(([, v]) => v !== undefined));
  }
  const type = (a.attrs.AttributeDataType ?? "").replace(/^xsd?:/, "");
  if (type === "boolean") return raw === "true" || raw === "1";
  if (/^(int|integer|long|short|byte|unsigned\w*|nonNegativeInteger|positiveInteger)$/.test(type) && /^-?\d+$/.test(raw)) return Number(raw);
  if (/^(double|float|decimal)$/.test(type) && raw !== "" && !Number.isNaN(Number(raw))) {
    return a.attrs.Unit ? { value: Number(raw), unit: a.attrs.Unit } : Number(raw);
  }
  return raw;
}

const stripBraces = (s: string) => s.replace(/^\{|\}$/g, "");

/** The elements, ports and links of every instance hierarchy. */
export function readAml(text: string): AmlModel {
  const root = parseXml(text);
  // Roles a system unit class supports, for elements that only name their class.
  const classRoles = new Map<string, string>();
  const walkClasses = (e: XmlElement, path: string) => {
    for (const c of childrenNamed(e, "SystemUnitClass")) {
      const p = `${path}/${c.attrs.Name}`;
      const role = childNamed(c, "SupportedRoleClass")?.attrs.RefRoleClassPath;
      if (role) classRoles.set(p, role);
      walkClasses(c, p);
    }
  };
  for (const lib of childrenNamed(root, "SystemUnitClassLib")) walkClasses(lib, lib.attrs.Name);

  const elements: AmlElement[] = [];
  const links: AmlModel["links"] = [];
  const portOwner = new Map<string, [string, string]>(); // interface ID → [owner, port]
  const rawLinks: [string, string][] = [];
  let made = 0;
  const walk = (e: XmlElement, parent: string | undefined, depth: number) => {
    for (const ie of childrenNamed(e, "InternalElement")) {
      const id = stripBraces(ie.attrs.ID ?? `generated-${++made}`);
      const ref = ie.attrs.RefBaseSystemUnitPath ? stripBraces(ie.attrs.RefBaseSystemUnitPath) : undefined;
      const role = childNamed(ie, "RoleRequirements")?.attrs.RefBaseRoleClassPath ?? (ref ? classRoles.get(ref) : undefined) ?? "";
      const attrs: Record<string, unknown> = {};
      for (const a of childrenNamed(ie, "Attribute")) {
        const v = attributeValue(a);
        if (v !== undefined && a.attrs.Name) attrs[a.attrs.Name] = v;
      }
      const ports = childrenNamed(ie, "ExternalInterface").map((p) => {
        const direction = childrenNamed(p, "Attribute").find((a) => a.attrs.Name === "Direction");
        const port = { name: p.attrs.Name ?? "", id: p.attrs.ID ? stripBraces(p.attrs.ID) : undefined, direction: direction ? childNamed(direction, "Value")?.text : undefined };
        if (port.id) portOwner.set(port.id, [id, port.name]);
        return port;
      });
      // A system unit path names a class (Lib/Class); a bare id names a mirror's master.
      const isClass = ref?.includes("/");
      elements.push({
        id, name: ie.attrs.Name ?? id, role, suc: isClass ? ref : undefined, mirrorOf: ref && !isClass ? ref : undefined,
        parent, depth, attrs, ports, proposed: proposeKind(role),
      });
      for (const link of childrenNamed(ie, "InternalLink")) rawLinks.push([link.attrs.RefPartnerSideA ?? "", link.attrs.RefPartnerSideB ?? ""]);
      walk(ie, id, depth + 1);
    }
  };
  for (const hierarchy of childrenNamed(root, "InstanceHierarchy")) walk(hierarchy, undefined, 0);

  const side = (ref: string): [string, string] | undefined => {
    const cleaned = ref.replace(/[{}]/g, "");
    if (portOwner.has(cleaned)) return portOwner.get(cleaned);
    const colon = cleaned.indexOf(":");
    return colon > 0 ? [cleaned.slice(0, colon), cleaned.slice(colon + 1)] : undefined;
  };
  for (const [a, b] of rawLinks) {
    const [sa, sb] = [side(a), side(b)];
    if (sa && sb) links.push({ a: sa, b: sb });
  }
  return { elements, links };
}

// ---------------------------------------------------------------- writing

/** What the import did that the user should check, for the page to show. */
export type Note =
  | { code: "renamed"; from: string; to: string }
  | { code: "filled"; element: string; field: string; value: string }
  | { code: "dropped"; kind: Kind; fields: string[]; count: number }
  | { code: "noStorageType"; element: string }
  | { code: "unknownEnd"; element: string; end: string }
  | { code: "tooFewEnds"; element: string }
  | { code: "assumedMode"; element: string; mode: string }
  | { code: "directLink"; element: string }
  | { code: "ignored"; count: number }
  | { code: "addedPoint"; element: string };

export interface ImportTarget {
  customer: string;
  facilityPath: string; // e.g. customers/c/facilities/facility_f1/facility.yaml
  facility: string; // the facility's id or reference number, as target.facility
  building: string; // new building id, e.g. hall_2
}

export interface ImportResult {
  files: { path: string; text: string }[];
  notes: Note[];
  counts: Partial<Record<Kind, number>>;
  /** The new building's warehouse.yaml. */
  warehousePath: string;
}

/** Element kinds and where they go: file, list key and schema of one entry. */
const LISTS: Partial<Record<Kind, [file: "storage" | "wcs" | "lanes", key: string, schema: string]>> = {
  storage_type: ["storage", "storage_types", "schemas/storage-type.schema.json"],
  door: ["storage", "doors", "schemas/door.schema.json"],
  work_center: ["storage", "work_centers", "schemas/storage.schema.json#/properties/work_centers/items"],
  activity_area: ["storage", "activity_areas", "schemas/storage.schema.json#/properties/activity_areas/items"],
  controller: ["wcs", "controller_definitions", "schemas/wcs.schema.json#/properties/controller_definitions/items"],
  reporting_point: ["wcs", "reporting_points", "schemas/wcs.schema.json#/properties/reporting_points/items"],
  equipment: ["wcs", "equipment", "schemas/wcs.schema.json#/properties/equipment/items"],
};
const SECTION_SCHEMA = "schemas/storage-type.schema.json#/properties/sections/items";
const POINT_SCHEMA = "schemas/storage-type.schema.json#/properties/storage_points/items";
const CONNECTION_SCHEMA = "schemas/lanes.schema.json#/properties/connections/items";
const WAREHOUSE_SCHEMA = "schemas/warehouse.schema.json#/properties/warehouse";
const TRANSPORT_MODES = ["walking", "forklift", "tugger", "amr", "conveyor"];
/** Places a connection may join (Topology's validate.py: connection.from/to). */
const ENDPOINTS: Kind[] = ["storage_type", "door", "work_center", "reporting_point"];
/** Defaults that fit a skeleton better than a schema's first enum value. */
const DEFAULTS: Record<string, unknown> = { access_model: "block", mode: "wms_controlled", direction: "inbound" };

/** Lists whose ids the schemas restrict to upper case, digits and underscores. */
const UPPER_IDS: Kind[] = ["storage_type", "door", "work_center", "activity_area"];
const asId = (name: string) =>
  name
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "X";

export function toTopology(
  model: AmlModel,
  kinds: Record<string, Kind>,
  target: ImportTarget,
  facilityText: string,
  catalog: Catalog,
  sourceName = "an AutomationML file",
): ImportResult {
  const notes: Note[] = [];
  const counts: Partial<Record<Kind, number>> = {};
  const byId = new Map(model.elements.map((e) => [e.id, e]));
  const kindOf = (e: AmlElement): Kind => (e.mirrorOf ? "ignore" : (kinds[e.id] ?? e.proposed));
  const ancestor = (e: AmlElement, wanted: Kind): AmlElement | undefined => {
    for (let p = e.parent && byId.get(e.parent); p; p = p.parent ? byId.get(p.parent) : undefined) if (kindOf(p) === wanted) return p;
    return undefined;
  };

  // Schema-checked fields of one list entry.
  const located = new Map<string, Schema>();
  const schemaOf = (ref: string) => {
    if (!located.has(ref)) located.set(ref, resolve(catalog, schemaAt(catalog, TOPOLOGY, ref)).schema);
    return located.get(ref)!;
  };
  const dropped = new Map<Kind, { fields: Set<string>; count: number }>();
  const entry = (kind: Kind, ref: string, name: string, fields: Record<string, unknown>): Record<string, unknown> => {
    const schema = schemaOf(ref);
    const allowed = schema.properties ?? {};
    const out: Record<string, unknown> = {};
    const lost: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (key in allowed) out[key] = value;
      else lost.push(key);
    }
    if (lost.length) {
      const d = dropped.get(kind) ?? { fields: new Set<string>(), count: 0 };
      lost.forEach((f) => d.fields.add(f));
      d.count++;
      dropped.set(kind, d);
    }
    for (const key of schema.required ?? []) {
      if (key in out) continue;
      const at = schemaAt(catalog, TOPOLOGY, ref);
      out[key] = DEFAULTS[key] !== undefined && (!allowed[key]?.enum || allowed[key].enum.includes(DEFAULTS[key]))
        ? DEFAULTS[key]
        : emptyValue(catalog, { ...at, schema: resolve(catalog, { ...at, schema: allowed[key] ?? {} }).schema });
      notes.push({ code: "filled", element: name, field: key, value: JSON.stringify(out[key]) });
    }
    // Fields in the schema's order, as in the repos' files (id first).
    const order = Object.keys(allowed);
    return Object.fromEntries(Object.entries(out).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)));
  };

  // Ids: as-code ids where the name is not one already; unique per building.
  const ids = new Map<string, string>(); // element id → as-code id
  const used = new Set<string>();
  const idFor = (e: AmlElement, base = e.name) => {
    if (ids.has(e.id)) return ids.get(e.id)!;
    const valid = UPPER_IDS.includes(kindOf(e)) ? /^[A-Z0-9_]+$/ : /^[A-Za-z0-9_.-]+$/;
    let id = valid.test(base) ? base : asId(base);
    for (let n = 2; used.has(id); n++) id = `${id.replace(/_\d+$/, "")}_${n}`;
    if (id !== base) notes.push({ code: "renamed", from: e.name, to: id });
    used.add(id);
    ids.set(e.id, id);
    return id;
  };
  const bump = (kind: Kind) => (counts[kind] = (counts[kind] ?? 0) + 1);

  const storage: Record<string, Record<string, unknown>[]> = { storage_types: [], activity_areas: [], work_centers: [], doors: [] };
  const wcs: Record<string, Record<string, unknown>[]> = { controller_definitions: [], reporting_points: [], equipment: [] };
  const lanes: Record<string, unknown> = { connections: [], lanes: [], conveyor_segments: [] };
  const typeEntries = new Map<string, Record<string, unknown>>();
  const className = (suc?: string) => (suc?.startsWith(`${SUC_LIB}/`) || suc?.includes("/") ? suc.split("/").pop() : undefined);

  const elements = model.elements;
  let ignored = 0;
  // Storage types first: sections and points attach to them.
  for (const e of elements.filter((x) => kindOf(x) === "storage_type")) {
    const id = idFor(e);
    const item = entry("storage_type", LISTS.storage_type![2], id, { ...e.attrs, id });
    storage.storage_types.push(item);
    typeEntries.set(e.id, item);
    bump("storage_type");
  }
  const sectionIds = new Map<string, string>(); // element id → local section id
  for (const e of elements.filter((x) => kindOf(x) === "section")) {
    const type = ancestor(e, "storage_type");
    if (!type) {
      notes.push({ code: "noStorageType", element: e.name });
      continue;
    }
    const typeId = ids.get(type.id)!;
    const local = asId(e.name.startsWith(`${type.name}.`) ? e.name.slice(type.name.length + 1) : e.name);
    sectionIds.set(e.id, local);
    const item = typeEntries.get(type.id)!;
    ((item.sections ??= []) as unknown[]).push(entry("section", SECTION_SCHEMA, `${typeId}.${local}`, { ...e.attrs, id: local }));
    bump("section");
  }
  for (const e of elements.filter((x) => kindOf(x) === "storage_point")) {
    const type = ancestor(e, "storage_type");
    if (!type) {
      notes.push({ code: "noStorageType", element: e.name });
      continue;
    }
    const section = ancestor(e, "section");
    const coordinate = typeof e.attrs.coordinate === "string" ? e.attrs.coordinate
      : e.name.startsWith(`${type.name}.`) ? e.name.slice(type.name.length + 1) : e.name;
    const item = typeEntries.get(type.id)!;
    ((item.storage_points ??= []) as unknown[]).push(
      entry("storage_point", POINT_SCHEMA, `${ids.get(type.id)}.${coordinate}`, {
        ...e.attrs, coordinate, section: section ? sectionIds.get(section.id) : undefined,
        // Computed by compile.py from the storage type's routing, which the compiled data does not carry.
        route_aisle: undefined, route_position: undefined,
      }),
    );
    ids.set(e.id, ids.get(type.id)!); // a connection to a point joins its storage type
    bump("storage_point");
  }
  // A storage type needs storage points: one without any becomes one opaque place, like a grid.
  for (const [elementId, item] of typeEntries) {
    if (item.storage_points || item.storage_point_generator || item.layout_variants) continue;
    item.storage_points = [{ coordinate: ids.get(elementId) }];
    notes.push({ code: "addedPoint", element: String(item.id) });
  }
  for (const e of elements) {
    const kind = kindOf(e);
    if (kind === "ignore") {
      if (!e.mirrorOf) ignored++;
      continue;
    }
    if (kind === "door" || kind === "work_center" || kind === "controller" || kind === "reporting_point" || kind === "equipment") {
      const [file, key, ref] = LISTS[kind]!;
      const id = idFor(e);
      const extra: Record<string, unknown> = {};
      if (kind === "work_center" && className(e.suc)) extra.workstation_template = className(e.suc);
      if (kind === "equipment" && className(e.suc)) extra.type = className(e.suc);
      // A capacity the compiler took from the template stays with the template.
      if (kind === "work_center" && e.attrs.throughput_source === "template") {
        extra.throughput_capacity = undefined;
        extra.throughput_unit = undefined;
      }
      (file === "storage" ? storage : wcs)[key].push(entry(kind, ref, id, { ...e.attrs, ...extra, id }));
      bump(kind);
    }
  }
  // Activity areas: the masters of their mirror objects are the places they take bins from.
  for (const e of elements.filter((x) => kindOf(x) === "activity_area")) {
    const id = idFor(e);
    const bins = new Set<string>(Array.isArray(e.attrs.bins_from) ? e.attrs.bins_from.map(String) : []);
    for (const mirror of elements.filter((x) => x.parent === e.id && x.mirrorOf)) {
      const master = byId.get(mirror.mirrorOf!);
      if (!master) continue;
      if (kindOf(master) === "storage_type") bins.add(ids.get(master.id)!);
      const type = kindOf(master) === "section" ? ancestor(master, "storage_type") : undefined;
      if (type && sectionIds.has(master.id)) bins.add(`${ids.get(type.id)}.${sectionIds.get(master.id)}`);
    }
    storage.activity_areas.push(entry("activity_area", LISTS.activity_area![2], id, { ...e.attrs, id, bins_from: bins.size ? [...bins] : undefined }));
    bump("activity_area");
  }

  // Connections: elements of kind connection, with their ends from the links; links straight between places too.
  const endOf = (owner: string): string | undefined => {
    const e = byId.get(owner);
    if (!e) return undefined;
    const kind = kindOf(e);
    if (ENDPOINTS.includes(kind)) return ids.get(e.id);
    if (kind === "storage_point" || kind === "section") {
      const type = ancestor(e, "storage_type");
      return type ? ids.get(type.id) : undefined;
    }
    return undefined;
  };
  const connectionIds = new Set(elements.filter((x) => kindOf(x) === "connection").map((x) => x.id));
  for (const e of elements.filter((x) => kindOf(x) === "connection")) {
    // Derived by compile.py from a shared controller, not written in the files.
    if (e.attrs.source_type === "controller_internal") continue;
    const ends: { end: string; direction?: string }[] = [];
    for (const { a, b } of model.links) {
      for (const [mine, other] of [[a, b], [b, a]] as const) {
        if (mine[0] !== e.id) continue;
        const end = endOf(other[0]);
        if (!end) {
          notes.push({ code: "unknownEnd", element: e.name, end: byId.get(other[0])?.name ?? other[0] });
          continue;
        }
        if (!ends.some((x) => x.end === end)) ends.push({ end, direction: e.ports.find((p) => p.name === mine[1])?.direction });
      }
    }
    const id = idFor(e);
    if (ends.length < 2) {
      notes.push({ code: "tooFewEnds", element: e.name });
      continue;
    }
    const sourceType = String(e.attrs.source_type ?? "");
    const capacity = e.attrs.capacity;
    if (sourceType === "conveyor_main") {
      lanes.conveyor_main = { connects: ends.map((x) => x.end), capacity_units_per_hour: e.attrs.capacity_units_per_hour };
    } else if (sourceType === "conveyor_segment" && ends.length === 2) {
      const from = ends.find((x) => x.direction === "In") ?? ends[0];
      const to = ends.find((x) => x !== from)!;
      (lanes.conveyor_segments as unknown[]).push({ id, from: from.end, to: to.end, capacity });
    } else if (sourceType === "lane" || ends.length > 2) {
      (lanes.lanes as unknown[]).push({ id, template: className(e.suc), connects: ends.map((x) => x.end) });
    } else {
      let mode = typeof e.attrs.transport_mode === "string" && TRANSPORT_MODES.includes(e.attrs.transport_mode) ? e.attrs.transport_mode : undefined;
      if (!mode) {
        mode = /Conveyor$/.test(e.role) ? "conveyor" : "walking";
        notes.push({ code: "assumedMode", element: id, mode });
      }
      const from = ends.find((x) => x.direction === "In");
      const to = ends.find((x) => x.direction === "Out");
      const oneWay = from && to && from !== to;
      (lanes.connections as unknown[]).push(entry("connection", CONNECTION_SCHEMA, id, {
        id, from: (oneWay ? from : ends[0]).end, to: (oneWay ? to : ends[1]).end,
        direction: oneWay ? "one_way" : "bidirectional", transport_mode: mode,
        expected_duration: e.attrs.expected_duration, capacity,
      }));
    }
    bump("connection");
  }
  const joined = new Set<string>();
  for (const { a, b } of model.links) {
    if (connectionIds.has(a[0]) || connectionIds.has(b[0])) continue;
    const [from, to] = [endOf(a[0]), endOf(b[0])];
    if (!from || !to || from === to || joined.has([from, to].sort().join("|"))) continue;
    joined.add([from, to].sort().join("|"));
    const id = `${from}_TO_${to}`;
    used.add(id);
    (lanes.connections as unknown[]).push({ id, from, to, direction: "bidirectional", transport_mode: "walking" });
    notes.push({ code: "directLink", element: id });
    bump("connection");
  }
  // Clean the lane entries of empty fields.
  for (const key of ["lanes", "conveyor_segments"] as const) {
    lanes[key] = (lanes[key] as Record<string, unknown>[]).map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)));
  }
  if (lanes.conveyor_main) lanes.conveyor_main = Object.fromEntries(Object.entries(lanes.conveyor_main).filter(([, v]) => v !== undefined));
  for (const [kind, d] of dropped) notes.push({ code: "dropped", kind, fields: [...d.fields].sort(), count: d.count });
  if (ignored) notes.push({ code: "ignored", count: ignored });

  // Files.
  const facilityDir = target.facilityPath.replace(/\/[^/]*$/, "");
  const dir = `${facilityDir}/buildings/${target.building}`;
  const header = (what: string) =>
    `# ${what}, imported from ${sourceName} by the Warehouse Designer.\n` +
    "# Check it against the plant: the import report lists what was assumed or left out.\n";
  const compact = <T extends Record<string, unknown>>(o: T) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0))) as T;
  const yaml = (value: unknown) => stringify(value, { defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", lineWidth: 0 });
  const files: { path: string; text: string }[] = [];
  const imports: string[] = [];
  files.push({ path: `${dir}/structure/storage.yaml`, text: header("Storage structure") + "\n" + yaml({ storage_types: storage.storage_types, ...compact({ activity_areas: storage.activity_areas, work_centers: storage.work_centers, doors: storage.doors }) }) });
  imports.push("structure/storage.yaml");
  const wcsData = compact(wcs);
  if (Object.keys(wcsData).length) {
    files.push({ path: `${dir}/structure/wcs.yaml`, text: header("Controllers, reporting points and equipment") + "\n" + yaml(wcsData) });
    imports.push("structure/wcs.yaml");
  }
  const laneData = compact(lanes);
  if (Object.keys(laneData).length) {
    files.push({ path: `${dir}/structure/lanes.yaml`, text: header("Physical connections") + "\n" + yaml(laneData) });
    imports.push("structure/lanes.yaml");
  }
  const building = elements.find((e) => kindOf(e) === "building");
  const warehouse = entry("building", WAREHOUSE_SCHEMA, target.building, {
    ...building?.attrs,
    name: (building?.attrs.name as string | undefined) ?? building?.name ?? target.building,
    imports,
  });
  const warehousePath = `${dir}/warehouse.yaml`;
  files.unshift({
    path: warehousePath,
    text: header("Building") + "\n" + yaml({
      api_version: "topology-as-code/v1",
      metadata: { dataset_id: `${target.customer}/${target.facility}/${target.building}`.toLowerCase(), revision: "1" },
      target: { wms_type: "generic", tenant: target.customer, facility: target.facility, building: target.building },
      import_policy: { mode: "reconcile", removal_policy: "deactivate", unmanaged_objects: "preserve", require_plan_approval: true },
      warehouse,
    }),
  });
  files.push({ path: target.facilityPath, text: addBuilding(facilityText, `buildings/${target.building}/warehouse.yaml`) });
  return { files, notes, counts, warehousePath };
}

/** Adds a building path to facility.yaml's `buildings:` list, as a text splice that keeps the rest. */
export function addBuilding(text: string, path: string): string {
  const lines = text.split("\n");
  const head = lines.findIndex((l) => /^\s+buildings:\s*(#.*)?$/.test(l));
  if (head < 0) throw new Error("facility.yaml has no buildings list");
  let last = head;
  let indent = `${lines[head].match(/^\s*/)![0]}  `;
  for (let i = head + 1; i < lines.length; i++) {
    const m = /^(\s*)- /.exec(lines[i]);
    if (m) {
      last = i;
      indent = m[1];
    } else if (lines[i].trim() && !lines[i].trim().startsWith("#")) break;
  }
  lines.splice(last + 1, 0, `${indent}- "${path}"`);
  return lines.join("\n");
}
