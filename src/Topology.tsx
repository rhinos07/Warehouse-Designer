import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo, useState } from "react";
import { buildGraph, findingsFor, KIND_LABEL, MODE_LABEL, type NodeKind, type TopoEdge, type TopoNode } from "./graph";
import type { Building, Entity } from "./types";

const EDGE_COLOR: Record<string, string> = {
  conveyor: "#2f6fdb",
  lane: "#1f8a8a",
  forklift: "#d9822b",
  walking: "#3f9a4a",
  controller_internal: "#8a94a3",
  rule: "#7b4fd6",
  forbidden: "#d64545",
};
const colorOf = (e: TopoEdge) =>
  e.kind === "rule" ? (e.allowed ? EDGE_COLOR.rule : EDGE_COLOR.forbidden) : (EDGE_COLOR[e.mode ?? ""] ?? "#8a94a3");

type TopoNodeData = { node: TopoNode; findings: string[] };

function TopoNodeView({ data, selected }: NodeProps<Node<TopoNodeData>>) {
  const { node, findings } = data;
  return (
    <div
      className={`topo-node kind-${node.kind}${selected ? " selected" : ""}${findings.length ? " has-findings" : ""}`}
      style={{ width: node.width, height: node.height }}
      data-node={node.id}
    >
      <Handle type="target" position={Position.Left} />
      <div className="topo-id">{node.id}</div>
      <div className="topo-sub">{node.subtitle}</div>
      {findings.length > 0 && <span className="topo-flag" title="Befunde aus der Prüfung">{findings.length}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { topo: TopoNodeView };

export function TopologyView({ buildings, findings }: { buildings: Building[]; findings: string[] }) {
  const [index, setIndex] = useState(() => Math.max(0, buildings.findIndex((b) => b.ok)));
  const [showRules, setShowRules] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const building = buildings[index];
  const graph = useMemo(() => (building?.ok ? buildGraph(building) : null), [building]);

  const flowNodes = useMemo<Node<TopoNodeData>[]>(
    () =>
      graph?.nodes.map((n) => ({
        id: n.id,
        type: "topo",
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        data: { node: n, findings: findingsFor(n.id, findings) },
        selected: n.id === selectedId,
      })) ?? [],
    [graph, findings, selectedId],
  );
  const flowEdges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    return [...graph.can, ...(showRules ? graph.rules : [])].map((e) => {
      const color = colorOf(e);
      const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        className: `edge-${e.kind}`,
        style: {
          stroke: color,
          strokeWidth: e.kind === "rule" ? 1.5 : 2,
          strokeDasharray: e.kind === "rule" || e.mode === "controller_internal" ? "6 4" : undefined,
        },
        labelStyle: { fill: color, fontSize: 11 },
        labelBgStyle: { fill: "var(--surface)" },
        markerEnd: marker,
        markerStart: e.both ? marker : undefined,
      };
    });
  }, [graph, showRules]);

  if (!buildings.length) return <p className="status">Keine Topology-Hallen gefunden.</p>;
  const selected = graph?.nodes.find((n) => n.id === selectedId);

  return (
    <div className="topology">
      <div className="topo-toolbar">
        <label>
          Halle{" "}
          <select
            value={index}
            onChange={(e) => {
              setIndex(Number(e.target.value));
              setSelectedId(null);
            }}
          >
            {buildings.map((b, i) => (
              <option key={b.path} value={i}>
                {b.ok ? `${b.customer} / ${b.facility} / ${b.name ?? b.building}` : `${b.path} (Fehler)`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={showRules} onChange={(e) => setShowRules(e.target.checked)} /> Bewegungsregeln
          („darf“) einblenden
        </label>
      </div>

      {!building.ok && (
        <div className="status error">
          Diese Halle lässt sich nicht kompilieren:
          <pre>{building.error}</pre>
        </div>
      )}

      {graph && (
        <div className="topo-main">
          <div className="topo-canvas">
            <ReactFlow
              key={building.path}
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.08 }}
              minZoom={0.1}
              nodesDraggable={false}
              nodesConnectable={false}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <aside className="topo-details">
            {selected ? (
              <Details node={selected} building={building} graph={graph} findings={findingsFor(selected.id, findings)} />
            ) : (
              <p className="hint">Einen Knoten anklicken, um seine Daten, Verbindungen und Regeln zu sehen.</p>
            )}
          </aside>
        </div>
      )}

      {graph && <Legend />}

      {graph && showRules && graph.unplaced.length > 0 && (
        <div className="unplaced">
          <h3>Regeln ohne festen Start- oder Zielknoten</h3>
          <p className="hint">Platzhalter („*“), Bereiche oder Abschnitte – nicht als Linie darstellbar.</p>
          <ul>
            {graph.unplaced.map((r) => (
              <li key={r.id}>
                <strong>{r.id}</strong>: {endpoint(r.from)} → {endpoint(r.to)}
                {r.allowed === false && <span className="forbidden"> (verboten)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Details({ node, building, graph, findings }: {
  node: TopoNode;
  building: Building;
  graph: ReturnType<typeof buildGraph>;
  findings: string[];
}) {
  const connections = graph.can.filter((e) => e.source === node.id || e.target === node.id);
  const rules = graph.rules.filter((e) => e.source === node.id || e.target === node.id);
  const points = building.point_counts?.[node.id];
  return (
    <div data-details={node.id}>
      <h3>{node.id}</h3>
      <p className="hint">{KIND_LABEL[node.kind as NodeKind]}</p>
      {findings.length > 0 && (
        <>
          <h4>Befunde aus der Prüfung</h4>
          <ul className="findings">{findings.map((f, i) => <li key={i}>{f}</li>)}</ul>
        </>
      )}
      {node.entity && <Attributes entity={node.entity} />}
      {points !== undefined && <p>Lagerplätze: {points}</p>}
      <h4>Verbindungen („kann“)</h4>
      {connections.length ? (
        <ul>
          {connections.map((e) => (
            <li key={e.id}>
              {e.both ? "↔" : e.source === node.id ? "→" : "←"} {e.source === node.id ? e.target : e.source} ·{" "}
              {MODE_LABEL[e.mode ?? ""] ?? e.mode} <span className="hint">({e.entityId})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">keine</p>
      )}
      <h4>Bewegungsregeln („darf“)</h4>
      {rules.length ? (
        <ul>
          {rules.map((e) => (
            <li key={e.id}>
              {e.source === node.id ? `→ ${e.target}` : `← ${e.source}`} · {e.entityId}
              {!e.allowed && <span className="forbidden"> (verboten)</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">keine mit festem Knoten</p>
      )}
    </div>
  );
}

function Attributes({ entity }: { entity: Entity }) {
  const rows = Object.entries(entity).filter(([key]) => key !== "id");
  if (!rows.length) return null;
  return (
    <table className="attrs">
      <tbody>
        {rows.map(([key, value]) => (
          <tr key={key}>
            <th>{key}</th>
            <td>{format(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const format = (value: unknown): string =>
  Array.isArray(value) && value.every((v) => typeof v !== "object")
    ? value.join(", ")
    : typeof value === "object" && value !== null
      ? JSON.stringify(value)
      : String(value);

const endpoint = (value: unknown): string =>
  value == null
    ? "beliebig"
    : typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k} ${format(v)}`).join(", ")
      : String(value);

function Legend() {
  const kinds: NodeKind[] = ["storage_type", "door", "work_center", "reporting_point", "storage_point"];
  return (
    <div className="legend">
      {kinds.map((k) => (
        <span key={k} className="legend-item">
          <span className={`legend-node kind-${k}`} /> {KIND_LABEL[k]}
        </span>
      ))}
      {Object.entries(MODE_LABEL).map(([mode, label]) => (
        <span key={mode} className="legend-item">
          <span className="legend-line" style={{ borderTopColor: EDGE_COLOR[mode], borderTopStyle: mode === "controller_internal" ? "dashed" : "solid" }} /> {label}
        </span>
      ))}
      <span className="legend-item">
        <span className="legend-line" style={{ borderTopColor: EDGE_COLOR.rule, borderTopStyle: "dashed" }} /> Regel erlaubt
      </span>
      <span className="legend-item">
        <span className="legend-line" style={{ borderTopColor: EDGE_COLOR.forbidden, borderTopStyle: "dashed" }} /> Regel verboten
      </span>
    </div>
  );
}
