// The hall plan: a top view of a building, built from the compiled data alone.
// - Always from the data: each storage type's inner structure (rack rows, bays
//   and levels, channels, single places) and the size of its places.
// - The position of things in the hall, in one of two ways:
//   - real: the building states a layout (warehouse.layout, a storage type's
//     footprint, a position on doors, work centers and reporting points).
//     Elements with a place are drawn there; a storage type's inner structure
//     is spread over its footprint. Elements without a place wait beside the
//     hall.
//   - calculated: the building states none of this. The blocks are packed
//     into rows; their arrangement is not the real one.
// Screen coordinates: the building's reference point is the upper left
// corner, x runs to the right, y downwards.
import type { Graph } from "./graph";
import type { Building, Entity } from "./types";

/** Drawing scale. */
export const PX_PER_M = 26;
/** Smaller places are drawn at this size, so they stay visible and clickable. */
const MIN_PX = 14;
/** Footprint of a place whose data states no size, in metres. An assumption. */
export const ASSUMED_SIZE = { width: 1.2, depth: 0.8 };
/** Space between two rack rows of a storage type, in metres. An assumption: the data has no aisle width. */
const AISLE_M = 1.6;
const HEADER = 24;
const PAD = 10;
const GAP = 46;
// Half of each side is a multiple of the drawing's 0.5 m grid (13 px), so a
// spot centered on a grid point has its corner on the grid too and snaps cleanly.
const SPOT = { width: 156, height: 52 };

const UNIT_M: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001 };
/** A length like {value: 120, unit: "cm"} in metres; undefined if it is not one. */
export function metres(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { value: v, unit } = value as { value?: unknown; unit?: unknown };
  const factor = UNIT_M[String(unit)];
  return typeof v === "number" && v > 0 && factor ? v * factor : undefined;
}

export interface PlanCell {
  id: string;
  /** A rack bay (several levels and places) or a single place. */
  kind: "bay" | "point";
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  points: Entity[];
  /** Bay: its aisle and bay number, levels and places side by side. */
  aisle?: number;
  bay?: number;
  levels?: number;
  positions?: number;
  /** Places one behind the other (channel storage). */
  depth?: number;
  /** The places' storage_condition, if they all share one. */
  condition?: string;
  hazmat: boolean;
  blocked: number;
  /** The footprint is ASSUMED_SIZE: the places state no size. */
  assumed: boolean;
}

export interface PlanBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cells: PlanCell[];
  /** Labels of the rack rows, at their y position. */
  rows: { aisle: number; y: number; height: number }[];
  points: number;
  /** A storage type whose places have no bay: drawn one cell per place, without levels. */
  flat: boolean;
  /** Drawn at the footprint the data states. */
  placed: boolean;
}

export interface PlanSpot {
  id: string;
  kind: "door" | "work_center" | "reporting_point";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Drawn at the position the data states. */
  placed: boolean;
}

