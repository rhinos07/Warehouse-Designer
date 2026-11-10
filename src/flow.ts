// Material flow, stage 1: which load-unit moves a hall allows.
// A move goes from a start node to a target node (e.g. an inbound door to a
// storage type). It is possible when two things hold:
// - physically ("kann"): a path of physical connections leads from start to
//   target; the quickest one is taken;
// - by the rules ("darf"): the movement rules allow the move from start to
//   target. Rules are checked for the move as a whole, not for every node it
//   passes on its way.
//
// How the rules are read (a simplification of Topology-as-Code's intent):
// - a matching rule with allowed: false forbids the move;
// - a storage type with movement_policy explicit_only needs an allowed rule
//   that names it explicitly on its side of the move (no "*", no missing side);
// - everything else is allowed (default_allow).
// Sections and activity areas narrow a rule to part of a storage type; the
// simulation works per storage type, so they are kept as a note only.
import type { Building, Entity } from "./types";

export type FlowKind = "storage_type" | "door" | "work_center" | "reporting_point" | "storage_point";

export interface FlowNode {
  id: string;
  kind: FlowKind;
  entity?: Entity;
}

/** One direction of one physical connection. */
export interface Link {
  id: string; // the compiled can_edge id
  from: string;
  to: string;
  mode: string;
  /** Who owns the capacity: the lane, conveyor or connection id. */
  resource: string;
  sourceType: string;
  seconds: number;
  /** True when seconds is the transport mode's default, not a value from the data. */
  assumed: boolean;
  /** Load units on it at the same time (conveyor segments). */
  capacity?: number;
  /** Load units per hour that may enter it (main conveyor), shared by all its links. */
  perHour?: number;
}

/** Travel time per transport mode where a connection states none, in seconds. Assumptions, not data. */
export const DEFAULT_SECONDS: Record<string, number> = {
  conveyor: 30,
  lane: 90,
  forklift: 120,
  tugger: 180,
  amr: 90,
  walking: 60,
  controller_internal: 20,
};
const FALLBACK_SECONDS = 60;

export interface FlowModel {
  nodes: Map<string, FlowNode>;
  links: Link[];
  out: Map<string, Link[]>;
  rules: Entity[];
}

const UNIT_SECONDS: Record<string, number> = { s: 1, sec: 1, min: 60, h: 3600 };

/** A duration like {value: 4, unit: "min"} in seconds; undefined if it is not one. */
export function seconds(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { value: v, unit } = value as { value?: unknown; unit?: unknown };
  const factor = UNIT_SECONDS[String(unit ?? "s")];
  return typeof v === "number" && v >= 0 && factor ? v * factor : undefined;
}

const PRIORITY: FlowKind[] = ["work_center", "reporting_point", "door", "storage_type"];

export function flowModel(building: Building): FlowModel {
  const entities = building.entities ?? {};
  const nodes = new Map<string, FlowNode>();
  for (const kind of [...PRIORITY].reverse()) {
    for (const entity of entities[kind] ?? []) nodes.set(entity.id, { id: entity.id, kind, entity });
  }
  const links: Link[] = [];
  for (const edge of entities.can_edge ?? []) {
    const [from, to] = [String(edge.from), String(edge.to)];
    for (const end of [from, to]) if (!nodes.has(end)) nodes.set(end, { id: end, kind: "storage_point" });
    const mode = String(edge.transport_mode ?? "");
    const stated = seconds(edge.expected_duration);
    links.push({
      id: edge.id,
      from,
      to,
      mode,
      resource: String(edge.source_id ?? edge.id),
      sourceType: String(edge.source_type ?? ""),
      seconds: stated ?? DEFAULT_SECONDS[mode] ?? FALLBACK_SECONDS,
      assumed: stated === undefined,
      capacity: typeof edge.capacity === "number" && edge.capacity > 0 ? edge.capacity : undefined,
      perHour: typeof edge.capacity_units_per_hour === "number" && edge.capacity_units_per_hour > 0 ? edge.capacity_units_per_hour : undefined,
    });
  }
  const out = new Map<string, Link[]>();
  for (const link of links) out.set(link.from, [...(out.get(link.from) ?? []), link]);
  return { nodes, links, out, rules: entities.movement_rule ?? [] };
}

/** The quickest path of physical connections from start to target; null if there is none. */
export function shortestPath(model: FlowModel, start: string, target: string): Link[] | null {
  if (start === target) return [];
  const dist = new Map<string, number>([[start, 0]]);
  const via = new Map<string, Link>();
  const open = new Set([start]);
  const done = new Set<string>();
  while (open.size) {
    // Small graphs: a linear scan is enough. Ties go to the smaller id, so the result is stable.
    let current = "";
    for (const id of open) {
      if (!current || dist.get(id)! < dist.get(current)! || (dist.get(id) === dist.get(current) && id < current)) current = id;
    }
    open.delete(current);
    done.add(current);
    if (current === target) break;
    for (const link of model.out.get(current) ?? []) {
      if (done.has(link.to)) continue;
      const d = dist.get(current)! + link.seconds;
      if (d < (dist.get(link.to) ?? Infinity)) {
        dist.set(link.to, d);
        via.set(link.to, link);
        open.add(link.to);
      }
    }
  }
  if (!via.has(target)) return null;
  const path: Link[] = [];
  for (let id = target; id !== start; id = via.get(id)!.from) path.unshift(via.get(id)!);
  return path;
}

const SELECTOR_KINDS: FlowKind[] = ["storage_type", "work_center", "reporting_point", "door"];
const NARROWING = ["section", "activity_area"];
const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)]);

