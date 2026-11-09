// AutomationML (IEC 62714) export of one compiled Topology building: a CAEX 3.0
// file for plant engineering, layout and simulation tools. A prototype. The
// mapping follows Warehouse-as-Code's docs/standards-crosswalk.md; the role
// classes are this project's own, each derived from an AutomationML base role
// and naming the standard role it corresponds to, because the extended and DMI
// role class libraries could not be checked against the standard.
//
// Exported: company → facility → building → storage types → sections → storage
// points; doors, work centers, reporting points, controllers, equipment; every
// physical connection as an element with one port per end, linked to a port of
// each place; activity areas as groups of mirror objects; templates (equipment
// types, workstation and lane templates) as system unit classes. Not exported:
// movement rules - AutomationML has no place for rules - and the aisle, bay and
// shelf level inside a storage type. With `points: false` storage points are
// left out (a storage type then states how many it has), except those a
// connection ends at, so that every link still has both ends.
//
// Ids are derived from the building and the as-code id, not random: exporting
// the same data again gives the same file, so two exports can be compared.
import { STANDARD_LIBRARIES } from "./amlStandardLibs";
import type { Building, Catalog, Entity } from "./types";
import { readYaml } from "./yamlEdit";

export const ROLE_LIB = "WarehouseAsCodeRoleClassLib";
export const SUC_LIB = "WarehouseAsCodeSystemUnitClassLib";
const BASE = "AutomationMLBaseRoleClassLib/AutomationMLBaseRole";
const PORT = "AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Port";
const ORDERED_LIST = "AutomationMLBaseAttributeTypeLib/OrderedListType";
const PLACE_PORT = "Transport"; // the port of a place that its connections link to
// CAEX wants the libraries in a fixed order: interface classes, role classes,
// system unit classes, attribute types. The standard ones go around this project's.
const STANDARD_ATTRIBUTE_TYPES = STANDARD_LIBRARIES.slice(STANDARD_LIBRARIES.indexOf("  <AttributeTypeLib"));
const STANDARD_CLASSES = STANDARD_LIBRARIES.slice(0, STANDARD_LIBRARIES.indexOf("  <AttributeTypeLib"));

type Role =
  | "Company" | "Facility" | "Building" | "StorageType" | "Section" | "StoragePoint" | "Door"
  | "WorkCenter" | "ReportingPoint" | "Controller" | "Equipment" | "Connection" | "ActivityArea";

/** The project's role classes: base role, and what it corresponds to (from the crosswalk). */
export const ROLES: Record<Role, [string, string]> = {
  Company: [`${BASE}/Structure/ResourceStructure`, "A company (tenant). Corresponds to role Enterprise of the AutomationML extended role class library."],
  Facility: [`${BASE}/Structure/ResourceStructure`, "A facility (physical site). Corresponds to role Site of the extended role class library."],
  Building: [`${BASE}/Structure/ResourceStructure`, "One building or hall. Corresponds to role Area of the extended role class library."],
  StorageType: [`${BASE}/Resource`, "A kind of storage area with its technology and policy. Corresponds in part to role Storage of the DMI role class library."],
  Section: [`${BASE}/Structure/ResourceStructure`, "A subdivision of a storage type; its storage points are nested in it."],
  StoragePoint: [`${BASE}/Resource`, "A bookable place. Corresponds in part to role StorageUnit of the extended role class library."],
  Door: [`${BASE}/Resource`, "A goods receipt or dispatch door. The DMI library has a role Gate; whether it means the same was not checked."],
  WorkCenter: [`${BASE}/Resource`, "The operator or workstation side of a place. Not role WorkCenter of the extended library, which is a level of the hierarchy."],
  ReportingPoint: [`${BASE}/Resource`, "A point where the material flow controller reports a load unit."],
  Controller: [`${BASE}/Resource`, "A material flow or warehouse controller with its communication channels."],
  Equipment: [`${BASE}/Resource`, "A vehicle, shuttle or robot, with the points it serves."],
  Connection: [`${BASE}/Resource`, "A physical connection between places: lane, conveyor, forklift or walking path. Corresponds in part to role Transport of the DMI library."],
  ActivityArea: [`${BASE}/Group`, "A functional grouping across the physical hierarchy. Its members are mirror objects of storage types and sections."],
};

