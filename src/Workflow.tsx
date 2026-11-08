// Phase 5: an OrderOrchestration order type as diagrams - how an order splits,
// what each sub-order triggers, what happens when they complete, and the
// status machine. Editing goes through the data tab's schema forms.
import dagre from "@dagrejs/dagre";
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
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import type { Focus } from "./DataView";
import { findingsFor } from "./graph";
import type { UserFile } from "./types";
import { readYaml } from "./yamlEdit";

const REPO = "OrderOrchestration-as-Code";
type Obj = Record<string, unknown>;

export interface OrderType {
  customer: string;
  channel: string;
  id: string;
  name: string;
  path: string; // order_type.yaml
  /** Imported files by name, as validate.py finds them: split_rules.yaml, status.yaml, ... */
  files: Record<string, string>;
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

/** Every order type in the data, with its imported files. */
export function findOrderTypes(files: UserFile[]): OrderType[] {
  const found: OrderType[] = [];
  for (const file of files) {
    const m = /^customers\/([^/]+)\/channels\/([^/]+)\/order_types\/([^/]+)\/order_type\.yaml$/.exec(file.path);
    if (file.repo !== REPO || !m) continue;
    const orderType = (readYaml(file.text).order_type ?? {}) as Obj;
    const dir = file.path.slice(0, file.path.lastIndexOf("/"));
    const imports = Array.isArray(orderType.imports) ? orderType.imports.map(String) : [];
    found.push({
      customer: m[1],
      channel: m[2],
      id: String(orderType.id ?? m[3]),
      name: String(orderType.name ?? m[3]),
      path: file.path,
      files: Object.fromEntries(imports.map((i) => [i.split("/").pop()!, normalize(`${dir}/${i}`)])),
    });
  }
  return found.sort((a, b) => `${a.customer}/${a.channel}/${a.id}`.localeCompare(`${b.customer}/${b.channel}/${b.id}`));
}

type Kind = "order" | "split" | "trigger" | "completion" | "action" | "status";
interface FlowItem {
  id: string; // node id
  kind: Kind;
  title: string;
  subtitle: string;
  entity?: Obj;
  /** Where the entry lives, for the form: file name and list key. */
  home?: [file: string, key: string];
  terminal?: boolean;
}
interface FlowLink {
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
}

const KIND_LABEL: Record<Kind, string> = {
  order: "Auftrag",
  split: "Split-Regel",
  trigger: "Workflow-Trigger",
  completion: "Abschlussregel",
  action: "Folgeaktion",
  status: "Status",
};
const QUANTIFIER: Record<string, string> = { all_children: "alle Teilaufträge", any_child: "ein Teilauftrag" };
const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : []);
const target = (t: unknown) => (t && typeof t === "object" ? `${(t as Obj).type} ${(t as Obj).id}` : "");

