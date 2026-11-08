import { FindingList } from "./FindingList";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EditPanel, type Form } from "./EditPanel";
import { EditError, ENDPOINT_KINDS, HOME, removeLink, removeNode, usages, type Change, type Files } from "./editor";
import { buildGraph, findingsFor, kindLabel, modeLabel, MODES, subtitle, type NodeKind, type TopoEdge, type TopoNode } from "./graph";
import { t, tl, useLang } from "./i18n";
import type { Building, Entity } from "./types";

const EDGE_COLOR: Record<string, string> = {
  conveyor: "#2f6fdb",
  lane: "#1f8a8a",
  forklift: "#d9822b",
  tugger: "#a0522d",
  amr: "#c2185b",
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
      <div className="topo-sub">{subtitle(node)}</div>
      {findings.length > 0 && <span className="topo-flag" title={t("topology.findings")}>{findings.length}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { topo: TopoNodeView };

export function TopologyView({ buildings, findings, files, onChange, onOpen, busy = false }: {
  buildings: Building[];
  findings: string[];
  /** Topology-as-Code files by repo path; with onChange, the diagram can be edited. */
  files?: Files;
  onChange?: (change: Change) => void;
  /** Opens an element's entry in the data tab's form. */
  onOpen?: (target: { path: string; key: string; id: string }) => void;
  busy?: boolean;
}) {
  const [path, setPath] = useState(() => (buildings.find((b) => b.ok) ?? buildings[0])?.path);
  const [showRules, setShowRules] = useState(false);
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const building = buildings.find((b) => b.path === path) ?? buildings[0];
  const graph = useMemo(() => (building?.ok ? buildGraph(building) : null), [building]);
  const [flow, setFlow] = useState<ReactFlowInstance<Node<TopoNodeData>> | null>(null);
  // An edit can add nodes anywhere in the layout: keep the whole building in view.
  const nodeCount = graph?.nodes.length ?? 0;
  useEffect(() => {
    if (!flow) return;
    // Two frames: React Flow takes the new nodes into its store, then the layout settles.
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => flow.fitView({ padding: 0.08 }))));
    return () => cancelAnimationFrame(frame);
  }, [flow, nodeCount]);
  const canEdit = Boolean(files && onChange && building?.ok && building.sources);
  const edit = editing && canEdit;

  function select(node: string | null, edge: string | null = null) {
    setSelectedId(node);
    setSelectedEdge(edge);
    setForm(null);
    setError("");
  }
  function attempt(make: () => Change) {
    try {
      const change = make();
      onChange!(change);
      select(change.select ?? null);
    } catch (e) {
      setError(e instanceof EditError || e instanceof Error ? e.message : String(e));
    }
  }

  const lang = useLang();
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
        connectable: ENDPOINT_KINDS.includes(n.kind),
      })) ?? [],
    [graph, findings, selectedId, lang],
  );
  const flowEdges = useMemo<Edge[]>(() => {
    if (!graph) return [];
    return [...graph.can, ...(showRules ? graph.rules : [])].map((e) => {
      const color = colorOf(e);
      const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 };
      const chosen = e.id === selectedEdge;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.kind === "rule" ? e.label : modeLabel(e.mode),
        className: `edge-${e.kind}${chosen ? " chosen" : ""}`,
        style: {
          stroke: color,
          strokeWidth: chosen ? 4 : e.kind === "rule" ? 1.5 : 2,
          strokeDasharray: e.kind === "rule" || e.mode === "controller_internal" ? "6 4" : undefined,
        },
        labelStyle: { fill: color, fontSize: 11 },
        labelBgStyle: { fill: "var(--surface)" },
        markerEnd: marker,
        markerStart: e.both ? marker : undefined,
      };
    });
  }, [graph, showRules, selectedEdge, lang]);

  if (!buildings.length) return <p className="status">{t("topology.noHalls")}</p>;
  const selected = graph?.nodes.find((n) => n.id === selectedId);
  const edge = graph?.can.find((e) => e.id === selectedEdge);
  const kindOf = (id: string) => graph?.nodes.find((n) => n.id === id)?.kind;

  let aside: ReactNode;
  if (edit && form && graph) {
    aside = (
      <EditPanel
        key={JSON.stringify(form)}
        form={form}
        building={building}
        files={files!}
        graph={graph}
        onChange={(change) => attempt(() => change)}
        onCancel={() => setForm(null)}
      />
    );
  } else if (edit && edge) {
    aside = <EdgeDetails edge={edge} onRemove={() => attempt(() => removeLink(building, files!, edge.sourceType ?? "", edge.entityId))} />;
  } else if (selected && graph) {
    const removable = edit && ["door", "work_center", "reporting_point"].includes(selected.kind);
    const home = selected.kind === "storage_type" ? (["storage.yaml", "storage_types"] as const) : HOME[selected.kind];
    const homePath = home && building.sources?.[home[0]];
    const used = removable ? usages(building, files!, selected.id) : [];
    aside = (
      <Details node={selected} building={building} graph={graph} findings={findingsFor(selected.id, findings)}>
        {edit && (
          <div className="edit-actions">
            {ENDPOINT_KINDS.includes(selected.kind) && (
              <button onClick={() => setForm({ type: "connection", from: selected.id })} disabled={busy}>{t("topology.addConnection")}</button>
            )}
            {onOpen && home && homePath && (
              <button className="secondary" onClick={() => onOpen({ path: homePath, key: home[1], id: selected.id })} disabled={busy}>
                {t("topology.editAttributes")}
              </button>
            )}
            {removable && (
              <button
                className="danger"
                onClick={() => attempt(() => removeNode(building, files!, selected.kind, selected.id))}
                disabled={busy || used.length > 0}
                title={used.length ? t("topology.stillUsed", { uses: used.join(", ") }) : undefined}
              >
                {t("topology.delete", { id: selected.id })}
              </button>
            )}
            {removable && used.length > 0 && <p className="hint">{t("topology.deleteBlocked", { uses: used.join(", ") })}</p>}
          </div>
        )}
      </Details>
    );
  } else {
    aside = (
      <p className="hint">
        {edit
          ? t("topology.hintEdit")
          : t("topology.hintView")}
      </p>
    );
  }

  return (
    <div className={`topology${edit ? " editing" : ""}`}>
      <div className="topo-toolbar">
        <label>
          {t("topology.hall")}{" "}
          <select
            value={building.path}
            onChange={(e) => {
              setPath(e.target.value);
              select(null);
            }}
          >
            {buildings.map((b) => (
              <option key={b.path} value={b.path}>
                {b.ok ? `${b.customer} / ${b.facility} / ${b.name ?? b.building}` : `${b.path} (${t("topology.error")})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={showRules} onChange={(e) => setShowRules(e.target.checked)} /> {t("topology.showRules")}
        </label>
        {files && onChange && (
          <label>
            <input
              type="checkbox"
              checked={editing}
              onChange={(e) => {
                setEditing(e.target.checked);
                select(null);
              }}
            />{" "}
            {t("topology.edit")}
          </label>
        )}
        {edit && (
          <div className="actions">
            <button className="secondary" onClick={() => setForm({ type: "door" })} disabled={busy}>{t("topology.addDoor")}</button>
            <button className="secondary" onClick={() => setForm({ type: "work_center" })} disabled={busy}>{t("topology.addWorkCenter")}</button>
            <button className="secondary" onClick={() => setForm({ type: "reporting_point" })} disabled={busy}>{t("topology.addReportingPoint")}</button>
          </div>
        )}
      </div>

      {!building.ok && (
        <div className="status error">
          {t("topology.compileError")}
          <pre>{building.error}</pre>
        </div>
      )}
      {error && <p className="status error" data-edit-error>{error}</p>}

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
              nodesConnectable={edit && !busy}
              isValidConnection={(c) => c.source !== c.target && ENDPOINT_KINDS.includes(kindOf(c.target ?? "") ?? "")}
              onConnect={(c) => {
                select(null);
                setForm({ type: "connection", from: c.source, to: c.target });
              }}
              onNodeClick={(_, n) => select(n.id)}
              onEdgeClick={(_, e) => edit && e.id.startsWith("can:") && select(null, e.id)}
              onPaneClick={() => select(null)}
              onInit={setFlow}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <aside className="topo-details">{aside}</aside>
        </div>
      )}

      {graph && <Legend />}

      {graph && showRules && graph.unplaced.length > 0 && (
        <div className="unplaced">
          <h3>{t("topology.unplacedTitle")}</h3>
          <p className="hint">{t("topology.unplacedHint")}</p>
          <ul>
            {graph.unplaced.map((r) => (
              <li key={r.id}>
                <strong>{r.id}</strong>: {endpoint(r.from)} → {endpoint(r.to)}
                {r.allowed === false && <span className="forbidden"> ({t("topology.forbidden")})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}


function EdgeDetails({ edge, onRemove }: { edge: TopoEdge; onRemove: () => void }) {
  const type = edge.sourceType ?? "";
  const removable = HOME[type]?.[0] === "lanes.yaml";
  return (
    <div data-edge={edge.entityId}>
      <h3>{edge.entityId}</h3>
      <p className="hint">{tl("source", type)}</p>
      <p>
        {edge.source} {edge.both ? "↔" : "→"} {edge.target} · {modeLabel(edge.mode)}
      </p>
      {type === "lane" && <p className="hint">{t("topology.laneHint")}</p>}
      {removable ? (
        <button className="danger" onClick={onRemove}>{t("topology.delete", { id: edge.entityId })}</button>
      ) : (
        <p className="hint">
          {type === "controller_internal"
            ? t("topology.internalHint")
            : t("topology.mainConveyorHint")}
        </p>
      )}
    </div>
  );
}

function Details({ node, building, graph, findings, children }: {
  node: TopoNode;
  building: Building;
  graph: ReturnType<typeof buildGraph>;
  findings: string[];
  children?: ReactNode;
}) {
  const connections = graph.can.filter((e) => e.source === node.id || e.target === node.id);
  const rules = graph.rules.filter((e) => e.source === node.id || e.target === node.id);
  const points = building.point_counts?.[node.id];
  return (
    <div data-details={node.id}>
      <h3>{node.id}</h3>
      <p className="hint">{kindLabel(node.kind as NodeKind)}</p>
      {children}
      {findings.length > 0 && (
        <>
          <h4>{t("topology.findings")}</h4>
          <FindingList items={findings} />
        </>
      )}
      {node.entity && <Attributes entity={node.entity} />}
      {points !== undefined && <p>{t("topology.storagePoints", { n: points })}</p>}
      <h4>{t("topology.connections")}</h4>
      {connections.length ? (
        <ul>
          {connections.map((e) => (
            <li key={e.id}>
              {e.both ? "↔" : e.source === node.id ? "→" : "←"} {e.source === node.id ? e.target : e.source} ·{" "}
              {modeLabel(e.mode)} <span className="hint">({e.entityId})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("topology.none")}</p>
      )}
      <h4>{t("topology.rules")}</h4>
      {rules.length ? (
        <ul>
          {rules.map((e) => (
            <li key={e.id}>
              {e.source === node.id ? `→ ${e.target}` : `← ${e.source}`} · {e.entityId}
              {!e.allowed && <span className="forbidden"> ({t("topology.forbidden")})</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("topology.noFixedRules")}</p>
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
    ? t("topology.any")
    : typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).map(([k, v]) => `${k} ${format(v)}`).join(", ")
      : String(value);

function Legend() {
  const kinds: NodeKind[] = ["storage_type", "door", "work_center", "reporting_point", "storage_point"];
  return (
    <div className="legend">
      {kinds.map((k) => (
        <span key={k} className="legend-item">
          <span className={`legend-node kind-${k}`} /> {kindLabel(k)}
        </span>
      ))}
      {MODES.map((mode) => [mode, modeLabel(mode)]).map(([mode, label]) => (
        <span key={mode} className="legend-item">
          <span className="legend-line" style={{ borderTopColor: EDGE_COLOR[mode], borderTopStyle: mode === "controller_internal" ? "dashed" : "solid" }} /> {label}
        </span>
      ))}
      <span className="legend-item">
        <span className="legend-line" style={{ borderTopColor: EDGE_COLOR.rule, borderTopStyle: "dashed" }} /> {t("topology.ruleAllowed")}
      </span>
      <span className="legend-item">
        <span className="legend-line" style={{ borderTopColor: EDGE_COLOR.forbidden, borderTopStyle: "dashed" }} /> {t("topology.ruleForbidden")}
      </span>
    </div>
  );
}
