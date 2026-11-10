// The hall plan view of the topology tab: storage types as blocks in top
// view with their bays and places, doors in the hall's wall, and the physical
// connections as lines. See floorplan.ts for what is data and what is calculated.
import { Background, Controls, NodeResizer, ReactFlow, useNodesState, ViewportPortal, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { metres, PX_PER_M, type FloorPlan, type PlanBlock, type PlanCell, type PlanLink, type PlanSpot } from "./floorplan";
import { subtitle, type TopoNode } from "./graph";
import { t, tl, tn, useLang } from "./i18n";
import type { Entity } from "./types";

/** Storage conditions with a color of their own; others share one. */
const CONDITIONS = ["ambient", "chilled", "frozen"];
const conditionClass = (condition: string | undefined) =>
  !condition ? "cond-none" : CONDITIONS.includes(condition) ? `cond-${condition}` : "cond-other";

/** A rectangle in plan pixels. */
export interface PlanBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface PlanContext {
  cellId: string | null;
  onCell: (block: string, cell: PlanCell) => void;
  /** Set while the layout is edited: a block's footprint can be resized. */
  onResize?: (id: string, box: PlanBox) => void;
}
const Context = createContext<PlanContext>({ cellId: null, onCell: () => {} });
/** Smallest footprint that can be dragged: 1 m. */
const MIN_BLOCK = PX_PER_M;

function cellTitle(cell: PlanCell): string {
  const parts = [cell.id];
  if (cell.kind === "bay") parts.push(tn("plan.levels", cell.levels ?? 0), tn("plan.places", cell.points.length));
  if (cell.condition) parts.push(cell.condition);
  if (cell.hazmat) parts.push(t("plan.hazmat"));
  if (cell.blocked) parts.push(tn("plan.blocked", cell.blocked));
  if (cell.assumed) parts.push(t("plan.assumedSize"));
  return parts.join(" · ");
}

/** What another view (the material flow) shows on a block or spot. */
export interface PlanBadge {
  /** Replaces the second line, e.g. stock or how busy the element is. */
  sub?: string;
  /** Load units waiting there. */
  queue?: number;
  bottleneck?: boolean;
  marked?: boolean;
}
/** How another view draws a connection. */
export interface LinkLook {
  color?: string;
  width?: number;
  opacity?: number;
}
const badgeClass = (badge?: PlanBadge) => `${badge?.bottleneck ? " bottleneck" : ""}${badge?.marked ? " marked" : ""}`;
const Queue = ({ badge }: { badge?: PlanBadge }) =>
  badge?.queue ? <span className="sim-queue" title={t("sim.queueHint")} data-queue={badge.queue}>{badge.queue}</span> : null;

type BlockData = { block: PlanBlock; node?: TopoNode; findings: number; badge?: PlanBadge };

function BlockView({ data, selected }: NodeProps<Node<BlockData>>) {
  const { block, node, findings, badge } = data;
  const { cellId, onCell, onResize } = useContext(Context);
  return (
    <>
    {onResize && (
      <NodeResizer
        minWidth={MIN_BLOCK}
        minHeight={MIN_BLOCK}
        lineClassName="plan-resize-line"
        handleClassName="plan-resize-handle"
        onResizeEnd={(_, box) => onResize(block.id, box)}
      />
    )}
    <div
      className={`plan-block${block.placed ? "" : " waiting"}${selected ? " selected" : ""}${findings ? " has-findings" : ""}${badgeClass(badge)}`}
      data-placed={block.placed}
      style={onResize ? { width: "100%", height: "100%" } : { width: block.width, height: block.height }}
      data-plan-block={block.id}
    >
      <div className="plan-title">
        <strong>{block.id}</strong> <span>{badge?.sub ?? (node ? subtitle(node) : "")}</span>
      </div>
      <Queue badge={badge} />
      {block.rows.map((row) => (
        <span key={row.aisle} className="plan-row" style={{ top: row.y, height: row.height }} title={t("plan.aisle", { n: row.aisle })}>
          G{String(row.aisle).padStart(2, "0")}
        </span>
      ))}
      {block.cells.map((cell) => (
        <button
          key={cell.id}
          type="button"
          className={`plan-cell ${conditionClass(cell.condition)}${cell.hazmat ? " hazmat" : ""}${cell.blocked ? " blocked" : ""}${cell.assumed ? " assumed" : ""}${cell.id === cellId ? " chosen" : ""}`}
          style={{ left: cell.x, top: cell.y, width: cell.width, height: cell.height }}
          title={cellTitle(cell)}
          data-plan-cell={cell.id}
          onClick={(event) => {
            event.stopPropagation();
            onCell(block.id, cell);
          }}
        >
          {cell.kind === "bay" ? `${cell.label} · ${cell.levels}` : cell.width >= 60 ? cell.label : ""}
        </button>
      ))}
      {findings > 0 && <span className="topo-flag" title={t("topology.findings")}>{findings}</span>}
    </div>
    </>
  );
}

type SpotData = { spot: PlanSpot; node?: TopoNode; findings: number; badge?: PlanBadge };

function SpotView({ data, selected }: NodeProps<Node<SpotData>>) {
  const { spot, node, findings, badge } = data;
  return (
    <div
      className={`topo-node plan-spot kind-${spot.kind}${spot.placed ? "" : " waiting"}${selected ? " selected" : ""}${findings ? " has-findings" : ""}${badgeClass(badge)}`}
      data-placed={spot.placed}
      style={{ width: spot.width, height: spot.height }}
      data-plan-spot={spot.id}
    >
      <div className="topo-id">{spot.id}</div>
      <div className="topo-sub">{badge?.sub ?? (node ? subtitle(node) : "")}</div>
      <Queue badge={badge} />
      {findings > 0 && <span className="topo-flag" title={t("topology.findings")}>{findings}</span>}
    </div>
  );
}

function HallView({ data }: NodeProps<Node<{ width: number; height: number; name: string; open?: boolean }>>) {
  return (
    <div className={`plan-hall${data.open ? " open" : ""}`} style={{ width: data.width, height: data.height }}>
      <span>{data.name}</span>
    </div>
  );
}
const nodeTypes = { block: BlockView, spot: SpotView, hall: HallView };

export function FloorPlanCanvas({ plan, name, nodes, findingsOf, colors, selectedId, cellId, onSelect, onCell, editable = false, onMove, onResize, badges, linkLook, children }: {
  plan: FloorPlan;
  name: string;
  /** The diagram's nodes, for the second line of each block and spot. */
  nodes: TopoNode[];
  findingsOf: (id: string) => number;
  /** Line color per transport mode. */
  colors: Record<string, string>;
  selectedId: string | null;
  cellId: string | null;
  onSelect: (id: string | null) => void;
  onCell: (block: string, cell: PlanCell) => void;
  /** Blocks and spots can be dragged; onMove gets the new upper left corner in plan pixels. */
  editable?: boolean;
  onMove?: (id: string, at: { x: number; y: number }) => void;
  /** A block's footprint was resized by its handles; the new box in plan pixels. */
  onResize?: (id: string, box: PlanBox) => void;
  /** Marks on blocks and spots, by id. */
  badges?: Map<string, PlanBadge>;
  linkLook?: (link: PlanLink) => LinkLook;
  /** Drawn on top of the plan, in plan pixels (e.g. moving load units). */
  children?: ReactNode;
}) {
  const lang = useLang();
  const flowNodes = useMemo<Node[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    return [
      {
        id: "plan:hall", type: "hall", position: { x: plan.hall.x, y: plan.hall.y }, data: { ...plan.hall, name },
        selectable: false, draggable: false, zIndex: -1, style: { pointerEvents: "none" as const },
      },
      ...(plan.waiting
        ? [{
            id: "plan:waiting", type: "hall", position: { x: plan.waiting.x, y: plan.waiting.y },
            data: { ...plan.waiting, name: t("plan.waitingTitle"), open: true },
            selectable: false, draggable: false, zIndex: -1, style: { pointerEvents: "none" as const },
          }]
        : []),
      ...plan.blocks.map((block) => ({
        id: block.id, type: "block", position: { x: block.x, y: block.y }, width: block.width, height: block.height,
        data: { block, node: byId.get(block.id), findings: findingsOf(block.id), badge: badges?.get(block.id) }, selected: block.id === selectedId,
      })),
      ...plan.spots.map((spot) => ({
        id: spot.id, type: "spot", position: { x: spot.x, y: spot.y }, width: spot.width, height: spot.height,
        data: { spot, node: byId.get(spot.id), findings: findingsOf(spot.id), badge: badges?.get(spot.id) }, selected: spot.id === selectedId,
      })),
    ];
  }, [plan, nodes, name, selectedId, findingsOf, badges, lang]);
  const context = useMemo(() => ({ cellId, onCell, onResize: editable ? onResize : undefined }), [cellId, onCell, editable, onResize]);
  // While editing, React Flow moves the nodes itself; the data follows on drop.
  const [live, setLive, onNodesChange] = useNodesState<Node>([]);
  useEffect(() => setLive(flowNodes), [flowNodes, setLive]);
  const grid = (PX_PER_M / 2) | 0;
  return (
    <Context.Provider value={context}>
      <ReactFlow
        nodes={editable ? live : flowNodes}
        onNodesChange={editable ? onNodesChange : undefined}
        snapToGrid={editable}
        snapGrid={[grid, grid]}
        onNodeDragStop={(_, n) => editable && !n.id.startsWith("plan:") && onMove?.(n.id, n.position)}
        edges={[]}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.1}
        nodesDraggable={editable}
        nodesConnectable={false}
        onNodeClick={(_, n) => !n.id.startsWith("plan:") && onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
        <ViewportPortal>
          <svg className="plan-links" width={plan.hall.width} height={plan.hall.height + 40} style={{ overflow: "visible" }}>
            {plan.links.map((link) => {
              const look = linkLook?.(link) ?? {};
              const color = look.color ?? colors[link.mode ?? ""] ?? "#8a94a3";
              return (
                <g key={link.id} data-plan-link={link.id} opacity={look.opacity}>
                  <line
                    x1={link.x1} y1={link.y1} x2={link.x2} y2={link.y2}
                    stroke={color}
                    strokeWidth={look.width ?? 2.5}
                    strokeDasharray={link.mode === "controller_internal" ? "6 4" : undefined}
                  />
                  <circle cx={link.x2} cy={link.y2} r={4} fill={color} />
                  {link.both && <circle cx={link.x1} cy={link.y1} r={4} fill={color} />}
                  <title>{`${link.from} ${link.both ? "↔" : "→"} ${link.to} · ${tl("mode", link.mode ?? "")}`}</title>
                </g>
              );
            })}
          </svg>
          {children}
        </ViewportPortal>
      </ReactFlow>
    </Context.Provider>
  );
}