/** How a rule's endpoint selector applies to a node: not at all, through "*" or a missing side, or by naming it. */
function matchSide(selector: unknown, node: FlowNode): "no" | "any" | "named" {
  if (selector == null) return "any";
  if (typeof selector !== "object") return "no";
  const sel = selector as Record<string, unknown>;
  const keys = SELECTOR_KINDS.filter((k) => k in sel);
  if (!keys.length) return NARROWING.some((k) => k in sel) ? "no" : "any";
  for (const key of keys) {
    if (key !== node.kind) continue;
    const ids = asList(sel[key]);
    if (ids.includes(node.id)) return "named";
    if (ids.includes("*")) return "any";
  }
  return "no";
}

const excluded = (selector: unknown, node: FlowNode) => selector != null && matchSide(selector, node) !== "no";

export interface Verdict {
  allowed: boolean;
  /** The deciding rule, if a rule decided. */
  rule?: string;
  /** Why: forbidden, explicit_missing, explicit_rule, allowed_rule, default. */
  reason: "forbidden" | "explicit_missing" | "explicit_rule" | "allowed_rule" | "default";
  /** The deciding rule names a section or activity area: it holds only for part of the storage type. */
  partial?: string;
}

const isExplicit = (node: FlowNode) => node.kind === "storage_type" && node.entity?.movement_policy === "explicit_only";

function narrowing(rule: Entity): string | undefined {
  const parts: string[] = [];
  for (const side of [rule.from, rule.to]) {
    if (!side || typeof side !== "object") continue;
    for (const key of NARROWING) {
      const value = (side as Record<string, unknown>)[key];
      if (value != null) parts.push(`${key} ${asList(value).join(", ")}`);
    }
  }
  return parts.length ? parts.join("; ") : undefined;
}

/** Do the movement rules allow a move from start to target? */
export function verdict(model: FlowModel, start: string, target: string): Verdict {
  const from = model.nodes.get(start) ?? { id: start, kind: "storage_point" as const };
  const to = model.nodes.get(target) ?? { id: target, kind: "storage_point" as const };
  const matching = model.rules
    .map((rule) => ({ rule, from: matchSide(rule.from, from), to: matchSide(rule.to, to) }))
    .filter((m) => m.from !== "no" && m.to !== "no" && !excluded(m.rule.exclude_to, to) && !excluded(m.rule.exclude_from, from));
  const forbidding = matching.find((m) => m.rule.allowed === false);
  if (forbidding) return { allowed: false, rule: forbidding.rule.id, reason: "forbidden", partial: narrowing(forbidding.rule) };
  const allowing = matching.filter((m) => m.rule.allowed !== false);
  if (isExplicit(from) || isExplicit(to)) {
    const explicit = allowing.find((m) => (!isExplicit(from) || m.from === "named") && (!isExplicit(to) || m.to === "named"));
    return explicit
      ? { allowed: true, rule: explicit.rule.id, reason: "explicit_rule", partial: narrowing(explicit.rule) }
      : { allowed: false, reason: "explicit_missing" };
  }
  const named = allowing.find((m) => m.from === "named" || m.to === "named") ?? allowing[0];
  return named
    ? { allowed: true, rule: named.rule.id, reason: "allowed_rule", partial: narrowing(named.rule) }
    : { allowed: true, reason: "default" };
}

export interface Move {
  from: string;
  to: string;
  path: Link[] | null;
  seconds: number;
  verdict: Verdict;
}

export function move(model: FlowModel, from: string, to: string): Move {
  const path = shortestPath(model, from, to);
  return { from, to, path, seconds: path ? path.reduce((s, l) => s + l.seconds, 0) : 0, verdict: verdict(model, from, to) };
}

const doorsOf = (model: FlowModel, directions: string[]) =>
  [...model.nodes.values()].filter((n) => n.kind === "door" && directions.includes(String(n.entity?.direction ?? "")));
export const inboundDoors = (model: FlowModel) => doorsOf(model, ["inbound", "returns"]);
export const outboundDoors = (model: FlowModel) => doorsOf(model, ["outbound"]);
export const storageTypes = (model: FlowModel) => [...model.nodes.values()].filter((n) => n.kind === "storage_type");
export const workCenters = (model: FlowModel) => [...model.nodes.values()].filter((n) => n.kind === "work_center");

export interface Reachability {
  inbound: Move[];
  outbound: Move[];
  /** Storage types without any physical connection. */
  unconnected: string[];
  /** Doors whose staging_section names a storage type no physical connection leads to from the door. */
  staging: { door: string; section: string; storageType: string }[];
}

/** Stage 1: every inbound door to every storage type, every storage type to every outbound door. */
export function reachability(model: FlowModel): Reachability {
  const types = storageTypes(model);
  const inbound = inboundDoors(model).flatMap((door) => types.map((st) => move(model, door.id, st.id)));
  const outbound = types.flatMap((st) => outboundDoors(model).map((door) => move(model, st.id, door.id)));
  const linked = new Set(model.links.flatMap((l) => [l.from, l.to]));
  const unconnected = types.filter((st) => !linked.has(st.id)).map((st) => st.id);
  const staging: Reachability["staging"] = [];
  for (const door of doorsOf(model, ["inbound", "outbound", "returns"])) {
    const section = door.entity?.staging_section;
    if (typeof section !== "string") continue;
    const storageType = section.split(".")[0];
    if (!model.nodes.has(storageType)) continue;
    const there = door.entity?.direction === "outbound" ? shortestPath(model, storageType, door.id) : shortestPath(model, door.id, storageType);
    if (!there) staging.push({ door: door.id, section, storageType });
  }
  return { inbound, outbound, unconnected, staging };
}
