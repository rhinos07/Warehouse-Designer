import dagre from "@dagrejs/dagre";
import type { Building, Entity } from "./types";

export type NodeKind = "storage_type" | "door" | "work_center" | "reporting_point" | "storage_point";

export const KIND_LABEL: Record<NodeKind, string> = {
  storage_type: "Lagertyp",
  door: "Tor",
  work_center: "Arbeitsplatz",
  reporting_point: "Meldepunkt",
  storage_point: "Lagerplatz",
};

export const MODE_LABEL: Record<string, string> = {
  conveyor: "Förderer",
  lane: "Fahrweg",
  forklift: "Stapler",
  walking: "zu Fuß",
  controller_internal: "intern",
};

// A work center or reporting point with storage_point_ref compiles to a
// storage point of the same id too; show it as what it is.
const PRIORITY: NodeKind[] = ["work_center", "reporting_point", "door", "storage_type", "storage_point"];

export interface TopoNode {
  id: string;
  kind: NodeKind;
  entity?: Entity;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TopoEdge {
  id: string;
  source: string;
  target: string;
  both: boolean; // traversable in both directions
  kind: "can" | "rule";
  label: string;
  mode?: string; // can: transport mode
  allowed?: boolean; // rule: allowed or forbidden
  entityId: string; // can: lane/connection/... id; rule: movement_rule id
}

export interface Graph {
  nodes: TopoNode[];
  can: TopoEdge[];
  rules: TopoEdge[];
  /** Movement rules with no drawable endpoint pair (wildcards, areas, sections). */
  unplaced: Entity[];
}

const size = (kind: NodeKind) =>
  kind === "reporting_point" || kind === "storage_point" ? { width: 130, height: 44 } : { width: 190, height: 58 };

function subtitle(kind: NodeKind, e: Entity | undefined, points: number | undefined): string {
  if (!e) return KIND_LABEL[kind];
  const parts: unknown[] = [];
  if (kind === "storage_type") parts.push(e.technology, points ? `${points} ${points === 1 ? "Platz" : "Plätze"}` : undefined);
  if (kind === "door") parts.push(e.direction === "inbound" ? "Eingang" : e.direction === "outbound" ? "Ausgang" : e.direction);
  if (kind === "work_center") parts.push(e.step);
  if (kind === "reporting_point") parts.push(e.type);
  return [KIND_LABEL[kind], ...parts.filter(Boolean)].join(" · ");
}

const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)]);

/** Node ids a movement-rule endpoint names, most specific first; [] if it names none (wildcard, area, section only). */
function endpointNodes(endpoint: unknown, known: Map<string, NodeKind>): string[] {
  if (!endpoint || typeof endpoint !== "object") return [];
  const sel = endpoint as Record<string, unknown>;
  for (const key of ["work_center", "reporting_point", "door", "storage_type"]) {
    const ids = asList(sel[key]).filter((id) => id !== "*" && known.has(id));
    if (ids.length) return ids;
  }
  return [];
}

export function buildGraph(building: Building): Graph {
  const entities = building.entities ?? {};
  const byId = new Map<string, { kind: NodeKind; entity: Entity }>();
  for (const kind of [...PRIORITY].reverse()) {
    for (const entity of entities[kind] ?? []) byId.set(entity.id, { kind, entity }); // higher priority overwrites
  }
  const canEdges = entities.can_edge ?? [];
  // Every storage type, door, work center and reporting point, plus other storage points the connections use.
  const ids = new Set([...byId.keys()]);
  for (const edge of canEdges) for (const end of [edge.from, edge.to]) ids.add(String(end));
  const kinds = new Map<string, NodeKind>();
  for (const id of ids) kinds.set(id, byId.get(id)?.kind ?? "storage_point");

  const can: TopoEdge[] = [];
  const pairs = new Map<string, TopoEdge>();
  for (const edge of canEdges) {
    const [from, to] = [String(edge.from), String(edge.to)];
    const source = String(edge.source_id ?? edge.id);
    const reverse = pairs.get(`${source}|${to}|${from}`);
    if (reverse) {
      reverse.both = true;
      continue;
    }
    const mode = String(edge.transport_mode ?? "");
    const item: TopoEdge = {
      id: `can:${source}:${from}:${to}`, source: from, target: to, both: false, kind: "can",
      label: MODE_LABEL[mode] ?? mode, mode, entityId: source,
    };
    pairs.set(`${source}|${from}|${to}`, item);
    can.push(item);
  }

  const rules: TopoEdge[] = [];
  const unplaced: Entity[] = [];
  for (const rule of entities.movement_rule ?? []) {
    const from = endpointNodes(rule.from, kinds);
    const to = endpointNodes(rule.to, kinds);
    if (!from.length || !to.length) {
      unplaced.push(rule);
      continue;
    }
    for (const f of from) {
      for (const t of to) {
        if (f === t) continue;
        rules.push({
          id: `rule:${rule.id}:${f}:${t}`, source: f, target: t, both: false, kind: "rule",
          label: rule.id, allowed: rule.allowed !== false, entityId: rule.id,
        });
      }
    }
  }

  // Layout from the physical connections only, so showing rules does not move nodes.
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const [id, kind] of kinds) g.setNode(id, size(kind));
  for (const edge of can) g.setEdge(edge.source, edge.target);
  dagre.layout(g);

  const nodes = [...kinds].map(([id, kind]) => {
    const { x, y, width, height } = g.node(id);
    const entity = byId.get(id)?.entity;
    return {
      id, kind, entity, width, height, x: x - width / 2, y: y - height / 2,
      subtitle: subtitle(kind, entity, building.point_counts?.[id]),
    };
  });
  return { nodes, can, rules, unplaced };
}

/** Lines of the checks' findings that name this id as a whole token. */
export function findingsFor(id: string, findings: string[]): string[] {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\w.-])${escaped}($|[^\\w.-])`);
  return findings.filter((f) => pattern.test(f));
}