/** Template families: where a template id comes from, and the role its instances have. */
const FAMILIES = {
  EquipmentType: "Equipment",
  WorkstationTemplate: "WorkCenter",
  LaneTemplate: "Connection",
} as const satisfies Record<string, Role>;
type Family = keyof typeof FAMILIES;

// ---------------------------------------------------------------- XML

export interface XmlNode {
  tag: string;
  attrs?: Record<string, string | undefined>;
  children?: XmlNode[];
  text?: string;
  /** Already serialized XML, inserted as it is. */
  raw?: string;
}

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

function serialize(node: XmlNode, indent = ""): string {
  if (node.raw !== undefined) return node.raw;
  const attrs = Object.entries(node.attrs ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${escapeAttr(v!)}"`)
    .join("");
  const children = node.children ?? [];
  if (node.text !== undefined) return `${indent}<${node.tag}${attrs}>${escapeText(node.text)}</${node.tag}>\n`;
  if (!children.length) return `${indent}<${node.tag}${attrs} />\n`;
  return `${indent}<${node.tag}${attrs}>\n${children.map((c) => serialize(c, `${indent}  `)).join("")}${indent}</${node.tag}>\n`;
}

const text = (tag: string, value: string): XmlNode => ({ tag, text: value });

// ---------------------------------------------------------------- ids

/** 128 bits from a string (cyrb128, public domain); stable, not cryptographic. */
function hash128(input: string): number[] {
  let [h1, h2, h3, h4] = [1779033703, 3144134277, 1013904242, 2773480762];
  for (let i = 0; i < input.length; i++) {
    const k = input.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  return [h1, h2 ^ h1, h3 ^ h1, h4 ^ h1].map((h) => h >>> 0);
}

/** A UUID (version 8: custom, RFC 9562) derived from the parts: the same parts give the same id. */
export function stableId(...parts: string[]): string {
  const hex = hash128(parts.join("\u0000")).map((h) => h.toString(16).padStart(8, "0")).join("").split("");
  hex[12] = "8";
  hex[16] = "89ab"[parseInt(hex[16], 16) & 3];
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ---------------------------------------------------------------- attributes

const isMeasure = (v: Record<string, unknown>) =>
  Object.keys(v).length === 2 && typeof v.value === "number" && typeof v.unit === "string";

/** A YAML value as a CAEX attribute: typed scalars, measures with unit, nested maps, ordered lists. */
export function attribute(name: string, value: unknown): XmlNode | null {
  if (value === null || value === undefined) return null;
  const typed = (type: string, v: string, unit?: string): XmlNode => ({
    tag: "Attribute", attrs: { Name: name, Unit: unit, AttributeDataType: type }, children: [text("Value", v)],
  });
  if (typeof value === "boolean") return typed("xs:boolean", String(value));
  if (typeof value === "number") {
    if (!Number.isInteger(value)) return typed("xs:double", String(value));
    return typed(Math.abs(value) < 2 ** 31 ? "xs:int" : "xs:long", String(value));
  }
  if (typeof value === "string") return typed("xs:string", value);
  if (Array.isArray(value)) {
    const items = value.map((v, i) => attribute(v && typeof v === "object" && "id" in v ? String(v.id) : String(i + 1), v));
    return { tag: "Attribute", attrs: { Name: name, RefAttributeType: ORDERED_LIST }, children: items.filter((x): x is XmlNode => !!x) };
  }
  if (typeof value === "object") {
    const map = value as Record<string, unknown>;
    if (isMeasure(map)) return typed("xs:double", String(map.value), String(map.unit));
    const items = Object.entries(map).map(([k, v]) => attribute(k, v));
    return { tag: "Attribute", attrs: { Name: name }, children: items.filter((x): x is XmlNode => !!x) };
  }
  return typed("xs:string", String(value));
}

function attributes(entity: Record<string, unknown>, skip: string[] = []): XmlNode[] {
  return Object.entries(entity)
    .filter(([key]) => key !== "id" && !skip.includes(key))
    .map(([key, value]) => attribute(key, value))
    .filter((x): x is XmlNode => !!x);
}

// ---------------------------------------------------------------- elements

interface Element {
  name: string;
  id: string;
  role?: Role;
  suc?: string; // RefBaseSystemUnitPath: a template, or for a mirror the master's id
  description?: string;
  attrs: XmlNode[];
  ports: XmlNode[];
  children: Element[];
  links: XmlNode[];
}

function port(owner: string, name: string, direction: "In" | "Out" | "InOut"): XmlNode {
  return {
    tag: "ExternalInterface",
    attrs: { Name: name, ID: stableId(owner, "port", name), RefBaseClassPath: PORT },
    children: [{ tag: "Attribute", attrs: { Name: "Direction", AttributeDataType: "xs:string", RefAttributeType: "AutomationMLBaseAttributeTypeLib/Direction" }, children: [text("Value", direction)] }],
  };
}

function toXml(e: Element): XmlNode {
  // CAEX order: Description, Attribute, ExternalInterface, InternalElement, SupportedRoleClass, InternalLink, RoleRequirements.
  return {
    tag: "InternalElement",
    attrs: { Name: e.name, ID: e.id, RefBaseSystemUnitPath: e.suc },
    children: [
      ...(e.description ? [text("Description", e.description)] : []),
      ...e.attrs,
      ...e.ports,
      ...e.children.map(toXml),
      ...e.links,
      ...(e.role ? [{ tag: "RoleRequirements", attrs: { RefBaseRoleClassPath: `${ROLE_LIB}/${e.role}` } }] : []),
    ],
  };
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)]);

/** A template's entry in Topology's own catalogs (elements/*.yaml), for its attributes. */
function templateEntry(catalog: Catalog | undefined, id: string): Entity | undefined {
  for (const [path, source] of Object.entries(catalog?.["Topology-as-Code"] ?? {})) {
    if (!path.startsWith("elements/") || !path.endsWith(".yaml")) continue;
    for (const list of Object.values(readYaml(source))) {
      if (!Array.isArray(list)) continue;
      const hit = list.find((entry) => entry && typeof entry === "object" && entry.id === id);
      if (hit) return hit as Entity;
    }
  }
  return undefined;
}

export interface AmlExport {
  xml: string;
  fileName: string;
  /** What went in, for the page to show. */
  counts: { elements: number; points: number; connections: number; links: number; mirrors: number; templates: number };
  /** References that could not be exported, e.g. a connection to an unknown place. */
  skipped: string[];
}

export function toAutomationML(
  building: Building,
  options: {
    now?: string;
    version?: string;
    catalog?: Catalog;
    /** false: leave storage points out, except those a connection ends at. Default true. */
    points?: boolean;
  } = {},
): AmlExport {
  const entities = building.entities ?? {};
  const list = (kind: string) => entities[kind] ?? [];
  const scope = building.dataset ?? building.path;
  const make = (role: Role | undefined, kind: string, entity: { id: string } & Record<string, unknown>, skip: string[] = []): Element => ({
    name: entity.id, id: stableId(scope, kind, entity.id), role, attrs: attributes(entity, skip), ports: [], children: [], links: [],
  });
  const counts = { elements: 0, points: 0, connections: 0, links: 0, mirrors: 0, templates: 0 };
  const withPoints = options.points !== false;
  const connected = new Set(list("can_edge").flatMap((edge) => [String(edge.from), String(edge.to)]));
  const skipped: string[] = [];

  // Templates, by family; an element refers to one as its system unit class.
  const templates: Record<Family, Set<string>> = { EquipmentType: new Set(), WorkstationTemplate: new Set(), LaneTemplate: new Set() };
  const useTemplate = (family: Family, id: unknown) => {
    if (typeof id !== "string" || !id) return undefined;
    templates[family].add(id);
    return `${SUC_LIB}/${family}/${id}`;
  };

  const warehouse = list("warehouse")[0] ?? { id: building.building ?? "building" };
  const company: Element = { ...make("Company", "company", { id: building.customer ?? "company" }), attrs: [] };
  const facility: Element = { ...make("Facility", "facility", { id: building.facility ?? "facility" }), attrs: [] };
  const hall: Element = { ...make("Building", "building", warehouse), name: building.building ?? warehouse.id };
  company.children.push(facility);
  facility.children.push(hall);

  // Places: what a connection can end at, and what an activity area can name.
  const places = new Map<string, Element>();
  const add = (parent: Element, e: Element) => {
    parent.children.push(e);
    places.set(e.name, e);
    counts.elements++;
    return e;
  };

  for (const type of list("storage_type")) {
    const e = add(hall, make("StorageType", "storage_type", type));
    if (!withPoints) e.attrs.push(attribute("storage_point_count", building.point_counts?.[type.id] ?? 0)!);
  }
  for (const section of list("section")) {
    const parent = places.get(String(section.storage_type)) ?? hall;
    add(parent, make("Section", "section", section, ["storage_type", "local_id"]));
  }
  for (const point of building.points ?? []) {
    if (point.ref_kind) continue; // a work center or reporting point, exported as that
    if (!withPoints && !connected.has(point.id)) continue;
    const parent = places.get(String(point.section ?? "")) ?? places.get(String(point.storage_type ?? "")) ?? hall;
    add(parent, make("StoragePoint", "storage_point", point, ["storage_type", "section"]));
    counts.points++;
  }
  for (const door of list("door")) add(hall, make("Door", "door", door));
  for (const wc of list("work_center")) {
    const e = add(hall, make("WorkCenter", "work_center", wc, ["workstation_template"]));
    e.suc = useTemplate("WorkstationTemplate", wc.workstation_template);
  }
  for (const rp of list("reporting_point")) add(hall, make("ReportingPoint", "reporting_point", rp));
  for (const controller of list("controller")) add(hall, make("Controller", "controller", controller));
  for (const equipment of list("equipment")) {
    const e = add(hall, make("Equipment", "equipment", equipment, ["type"]));
    e.suc = useTemplate("EquipmentType", equipment.type);
  }

  // Connections: one element per lane, conveyor or connection, with one port per end.
  const sourceEntities = new Map<string, Entity>();
  for (const kind of ["lane", "conveyor_segment", "conveyor_main"]) for (const e of list(kind)) sourceEntities.set(`${kind}|${e.id}`, e);
  const groups = new Map<string, { type: string; id: string; edges: Entity[] }>();
  for (const edge of list("can_edge")) {
    const type = String(edge.source_type ?? "connection");
    const id = String(edge.source_id ?? edge.id);
    const key = `${type}|${id}`;
    if (!groups.has(key)) groups.set(key, { type, id, edges: [] });
    groups.get(key)!.edges.push(edge);
  }
  for (const { type, id, edges } of groups.values()) {
    const source = sourceEntities.get(`${type}|${id}`) ?? {};
    const first = edges[0];
    const e: Element = {
      ...make("Connection", `connection:${type}`, { id }),
      attrs: attributes({ source_type: type, transport_mode: first.transport_mode, expected_duration: first.expected_duration, ...source }, ["connects", "from", "to", "template"]),
    };
    e.suc = useTemplate("LaneTemplate", (source as Entity).template);
    const ends = new Map<string, { from: boolean; to: boolean }>();
    for (const edge of edges) {
      for (const [end, side] of [[String(edge.from), "from"], [String(edge.to), "to"]] as const) {
        const seen = ends.get(end) ?? { from: false, to: false };
        seen[side] = true;
        ends.set(end, seen);
      }
    }
    if (ends.size > 2) {
      // Which ends are joined is not clear from the ports alone.
      e.attrs.push(attribute("paths", edges.map((x) => `${x.from} -> ${x.to}`))!);
    }
    hall.children.push(e);
    counts.connections++;
    for (const [end, { from, to }] of ends) {
      const place = places.get(end);
      if (!place) {
        skipped.push(`${type} ${id}: ${end}`);
        continue;
      }
      // Seen from the connection: material comes in from a "from" end and goes out to a "to" end.
      e.ports.push(port(e.id, end, from && to ? "InOut" : from ? "In" : "Out"));
      if (!place.ports.length) place.ports.push(port(place.id, PLACE_PORT, "InOut"));
      hall.links.push({
        tag: "InternalLink",
        attrs: { Name: `${id}:${end}`, ID: stableId(scope, "link", type, id, end), RefPartnerSideA: `${place.id}:${PLACE_PORT}`, RefPartnerSideB: `${e.id}:${end}` },
      });
      counts.links++;
    }
  }

  // Activity areas: groups whose members are mirrors of the storage types and sections they take bins from.
  for (const area of list("activity_area")) {
    const e: Element = make("ActivityArea", "activity_area", area, ["bins_from"]);
    for (const target of asList(area.bins_from)) {
      const master = places.get(target);
      if (!master) {
        skipped.push(`activity_area ${area.id}: ${target}`);
        continue;
      }
      e.children.push({ name: target, id: stableId(scope, "mirror", area.id, target), suc: master.id, attrs: [], ports: [], children: [], links: [] });
      counts.mirrors++;
    }
    hall.children.push(e);
    counts.elements++;
  }

  hall.description =
    `Compiled from Topology-as-Code ${building.path} with its tools/compile.py. ` +
    "Movement rules are not exported: AutomationML has no place for rules. Not exported either: the aisle, bay and shelf level of storage types." +
    (withPoints ? "" : " Storage points are left out, except those a connection ends at; each storage type states its storage_point_count.");

  const roleLib: XmlNode = {
    tag: "RoleClassLib",
    attrs: { Name: ROLE_LIB },
    children: [
      text("Description", "Roles of Warehouse-as-Code's Topology, each derived from an AutomationML base role. The correspondence to the extended and DMI role class libraries follows Warehouse-as-Code's docs/standards-crosswalk.md and was not checked against IEC 62714."),
      text("Version", "0.1"),
      ...Object.entries(ROLES).map(([name, [base, description]]) => ({
        tag: "RoleClass", attrs: { Name: name, RefBaseClassPath: base }, children: [text("Description", description)],
      })),
    ],
  };
  const sucLib: XmlNode = {
    tag: "SystemUnitClassLib",
    attrs: { Name: SUC_LIB },
    children: [
      text("Description", "Templates of Topology-as-Code's catalogs that elements of this building use."),
      text("Version", "0.1"),
      ...(Object.keys(FAMILIES) as Family[]).filter((f) => templates[f].size).map((family) => ({
        tag: "SystemUnitClass",
        attrs: { Name: family },
        children: [...templates[family]].sort().map((id) => {
          counts.templates++;
          const entry = templateEntry(options.catalog, id);
          return {
            tag: "SystemUnitClass",
            attrs: { Name: id, ID: stableId("template", family, id) },
            children: [
              ...(entry ? attributes(entry) : []),
              { tag: "SupportedRoleClass", attrs: { RefRoleClassPath: `${ROLE_LIB}/${FAMILIES[family]}` } },
            ],
          };
        }),
      })),
    ],
  };

  const base = [building.customer, building.facility, building.building].filter(Boolean).join("_") || "building";
  const fileName = `${base}${withPoints ? "" : "_without_storage_points"}.aml`;
  const now = options.now ?? new Date().toISOString();
  const file: XmlNode = {
    tag: "CAEXFile",
    attrs: {
      SchemaVersion: "3.0",
      FileName: fileName,
      "xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
      xmlns: "http://www.dke.de/CAEX",
      "xsi:schemaLocation": "http://www.dke.de/CAEX CAEX_ClassModel_V.3.0.xsd",
    },
    children: [
      text("SuperiorStandardVersion", "AutomationML 2.10"),
      {
        tag: "SourceDocumentInformation",
        attrs: {
          OriginName: "Warehouse-Designer",
          OriginID: stableId("Warehouse-Designer"),
          OriginVersion: options.version ?? "0.1.0",
          LastWritingDateTime: now,
          OriginProjectID: scope,
          OriginProjectTitle: String(warehouse.name ?? hall.name),
          OriginVendorURL: "https://github.com/rhinos07/Warehouse-Designer",
        },
      },
      {
        tag: "InstanceHierarchy",
        attrs: { Name: "Topology", ID: stableId(scope, "instance_hierarchy") },
        children: [text("Version", "1"), toXml(company)],
      },
      { tag: "", raw: STANDARD_CLASSES },
      roleLib,
      sucLib,
      { tag: "", raw: STANDARD_ATTRIBUTE_TYPES },
    ],
  };
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n${serialize(file)}`;
  return { xml, fileName, counts, skipped };
}