const sizeText = (p: Entity) => {
  const size = p.size as { width?: unknown; depth?: unknown; height?: unknown } | undefined;
  const [w, d, h] = [metres(size?.width), metres(size?.depth), metres(size?.height)];
  return w && d ? `${w} × ${d}${h ? ` × ${h}` : ""} m` : undefined;
};
const weightText = (p: Entity) => {
  const weight = p.max_weight as { value?: unknown; unit?: unknown } | undefined;
  return weight?.value != null ? `${weight.value} ${weight.unit ?? ""}`.trim() : undefined;
};
const levelOf = (shelf: string) => Number(/-L(\d+)$/.exec(shelf)?.[1] ?? NaN);

/** The side panel for a chosen cell: a bay's levels from top to bottom, or one place's data. */
export function CellDetails({ block, cell }: { block: string; cell: PlanCell }) {
  const first = cell.points[0];
  const facts = [
    first && sizeText(first) && t("plan.placeSize", { size: sizeText(first)! }),
    first && weightText(first) && t("plan.maxWeight", { weight: weightText(first)! }),
    cell.condition && t("plan.condition", { condition: cell.condition }),
    cell.hazmat && t("plan.hazmat"),
    cell.assumed && t("plan.assumedSize"),
  ].filter(Boolean) as string[];
  if (cell.kind === "point") {
    return (
      <div data-plan-details={cell.id}>
        <h3>{cell.id}</h3>
        <p className="hint">{t("plan.placeOf", { type: block })}</p>
        {first?.blocked === true && <p className="forbidden">{t("plan.blockedReason", { reason: String(first.blocked_reason ?? "–") })}</p>}
        <ul>{facts.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
    );
  }
  const levels = [...new Set(cell.points.map((p) => String(p.shelf)))].sort((a, b) => levelOf(b) - levelOf(a) || b.localeCompare(a));
  return (
    <div data-plan-details={cell.id}>
      <h3>{cell.id}</h3>
      <p className="hint">
        {t("plan.bayOf", { type: block, aisle: cell.aisle ?? "", bay: cell.bay ?? "" })} · {tn("plan.levels", cell.levels ?? 0)} · {tn("plan.places", cell.points.length)}
      </p>
      <ul>{facts.map((f) => <li key={f}>{f}</li>)}</ul>
      <h4>{t("plan.sideView")}</h4>
      <div className="plan-levels">
        {levels.map((shelf) => {
          const own = cell.points.filter((p) => String(p.shelf) === shelf);
          const variants = [...new Set(own.map((p) => String(p.layout_variant ?? "")))];
          return (
            <div key={shelf} className="plan-level" data-plan-level={shelf}>
              <span className="plan-level-name">{t("plan.level", { n: Number.isNaN(levelOf(shelf)) ? shelf : levelOf(shelf) })}</span>
              <div className="plan-level-places">
                {variants.map((variant) => (
                  <div key={variant} className="plan-variant">
                    {variant && <span className="hint">{variant}</span>}
                    <Places points={own.filter((p) => String(p.layout_variant ?? "") === variant)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="hint">{t("plan.sideViewHint")}</p>
    </div>
  );
}

/** The places of one level: one box per place, or per channel with its depth. */
function Places({ points }: { points: Entity[] }) {
  const groups = new Map<string, Entity[]>();
  for (const p of points) {
    const key = String(p.channel ?? p.id);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  return (
    <>
      {[...groups].map(([key, own]) => {
        const blocked = own.filter((p) => p.blocked === true);
        const name = own.length > 1 ? `${key.split(".").pop()} ×${own.length}` : String(own[0].coordinate ?? key);
        const title = [key, sizeText(own[0]), weightText(own[0]), ...blocked.map((p) => t("plan.blockedReason", { reason: String(p.blocked_reason ?? "–") }))]
          .filter(Boolean).join(" · ");
        return (
          <span key={key} className={`plan-place${blocked.length ? " blocked" : ""}`} title={title} data-plan-place={key}>
            {name}
          </span>
        );
      })}
    </>
  );
}

export function PlanLegend({ colors, modes }: { colors: Record<string, string>; modes: string[] }) {
  return (
    <div className="legend">
      {[...CONDITIONS, "other", "none"].map((c) => (
        <span key={c} className="legend-item">
          <span className={`legend-cell cond-${c}`} /> {t(`plan.cond.${c}`)}
        </span>
      ))}
      <span className="legend-item"><span className="legend-cell cond-none hazmat" /> {t("plan.hazmat")}</span>
      <span className="legend-item"><span className="legend-cell cond-none blocked" /> {t("plan.legendBlocked")}</span>
      <span className="legend-item"><span className="legend-cell cond-none assumed" /> {t("plan.assumedSize")}</span>
      {modes.map((mode) => (
        <span key={mode} className="legend-item">
          <span className="legend-line" style={{ borderTopColor: colors[mode], borderTopStyle: mode === "controller_internal" ? "dashed" : "solid" }} /> {tl("mode", mode)}
        </span>
      ))}
    </div>
  );
}