export interface PlanLink {
  id: string;
  from: string;
  to: string;
  mode?: string;
  both: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface FloorPlan {
  /** True when the building states a layout, a footprint or a position. */
  real: boolean;
  hall: { x: number; y: number; width: number; height: number };
  /** The hall's size in metres, if warehouse.layout states it. */
  layout?: { width: number; depth: number };
  /** In a real plan: where elements without a place wait, beside the hall. */
  waiting?: { x: number; y: number; width: number; height: number };
  blocks: PlanBlock[];
  spots: PlanSpot[];
  links: PlanLink[];
  /** Places drawn with the assumed footprint. */
  assumed: number;
  /** Storage types drawn flat although they are racks (access_model rack, but no bays in the data). */
  flatRacks: string[];
}

const px = (m: number) => Math.max(MIN_PX, Math.round(m * PX_PER_M));

function footprint(points: Entity[]): { width: number; depth: number; assumed: boolean } {
  for (const p of points) {
    const size = p.size as { width?: unknown; depth?: unknown } | undefined;
    const [width, depth] = [metres(size?.width), metres(size?.depth)];
    if (width && depth) return { width, depth, assumed: false };
  }
  return { ...ASSUMED_SIZE, assumed: true };
}

function traits(points: Entity[]) {
  const conditions = new Set(points.map((p) => (typeof p.storage_condition === "string" ? p.storage_condition : "")));
  return {
    condition: conditions.size === 1 ? [...conditions][0] || undefined : undefined,
    hazmat: points.some((p) => Array.isArray(p.hazmat_classes) && p.hazmat_classes.length > 0),
    blocked: points.filter((p) => p.blocked === true).length,
  };
}

const groupBy = <T,>(items: T[], key: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
};

/** Places side by side on one level of a bay: the widest level, per layout variant; a channel counts once. */
function positionsOf(points: Entity[]): number {
  let most = 1;
  for (const level of groupBy(points, (p) => String(p.shelf ?? "")).values()) {
    for (const variant of groupBy(level, (p) => String(p.layout_variant ?? "")).values()) {
      most = Math.max(most, new Set(variant.map((p) => String(p.channel ?? p.id))).size);
    }
  }
  return most;
}

function bayCells(bays: Entity[], points: Entity[], shelves: Map<string, number>) {
  const byBay = groupBy(points, (p) => String(p.bay));
  const cells: PlanCell[] = [];
  const rows: PlanBlock["rows"] = [];
  let y = HEADER;
  let width = 0;
  const aisles = [...new Set(bays.map((b) => Number(b.aisle)))].sort((a, b) => a - b);
  for (const aisle of aisles) {
    let x = PAD + 34; // room for the row label
    let rowHeight = 0;
    const row = bays.filter((b) => Number(b.aisle) === aisle).sort((a, b) => Number(a.bay) - Number(b.bay));
    for (const bay of row) {
      const own = byBay.get(bay.id) ?? [];
      const size = footprint(own);
      const positions = positionsOf(own);
      const depth = Math.max(1, ...own.map((p) => (typeof p.channel_position === "number" ? p.channel_position : 1)));
      const cell: PlanCell = {
        id: bay.id, kind: "bay", x, y, width: px(size.width * positions), height: px(size.depth * depth),
        label: `F${String(bay.bay).padStart(2, "0")}`, points: own, aisle, bay: Number(bay.bay),
        levels: shelves.get(bay.id) ?? new Set(own.map((p) => String(p.shelf))).size, positions, depth,
        ...traits(own), assumed: size.assumed,
      };
      cells.push(cell);
      x += cell.width + 2;
      rowHeight = Math.max(rowHeight, cell.height);
    }
    rows.push({ aisle, y, height: rowHeight });
    width = Math.max(width, x);
    y += rowHeight + Math.round(AISLE_M * PX_PER_M);
  }
  return { cells, rows, width: width + PAD, height: y - Math.round(AISLE_M * PX_PER_M) };
}

function pointCells(points: Entity[], top: number) {
  const size = footprint(points);
  const [w, h] = [px(size.width), px(size.depth)];
  // About square in pixels.
  const columns = Math.max(1, Math.ceil(Math.sqrt((points.length * h) / w)));
  const cells = points.map((p, i): PlanCell => ({
    id: p.id, kind: "point", x: PAD + (i % columns) * (w + 2), y: top + Math.floor(i / columns) * (h + 2), width: w, height: h,
    label: String(p.coordinate ?? p.id), points: [p], ...traits([p]), assumed: metres((p.size as { width?: unknown } | undefined)?.width) === undefined,
  }));
  const lines = Math.ceil(points.length / columns);
  return { cells, width: PAD * 2 + Math.min(columns, points.length) * (w + 2) - 2, height: top + lines * (h + 2) - 2 };
}

function block(id: string, building: Building, shelves: Map<string, number>): PlanBlock {
  const points = (building.points ?? []).filter((p) => p.storage_type === id);
  const bays = (building.entities?.bay ?? []).filter((b) => b.storage_type === id);
  const inBays = new Set(bays.map((b) => b.id));
  const racked = bays.length ? bayCells(bays, points.filter((p) => inBays.has(String(p.bay))), shelves) : null;
  const loose = points.filter((p) => !inBays.has(String(p.bay)));
  const flat = pointCells(loose, racked ? racked.height + (loose.length ? PAD : 0) : HEADER);
  const cells = [...(racked?.cells ?? []), ...flat.cells];
  return {
    id, x: 0, y: 0, cells, rows: racked?.rows ?? [], points: points.length, flat: !racked, placed: false,
    width: Math.max(190, racked?.width ?? 0, flat.width),
    height: Math.max(58, (loose.length || !racked ? flat.height : racked.height) + PAD),
  };
}

/** A position's x and y in metres; undefined unless both are readable. */
export function xyOf(position: unknown): { x: number; y: number } | undefined {
  if (!position || typeof position !== "object") return undefined;
  const { x, y } = position as { x?: unknown; y?: unknown };
  const coordinate = (value: unknown) => {
    if (!value || typeof value !== "object") return undefined;
    const { value: v, unit } = value as { value?: unknown; unit?: unknown };
    const factor = UNIT_M[String(unit)];
    return typeof v === "number" && v >= 0 && factor ? v * factor : undefined;
  };
  const [mx, my] = [coordinate(x), coordinate(y)];
  return mx === undefined || my === undefined ? undefined : { x: mx, y: my };
}

/** A footprint as a box in metres; undefined unless it is complete. */
export function footprintOf(entity: Entity | undefined): { x: number; y: number; width: number; depth: number } | undefined {
  const footprint = entity?.footprint as { position?: unknown; width?: unknown; depth?: unknown } | undefined;
  const origin = xyOf(footprint?.position);
  const [width, depth] = [metres(footprint?.width), metres(footprint?.depth)];
  return origin && width && depth ? { ...origin, width, depth } : undefined;
}

/** The hall's size in metres, from warehouse.layout. */
export function layoutOf(building: Building): { width: number; depth: number } | undefined {
  const layout = building.entities?.warehouse?.[0]?.layout as { width?: unknown; depth?: unknown } | undefined;
  const [width, depth] = [metres(layout?.width), metres(layout?.depth)];
  return width && depth ? { width, depth } : undefined;
}

/** Moves a block to its footprint and spreads its inner structure over it. */
function fit(b: PlanBlock, box: { x: number; y: number; width: number; depth: number }) {
  const [width, height] = [Math.max(24, box.width * PX_PER_M), Math.max(24, box.depth * PX_PER_M)];
  const fx = width / b.width;
  // Keep the title line as it is where the footprint leaves room for it.
  const keep = height > HEADER * 2;
  const fy = keep ? (height - HEADER) / (b.height - HEADER) : height / b.height;
  const top = (y: number) => (keep ? HEADER + (y - HEADER) * fy : y * fy);
  for (const cell of b.cells) {
    Object.assign(cell, { x: cell.x * fx, y: top(cell.y), width: Math.max(3, cell.width * fx - 1), height: Math.max(3, cell.height * fy - 1) });
  }
  for (const row of b.rows) Object.assign(row, { y: top(row.y), height: row.height * fy });
  Object.assign(b, { x: box.x * PX_PER_M, y: box.y * PX_PER_M, width, height, placed: true });
}

type Box = { x: number; y: number; width: number; height: number };

/** The point where the line from a box's center towards (tx, ty) leaves the box. */
function edgeOf(box: Box, tx: number, ty: number) {
  const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
  const [dx, dy] = [tx - cx, ty - cy];
  if (!dx && !dy) return { x: cx, y: cy };
  const scale = Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function links(graph: Graph, boxes: Map<string, Box>): PlanLink[] {
  const out: PlanLink[] = [];
  for (const edge of graph.can) {
    const [a, b] = [boxes.get(edge.source), boxes.get(edge.target)];
    if (!a || !b) continue;
    const start = edgeOf(a, b.x + b.width / 2, b.y + b.height / 2);
    const end = edgeOf(b, a.x + a.width / 2, a.y + a.height / 2);
    out.push({ id: edge.id, from: edge.source, to: edge.target, mode: edge.mode, both: edge.both, x1: start.x, y1: start.y, x2: end.x, y2: end.y });
  }
  return out;
}

const SPOT_KINDS = [["door", "door"], ["work_center", "work_center"], ["reporting_point", "reporting_point"]] as const;

export function floorPlan(building: Building, graph: Graph): FloorPlan {
  const entities = building.entities ?? {};
  const shelves = new Map<string, number>();
  for (const shelf of entities.shelf ?? []) shelves.set(String(shelf.bay), (shelves.get(String(shelf.bay)) ?? 0) + 1);
  const types = entities.storage_type ?? [];
  const blocks = types.map((st) => block(st.id, building, shelves));
  const kinds = new Map(types.map((st) => [st.id, st]));
  const notes = () => ({
    assumed: blocks.reduce((sum, b) => sum + b.cells.filter((c) => c.assumed).reduce((n, c) => n + c.points.length, 0), 0),
    flatRacks: blocks.filter((b) => b.flat && b.points > 1 && kinds.get(b.id)?.access_model === "rack").map((b) => b.id),
  });

  const layout = layoutOf(building);
  const footprints = new Map(types.map((st) => [st.id, footprintOf(st)]));
  const positions = new Map(SPOT_KINDS.flatMap(([kind]) => (entities[kind] ?? []).map((e) => [e.id, xyOf(e.position)] as const)));
  const real = Boolean(layout) || [...footprints.values(), ...positions.values()].some(Boolean);
  if (!real) return calculated(building, graph, blocks, notes);

  const spots: PlanSpot[] = [];
  for (const [kind] of SPOT_KINDS) {
    for (const e of entities[kind] ?? []) {
      const at = positions.get(e.id);
      spots.push({
        id: e.id, kind, ...SPOT, placed: Boolean(at),
        x: at ? at.x * PX_PER_M - SPOT.width / 2 : 0, y: at ? at.y * PX_PER_M - SPOT.height / 2 : 0,
      });
    }
  }
  for (const b of blocks) {
    const box = footprints.get(b.id);
    if (box) fit(b, box);
  }
  const placed = [...blocks, ...spots].filter((e) => e.placed);
  // Without warehouse.layout, the hall is what its placed elements cover.
  const hall = layout
    ? { x: 0, y: 0, width: layout.width * PX_PER_M, height: layout.depth * PX_PER_M }
    : {
        x: 0, y: 0,
        width: Math.max(SPOT.width, ...placed.map((e) => e.x + e.width)) + GAP,
        height: Math.max(SPOT.height, ...placed.map((e) => e.y + e.height)) + GAP,
      };

  // Elements without a place wait in a column beside the hall.
  const open = [...blocks, ...spots].filter((e) => !e.placed);
  let waiting: FloorPlan["waiting"];
  if (open.length) {
    const left = Math.max(hall.width, ...placed.map((e) => e.x + e.width)) + GAP * 2;
    const limit = Math.max(hall.height, ...open.map((e) => e.height));
    let [x, y, columnWidth] = [left + PAD, HEADER + PAD, 0];
    for (const e of open) {
      if (y > HEADER + PAD && y + e.height > limit) {
        x += columnWidth + GAP / 2;
        y = HEADER + PAD;
        columnWidth = 0;
      }
      Object.assign(e, { x, y });
      y += e.height + GAP / 2;
      columnWidth = Math.max(columnWidth, e.width);
    }
    waiting = {
      x: left, y: 0, width: x + columnWidth + PAD - left,
      height: Math.max(...open.map((e) => e.y + e.height)) + PAD,
    };
  }
  const boxes = new Map<string, Box>([...blocks, ...spots].map((b) => [b.id, b]));
  return { real: true, hall, layout, waiting, blocks, spots, links: links(graph, boxes), ...notes() };
}

/** The plan of a building without any layout data: blocks packed into rows. */
function calculated(building: Building, graph: Graph, blocks: PlanBlock[], notes: () => { assumed: number; flatRacks: string[] }): FloorPlan {
  const entities = building.entities ?? {};
  // Pack the blocks into rows of about this width: a hall wider than deep, as the page is.
  const area = blocks.reduce((sum, b) => sum + (b.width + GAP) * (b.height + GAP), 0);
  const limit = Math.max(...blocks.map((b) => b.width), Math.sqrt(area * 3), 3 * SPOT.width);
  let [x, y, rowHeight, inner] = [GAP, GAP, 0, 0];
  for (const b of blocks) {
    if (x > GAP && x + b.width > GAP + limit) {
      x = GAP;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    Object.assign(b, { x, y });
    x += b.width + GAP;
    rowHeight = Math.max(rowHeight, b.height);
    inner = Math.max(inner, x);
  }
  y += rowHeight + GAP;

  // Work centers and reporting points in a row below the storage, doors in the hall's lower wall.
  const spots: PlanSpot[] = [];
  const row = (items: Entity[], kind: PlanSpot["kind"], top: number) => {
    const total = items.length * SPOT.width + Math.max(0, items.length - 1) * GAP;
    let left = GAP + Math.max(0, (Math.max(inner - GAP, total + GAP) - GAP - total) / 2);
    for (const item of items) {
      spots.push({ id: item.id, kind, x: left, y: top, ...SPOT, placed: false });
      left += SPOT.width + GAP;
    }
    inner = Math.max(inner, left);
  };
  const stations = [
    ...(entities.work_center ?? []).map((e) => ({ e, kind: "work_center" as const })),
    ...(entities.reporting_point ?? []).map((e) => ({ e, kind: "reporting_point" as const })),
  ];
  if (stations.length) {
    const before = spots.length;
    row(stations.map((s) => s.e), "work_center", y);
    stations.forEach((s, i) => (spots[before + i].kind = s.kind));
    y += SPOT.height + GAP;
  }
  const hall = { x: 0, y: 0, width: inner, height: y };
  row(entities.door ?? [], "door", hall.height - SPOT.height / 2);
  hall.width = Math.max(hall.width, inner);

  const boxes = new Map<string, Box>([...blocks, ...spots].map((b) => [b.id, b]));
  return { real: false, hall, blocks, spots, links: links(graph, boxes), ...notes() };
}