/** The order flow: order → split rules → triggers, split rules → completion rules → follow-up actions. */
function orderFlow(type: OrderType, read: (name: string) => Obj): { items: FlowItem[]; links: FlowLink[] } {
  const items: FlowItem[] = [{ id: "order", kind: "order", title: type.id, subtitle: `${type.name} · Kanal ${type.channel}` }];
  const links: FlowLink[] = [];
  const splits = list(read("split_rules.yaml").split_rules);
  for (const s of splits) {
    const when = s.when as Obj | undefined;
    const parts = [s.split_by && when?.dimension_value ? `${s.split_by} = ${when.dimension_value}` : String(s.condition ?? "")];
    if (s.target_override) parts.push(`Ziel ${target(s.target_override)}`);
    items.push({ id: `split:${s.id}`, kind: "split", title: String(s.id), subtitle: parts.join(" · "), entity: s, home: ["split_rules.yaml", "split_rules"] });
    links.push({ source: "order", target: `split:${s.id}` });
  }
  const has = (id: string) => items.some((i) => i.id === id);
  for (const t of list(read("workflow_triggers.yaml").workflow_triggers)) {
    items.push({ id: `trigger:${t.id}`, kind: "trigger", title: String(t.trigger), subtitle: String(t.id), entity: t, home: ["workflow_triggers.yaml", "workflow_triggers"] });
    const from = t.split_rule && has(`split:${t.split_rule}`) ? `split:${t.split_rule}` : "order";
    links.push({ source: from, target: `trigger:${t.id}`, label: "löst aus" });
  }
  for (const c of list(read("completion_rules.yaml").completion_rules)) {
    const when = (c.when ?? {}) as Obj;
    const action = (c.action ?? {}) as Obj;
    const cond = `wenn ${QUANTIFIER[String(when.quantifier)] ?? when.quantifier ?? ""} ${when.status ?? ""}${when.target_gap ? " mit Ziel-Lücke" : ""}`;
    items.push({ id: `completion:${c.id}`, kind: "completion", title: String(c.id), subtitle: cond.trim(), entity: c, home: ["completion_rules.yaml", "completion_rules"] });
    const sources = Array.isArray(when.source_split_rules) ? when.source_split_rules.map(String).filter((s) => has(`split:${s}`)) : [];
    for (const s of sources.length ? sources : []) links.push({ source: `split:${s}`, target: `completion:${c.id}`, dashed: true });
    if (!sources.length) links.push({ source: "order", target: `completion:${c.id}`, dashed: true });
    const what =
      action.type === "spawn_order"
        ? `neuer Auftrag ${action.spawn_order_type ?? ""}${action.spawn_target ? ` → ${target(action.spawn_target)}` : ""}${action.supersedes_parent ? " · ersetzt den Auftrag" : ""}`
        : action.type === "reallocate_remainder"
          ? `Rest neu zuteilen als ${action.reallocate_order_type ?? ""}`
          : String(action.type ?? "");
    items.push({ id: `action:${c.id}`, kind: "action", title: String(action.type ?? "Aktion"), subtitle: what, entity: c, home: ["completion_rules.yaml", "completion_rules"] });
    links.push({ source: `completion:${c.id}`, target: `action:${c.id}` });
  }
  return { items, links };
}

/** The status machine: statuses and their allowed transitions. */
function statusFlow(read: (name: string) => Obj): { items: FlowItem[]; links: FlowLink[] } {
  const data = read("status.yaml");
  const items: FlowItem[] = list(data.statuses).map((s) => ({
    id: `status:${s.id}`, kind: "status", title: String(s.id), subtitle: s.terminal ? "Endstatus" : "", entity: s,
    home: ["status.yaml", "statuses"], terminal: s.terminal === true,
  }));
  const links = list(data.transitions).map((t) => ({ source: `status:${t.from}`, target: `status:${t.to}` }));
  return { items, links };
}

const SIZE: Record<Kind, [number, number]> = {
  order: [200, 58], split: [230, 58], trigger: [170, 50], completion: [230, 58], action: [250, 58], status: [140, 44],
};

function layout(items: FlowItem[], links: FlowLink[], rankdir: "LR" | "TB"): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, nodesep: 24, ranksep: rankdir === "LR" ? 70 : 50, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const item of items) g.setNode(item.id, { width: SIZE[item.kind][0], height: SIZE[item.kind][1] });
  for (const link of links) if (g.hasNode(link.source) && g.hasNode(link.target)) g.setEdge(link.source, link.target);
  dagre.layout(g);
  return new Map(items.map((i) => {
    const n = g.node(i.id);
    return [i.id, { x: n.x - n.width / 2, y: n.y - n.height / 2 }];
  }));
}

type FlowData = { item: FlowItem; findings: string[] };

function FlowNode({ data, selected }: NodeProps<Node<FlowData>>) {
  const { item, findings } = data;
  const [w, h] = SIZE[item.kind];
  return (
    <div
      className={`topo-node flow-${item.kind}${item.terminal ? " terminal" : ""}${selected ? " selected" : ""}${findings.length ? " has-findings" : ""}`}
      style={{ width: w, height: h }}
      data-flow={item.id}
    >
      <Handle type="target" position={Position.Left} />
      <div className="topo-id">{item.title}</div>
      {item.subtitle && <div className="topo-sub" title={item.subtitle}>{item.subtitle}</div>}
      {findings.length > 0 && <span className="topo-flag" title="Befunde aus der Prüfung">{findings.length}</span>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { flow: FlowNode };

function Diagram({ items, links, rankdir, findings, selected, onSelect, height }: {
  items: FlowItem[];
  links: FlowLink[];
  rankdir: "LR" | "TB";
  findings: string[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  height: number;
}) {
  const positions = useMemo(() => layout(items, links, rankdir), [items, links, rankdir]);
  const [flow, setFlow] = useState<ReactFlowInstance<Node<FlowData>> | null>(null);
  // Fit once the nodes are in React Flow's store, and again whenever the rules change.
  useEffect(() => {
    if (!flow) return;
    let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(() => flow.fitView({ padding: 0.08, maxZoom: 1.2 }))));
    return () => cancelAnimationFrame(frame);
  }, [flow, positions]);
  const nodes = useMemo<Node<FlowData>[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        type: "flow",
        position: positions.get(item.id)!,
        width: SIZE[item.kind][0],
        height: SIZE[item.kind][1],
        data: { item, findings: item.entity && item.kind !== "action" ? findingsFor(String(item.entity.id ?? ""), findings) : [] },
        selected: item.id === selected,
      })),
    [items, positions, findings, selected],
  );
  const edges = useMemo<Edge[]>(
    () =>
      links
        .filter((l) => positions.has(l.source) && positions.has(l.target))
        .map((l, i) => ({
          id: `${i}:${l.source}->${l.target}`,
          source: l.source,
          target: l.target,
          label: l.label,
          style: { stroke: "var(--muted)", strokeWidth: 1.5, strokeDasharray: l.dashed ? "6 4" : undefined },
          labelStyle: { fill: "var(--muted)", fontSize: 11 },
          labelBgStyle: { fill: "var(--surface)" },
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        })),
    [links, positions],
  );
  return (
    <div className="topo-canvas" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        onInit={setFlow}
        onNodeClick={(_, n) => onSelect(n.id)}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/** The order types of the data as flow and status diagrams; editing opens the data tab's forms. */
export function WorkflowView({ files, findings, onOpen, busy }: {
  files: UserFile[];
  findings: string[];
  onOpen: (focus: Focus) => void;
  busy: boolean;
}) {
  const types = useMemo(() => findOrderTypes(files), [files]);
  const [path, setPath] = useState<string>(() => types[0]?.path ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const type = types.find((t) => t.path === path) ?? types[0];
  const texts = useMemo(() => new Map(files.filter((f) => f.repo === REPO).map((f) => [f.path, f.text])), [files]);
  const read = useMemo(() => (name: string): Obj => {
    const p = type?.files[name];
    try {
      return p && texts.has(p) ? readYaml(texts.get(p)!) : {};
    } catch {
      return {};
    }
  }, [type, texts]);
  const flow = useMemo(() => (type ? orderFlow(type, read) : null), [type, read]);
  const status = useMemo(() => (type ? statusFlow(read) : null), [type, read]);

  if (!types.length || !type || !flow || !status) return <p className="status">In diesen Daten gibt es keine OrderOrchestration-Auftragsarten.</p>;
  const item = [...flow.items, ...status.items].find((i) => i.id === selected);
  const open = (file: string, key: string, id: string) => {
    const p = type.files[file];
    if (p) onOpen({ repo: REPO, path: p, key, id });
  };
  const shortage = read("shortage_policy.yaml").shortage_policy as Obj | undefined;
  const fields = read("fields.yaml").fields as Obj | undefined;

  return (
    <div className="workflow">
      <div className="topo-toolbar">
        <label>
          Auftragsart{" "}
          <select
            value={type.path}
            onChange={(e) => {
              setPath(e.target.value);
              setSelected(null);
            }}
          >
            {types.map((t) => (
              <option key={t.path} value={t.path}>{t.customer} / {t.channel} / {t.id}</option>
            ))}
          </select>
        </label>
        <div className="actions">
          {type.files["split_rules.yaml"] && (
            <button className="secondary" onClick={() => open("split_rules.yaml", "split_rules", "")} disabled={busy}>+ Split-Regel</button>
          )}
          {type.files["workflow_triggers.yaml"] && (
            <button className="secondary" onClick={() => open("workflow_triggers.yaml", "workflow_triggers", "")} disabled={busy}>+ Trigger</button>
          )}
          {type.files["completion_rules.yaml"] && (
            <button className="secondary" onClick={() => open("completion_rules.yaml", "completion_rules", "")} disabled={busy}>+ Abschlussregel</button>
          )}
        </div>
      </div>

      <div className="topo-main">
        <div className="workflow-diagrams">
          <h3>Ablauf</h3>
          <Diagram items={flow.items} links={flow.links} rankdir="LR" findings={findings} selected={selected} onSelect={setSelected} height={420} />
          <h3>Status</h3>
          <Diagram items={status.items} links={status.links} rankdir="LR" findings={findings} selected={selected} onSelect={setSelected} height={260} />
        </div>
        <aside className="topo-details">
          {item ? (
            <div data-flow-details={item.id}>
              <h3>{item.title}</h3>
              <p className="hint">{KIND_LABEL[item.kind]}</p>
              {item.entity && findingsFor(String(item.entity.id ?? ""), findings).length > 0 && (
                <FindingList items={findingsFor(String(item.entity.id), findings)} />
              )}
              {item.entity && <Attributes entity={item.entity} />}
              {item.home && item.entity && (
                <button onClick={() => open(item.home![0], item.home![1], String(item.entity!.id))} disabled={busy}>
                  Bearbeiten …
                </button>
              )}
              {item.kind === "order" && (
                <p className="hint">Split-Regeln teilen den Auftrag in Teilaufträge; Trigger übergeben sie ans Lager; Abschlussregeln entscheiden, was nach ihrem Abschluss passiert.</p>
              )}
            </div>
          ) : (
            <p className="hint">Einen Knoten anklicken, um seine Regel zu sehen und zu bearbeiten.</p>
          )}
          <h4>Fehlmengen</h4>
          {shortage ? <Attributes entity={shortage} /> : <p className="hint">keine shortage_policy</p>}
          {shortage && <button className="secondary" onClick={() => open("shortage_policy.yaml", "shortage_policy", "")} disabled={busy}>Fehlmengen-Regel bearbeiten …</button>}
          <h4>Felder</h4>
          {fields ? <Attributes entity={fields} /> : <p className="hint">keine fields</p>}
          {fields && <button className="secondary" onClick={() => open("fields.yaml", "fields", "")} disabled={busy}>Felder bearbeiten …</button>}
        </aside>
      </div>
      <div className="legend">
        {(["order", "split", "trigger", "completion", "action", "status"] as Kind[]).map((k) => (
          <span key={k} className="legend-item"><span className={`legend-node flow-${k}`} /> {KIND_LABEL[k]}</span>
        ))}
        <span className="legend-item"><span className="legend-line" style={{ borderTopColor: "var(--muted)", borderTopStyle: "dashed" }} /> Abschluss der Teilaufträge</span>
      </div>
    </div>
  );
}

function Attributes({ entity }: { entity: Obj }) {
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

/** A value as short text: lists joined, maps as "key: value; ...". */
function format(value: unknown): string {
  if (Array.isArray(value)) return value.map(format).join(", ");
  if (value && typeof value === "object") return Object.entries(value).map(([k, v]) => `${k}: ${format(v)}`).join("; ");
  return String(value);
}
