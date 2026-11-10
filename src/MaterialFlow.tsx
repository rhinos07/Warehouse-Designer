// The material flow tab: stage 1 shows which moves a hall allows (physical
// path and movement rules), stage 2 runs a small simulation of load units on
// the topology diagram. See flow.ts and simulation.ts for what is modeled.
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, ViewportPortal, type Edge, type Node, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo, useState } from "react";
import { flowModel, inboundDoors, outboundDoors, reachability, storageTypes, workCenters, type FlowModel, type Link, type Move, type Verdict } from "./flow";
import { buildGraph, subtitle, type Graph, type TopoNode } from "./graph";
import { t, tl, useLang } from "./i18n";
import { prepareFlow, Simulation, type FlowSpec, type NodeStats, type PreparedFlow, type Snapshot } from "./simulation";
import { EDGE_COLOR } from "./Topology";
import type { Building } from "./types";

/** One color per flow, for its load units. */
const FLOW_COLORS = ["#2457c5", "#d9822b", "#2e8540", "#c2185b", "#7b4fd6", "#1f8a8a"];
const SPEEDS = [10, 60, 300, 1200];
const HOURS = 8;
const DEFAULT_PER_HOUR = 20;
/** The example the page opens with, if the data has it. */
const PREFERRED_HALL = "example_customer/pa11/hall_3";

export const clock = (seconds: number) => {
  const s = Math.floor(seconds);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const minutes = (seconds: number) => `${(seconds / 60).toFixed(1)} min`;
const percent = (share: number) => `${Math.round(share * 100)} %`;
/** From this utilization on, a station counts as a bottleneck and is marked red. */
const JAM = 0.85;

export function verdictText(v: Verdict): string {
  const base = v.rule ? t(`sim.verdict.${v.reason}`, { rule: v.rule }) : t(`sim.verdict.${v.reason}`);
  return v.partial ? `${base} ${t("sim.partial", { part: v.partial })}` : base;
}

export function pathText(move: Move): string {
  if (!move.path) return t("sim.noPath");
  const assumed = move.path.some((l) => l.assumed);
  return `${[move.from, ...move.path.map((l) => l.to)].join(" → ")} · ${minutes(move.seconds)}${assumed ? ` ${t("sim.assumed")}` : ""}`;
}

/** First flows for a hall: one inbound and one outbound flow that can run, if there are any. */
export function defaultFlows(model: FlowModel, rules: boolean): FlowSpec[] {
  const ok = (spec: FlowSpec) => !prepareFlow(model, spec, rules).problems.length;
  const types = storageTypes(model).map((n) => n.id);
  const flows: FlowSpec[] = [];
  let target: string | undefined;
  for (const door of inboundDoors(model)) {
    target = types.find((st) => ok({ from: door.id, to: st, perHour: 1 }));
    if (target) {
      flows.push({ from: door.id, to: target, perHour: DEFAULT_PER_HOUR });
      break;
    }
  }
  const sources = target ? [target, ...types.filter((st) => st !== target)] : types;
  outer: for (const st of sources) {
    for (const door of outboundDoors(model)) {
      for (const via of [...workCenters(model).map((w) => w.id), undefined]) {
        const spec = { from: st, via, to: door.id, perHour: DEFAULT_PER_HOUR };
        if (ok(spec)) {
          flows.push(spec);
          break outer;
        }
      }
    }
  }
  return flows;
}

type SimNodeData = { node: TopoNode; stats?: NodeStats; bottleneck: boolean; marked: boolean };

function SimNodeView({ data }: NodeProps<Node<SimNodeData>>) {
  const { node, stats, bottleneck, marked } = data;
  const badges: string[] = [];
  if (stats?.capacity !== undefined) badges.push(`${stats.stock}/${stats.capacity}`);
  if (stats && stats.utilization > 0) badges.push(percent(stats.utilization));
  return (
    <div
      className={`topo-node kind-${node.kind}${bottleneck ? " bottleneck" : ""}${marked ? " marked" : ""}`}
      style={{ width: node.width, height: node.height }}
      data-sim-node={node.id}
    >
      <Handle type="target" position={Position.Left} />
      <div className="topo-id">{node.id}</div>
      <div className="topo-sub">{badges.length ? badges.join(" · ") : subtitle(node)}</div>
      {stats && stats.queue > 0 && (
        <span className="sim-queue" title={t("sim.queueHint")} data-queue={stats.queue}>{stats.queue}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { sim: SimNodeView };

/** Where a load unit on a link is drawn: along the straight line of the diagram's edge. */
function locate(graph: Graph, link: Link, progress: number) {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const drawn = graph.can.find((e) => e.source === link.from && e.target === link.to)
    ?? graph.can.find((e) => e.both && e.source === link.to && e.target === link.from);
  const [s, d] = [byId.get(link.from), byId.get(link.to)];
  if (!s || !d) return null;
  const right = (n: TopoNode) => ({ x: n.x + n.width, y: n.y + n.height / 2 });
  const left = (n: TopoNode) => ({ x: n.x, y: n.y + n.height / 2 });
  let a = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
  let b = { x: d.x + d.width / 2, y: d.y + d.height / 2 };
  if (drawn && drawn.source === link.from) [a, b] = [right(s), left(d)];
  else if (drawn) [a, b] = [left(s), right(d)];
  const p = Math.min(1, Math.max(0, progress));
  return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p };
}

export function MaterialFlowView({ buildings }: { buildings: Building[] }) {
  const ok = buildings.filter((b) => b.ok);
  const [path, setPath] = useState(() => (ok.find((b) => b.dataset === PREFERRED_HALL) ?? ok[0])?.path);
  const building = ok.find((b) => b.path === path) ?? ok[0];
  const model = useMemo(() => (building ? flowModel(building) : null), [building]);
  const graph = useMemo(() => (building ? buildGraph(building) : null), [building]);
  const reach = useMemo(() => (model ? reachability(model) : null), [model]);

  const [rules, setRules] = useState(true);
  const [flows, setFlows] = useState<FlowSpec[]>(() => (model ? defaultFlows(model, true) : []));
  const [fill, setFill] = useState(50);
  const [seed, setSeed] = useState(1);
  const [speed, setSpeed] = useState(60);
  const [running, setRunning] = useState(false);
  const [resets, setResets] = useState(0);
  const [marked, setMarked] = useState<Move | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const lang = useLang();

  const sim = useMemo(
    () => (model && building ? new Simulation(model, building.point_counts ?? {}, { flows, rules, fill: fill / 100, seed }) : null),
    [model, building, flows, rules, fill, seed, resets],
  );
  useEffect(() => {
    setSnap(sim?.snapshot() ?? null);
    setRunning(false);
  }, [sim]);

  // Playback: advance the simulated clock by `speed` seconds per real second.
  useEffect(() => {
    if (!running || !sim) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      sim.advance(sim.now + (Math.min(250, now - last) / 1000) * speed);
      last = now;
      setSnap(sim.snapshot());
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [running, sim, speed]);

  function changeHall(next: string) {
    const b = ok.find((x) => x.path === next);
    setPath(next);
    setMarked(null);
    setFlows(b ? defaultFlows(flowModel(b), rules) : []);
  }
  function runHours() {
    if (!sim) return;
    setRunning(false);
    sim.advance(sim.now + HOURS * 3600);
    setSnap(sim.snapshot());
  }
  const updateFlow = (i: number, change: Partial<FlowSpec>) => setFlows(flows.map((f, j) => (j === i ? { ...f, ...change } : f)));

  const prepared = sim?.flows ?? [];
  const usedLinks = useMemo(() => new Set(prepared.flatMap((f) => f.links.map((l) => l.id))), [prepared]);
  const markedLinks = useMemo(() => new Set(marked?.path?.map((l) => l.id) ?? []), [marked]);
  const markedNodes = useMemo(() => new Set(marked?.path ? [marked.from, ...marked.path.map((l) => l.to)] : []), [marked]);

  const flowNodes = useMemo<Node<SimNodeData>[]>(
    () =>
      graph?.nodes.map((n) => ({
        id: n.id,
        type: "sim",
        position: { x: n.x, y: n.y },
        width: n.width,
        height: n.height,
        data: { node: n, stats: snap?.nodes.get(n.id), bottleneck: jammed(snap) === n.id, marked: markedNodes.has(n.id) },
        connectable: false,
      })) ?? [],
    [graph, snap, markedNodes, lang],
  );
  const flowEdges = useMemo<Edge[]>(() => {
    if (!graph || !model) return [];
    const linkIds = (from: string, to: string) => model.links.filter((l) => (l.from === from && l.to === to) || (l.from === to && l.to === from)).map((l) => l.id);
    return graph.can.map((e) => {
      const ids = linkIds(e.source, e.target).filter((id) => id.startsWith(`${e.sourceType}:${e.entityId}:`));
      const used = ids.some((id) => usedLinks.has(id));
      const isMarked = ids.some((id) => markedLinks.has(id));
      const busy = snap?.links.get(e.entityId);
      const jam = jammed(snap) === e.entityId;
      const color = jam ? EDGE_COLOR.forbidden : (EDGE_COLOR[e.mode ?? ""] ?? "#8a94a3");
      const marker = { type: MarkerType.ArrowClosed, color, width: 16, height: 16 };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "straight",
        label: busy && busy.utilization > 0 ? `${tl("mode", e.mode ?? "")} · ${percent(busy.utilization)}` : tl("mode", e.mode ?? ""),
        style: {
          stroke: color,
          strokeWidth: isMarked ? 5 : jam ? 4 : 2,
          opacity: used || isMarked ? 1 : 0.3,
          strokeDasharray: e.mode === "controller_internal" ? "6 4" : undefined,
        },
        labelStyle: { fill: color, fontSize: 11 },
        labelBgStyle: { fill: "var(--surface)" },
        markerEnd: marker,
        markerStart: e.both ? marker : undefined,
      };
    });
  }, [graph, model, usedLinks, markedLinks, snap, lang]);

  if (!building || !model || !graph || !reach) return <p className="status">{t("topology.noHalls")}</p>;
  const hours = (snap?.now ?? 0) / 3600;
  const sources = [...inboundDoors(model), ...storageTypes(model)].map((n) => n.id);
  const targets = [...storageTypes(model), ...outboundDoors(model)].map((n) => n.id);
  const vias = [...workCenters(model), ...storageTypes(model)].map((n) => n.id);
  const onFlows = new Set(prepared.flatMap((f) => f.nodes));
  const busyNodes = snap ? [...snap.nodes.values()].filter((n) => onFlows.has(n.id) || n.maxQueue) : [];
  const jam = snap?.bottleneck && snap.bottleneck.utilization >= JAM ? snap.bottleneck.id : undefined;

  return (
    <div className="topology simulation" data-sim-hall={building.dataset ?? building.path}>
      <p className="hint">{t("sim.intro", { hours: HOURS })}</p>
      <div className="topo-toolbar">
        <label>
          {t("topology.hall")}{" "}
          <select value={building.path} onChange={(e) => changeHall(e.target.value)}>
            {ok.map((b) => (
              <option key={b.path} value={b.path}>{`${b.customer} / ${b.facility} / ${b.name ?? b.building}`}</option>
            ))}
          </select>
        </label>
        <label title={t("sim.rulesHint")}>
          <input type="checkbox" checked={rules} onChange={(e) => setRules(e.target.checked)} data-sim-rules /> {t("sim.rules")}
        </label>
      </div>

      <h3>{t("sim.flowsTitle")}</h3>
      <table className="sim-table sim-flows">
        <thead>
          <tr>
            <th />
            <th>{t("sim.from")}</th>
            <th>{t("sim.via")}</th>
            <th>{t("sim.to")}</th>
            <th>{t("sim.perHour")}</th>
            <th>{t("sim.state")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {flows.map((f, i) => (
            <tr key={i} data-sim-flow={i}>
              <td><span className="sim-dot" style={{ background: FLOW_COLORS[i % FLOW_COLORS.length] }} /></td>
              <td>
                <select value={f.from} onChange={(e) => updateFlow(i, { from: e.target.value })}>
                  {sources.map((id) => <option key={id}>{id}</option>)}
                </select>
              </td>
              <td>
                <select value={f.via ?? ""} onChange={(e) => updateFlow(i, { via: e.target.value || undefined })}>
                  <option value="">–</option>
                  {vias.map((id) => <option key={id}>{id}</option>)}
                </select>
              </td>
              <td>
                <select value={f.to} onChange={(e) => updateFlow(i, { to: e.target.value })}>
                  {targets.map((id) => <option key={id}>{id}</option>)}
                </select>
              </td>
              <td>
                <input type="number" min={0} max={2000} value={f.perHour} onChange={(e) => updateFlow(i, { perHour: Math.max(0, Number(e.target.value) || 0) })} />
              </td>
              <td><FlowState flow={prepared[i]} /></td>
              <td><button className="secondary" onClick={() => setFlows(flows.filter((_, j) => j !== i))}>{t("sim.remove")}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sim-controls">
        <button
          className="secondary"
          onClick={() => setFlows([...flows, { from: sources[0] ?? "", to: targets[0] ?? "", perHour: DEFAULT_PER_HOUR }])}
          disabled={!sources.length || !targets.length}
        >
          {t("sim.addFlow")}
        </button>
        <label>
          {t("sim.fill")}{" "}
          <input type="number" min={0} max={100} value={fill} onChange={(e) => setFill(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} /> %
        </label>
        <label title={t("sim.seedHint")}>
          {t("sim.seed")} <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
        </label>
      </div>

      <div className="sim-controls">
        <button onClick={() => setRunning(!running)} disabled={!sim} data-sim-play>{running ? t("sim.pause") : t("sim.start")}</button>
        <button className="secondary" onClick={runHours} disabled={!sim} data-sim-hours>{t("sim.runHours", { hours: HOURS })}</button>
        <button className="secondary" onClick={() => setResets(resets + 1)}>{t("sim.reset")}</button>
        <label>
          {t("sim.speed")}{" "}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <strong className="sim-clock" data-sim-clock>{t("sim.clock", { time: clock(snap?.now ?? 0) })}</strong>
      </div>

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
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            <ViewportPortal>
              {snap?.units.map((u) => {
                const at = locate(graph, u.link, u.progress);
                return at ? (
                  <span
                    key={u.id}
                    className="sim-unit"
                    style={{ transform: `translate(${at.x - 6}px, ${at.y - 6}px)`, background: FLOW_COLORS[u.flow % FLOW_COLORS.length] }}
                  />
                ) : null;
              })}
            </ViewportPortal>
          </ReactFlow>
        </div>
        <aside className="topo-details" data-sim-results>
          <h4>{t("sim.results")}</h4>
          <table className="sim-table">
            <thead>
              <tr>
                <th />
                <th title={t("sim.createdHint")}>{t("sim.created")}</th>
                <th>{t("sim.done")}</th>
                <th>{t("sim.throughput")}</th>
                <th>{t("sim.leadTime")}</th>
              </tr>
            </thead>
            <tbody>
              {snap?.flows.map((s, i) => (
                <tr key={i} data-sim-result={i}>
                  <td><span className="sim-dot" style={{ background: FLOW_COLORS[i % FLOW_COLORS.length] }} /></td>
                  <td>{s.created}{s.waitingToStart > 0 && <span className="forbidden" title={t("sim.waitingHint")}> ({s.waitingToStart})</span>}</td>
                  <td data-done={s.done}>{s.done}</td>
                  <td>{hours > 0 ? `${(s.done / hours).toFixed(1)}/h` : "–"}</td>
                  <td>{s.done ? minutes(s.leadTime / s.done) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint">{t("sim.waitingHint")}</p>
          <h4>{t("sim.bottleneck")}</h4>
          <p data-sim-bottleneck={jam ?? ""} className={jam ? "forbidden" : undefined}>
            {snap?.bottleneck
              ? t(jam ? "sim.bottleneckText" : "sim.busiestText", { id: snap.bottleneck.id, share: percent(snap.bottleneck.utilization) })
              : t("sim.noBottleneck")}
          </p>
          <h4>{t("sim.places")}</h4>
          {busyNodes.length ? (
            <table className="sim-table">
              <thead>
                <tr>
                  <th />
                  <th title={t("sim.queueHint")}>{t("sim.queue")}</th>
                  <th>{t("sim.utilization")}</th>
                  <th>{t("sim.stock")}</th>
                </tr>
              </thead>
              <tbody>
                {busyNodes.map((n) => (
                  <tr key={n.id}>
                    <th>{n.id}</th>
                    <td>{n.queue} ({n.maxQueue})</td>
                    <td>{n.served ? percent(n.utilization) : "–"}</td>
                    <td>{n.capacity !== undefined ? `${n.stock}/${n.capacity}` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="hint">{t("topology.none")}</p>
          )}
          <p className="hint">{t("sim.assumptions")}</p>
        </aside>
      </div>

      <h3>{t("sim.reachTitle")}</h3>
      <p className="hint">{t("sim.reachHint")}</p>
      <MoveTable title={t("sim.inbound")} moves={reach.inbound} marked={marked} onMark={setMarked} data="inbound" />
      <MoveTable title={t("sim.outbound")} moves={reach.outbound} marked={marked} onMark={setMarked} data="outbound" />
      {reach.unconnected.length > 0 && <p data-sim-unconnected>{t("sim.unconnected", { ids: reach.unconnected.join(", ") })}</p>}
      {reach.staging.map((s) => (
        <p key={s.door} data-sim-staging={s.door}>{t("sim.stagingGap", { door: s.door, section: s.section, type: s.storageType })}</p>
      ))}
    </div>
  );
}

const jammed = (snap: Snapshot | null) => (snap?.bottleneck && snap.bottleneck.utilization >= JAM ? snap.bottleneck.id : undefined);

function FlowState({ flow }: { flow?: PreparedFlow }) {
  if (!flow) return null;
  if (!flow.problems.length) {
    const seconds = flow.legs.reduce((s, l) => s + l.seconds, 0);
    return <span className="status ok" data-state="ok">{t("sim.flowOk", { time: minutes(seconds) })}</span>;
  }
  return (
    <span className="forbidden" data-state="problem">
      {flow.problems
        .map((p) => (p.problem === "no_path" ? t("sim.flowNoPath", { from: p.leg.from, to: p.leg.to }) : `${p.leg.from} → ${p.leg.to}: ${verdictText(p.leg.verdict)}`))
        .join("; ")}
    </span>
  );
}

function MoveTable({ title, moves, marked, onMark, data }: {
  title: string;
  moves: Move[];
  marked: Move | null;
  onMark: (move: Move | null) => void;
  data: string;
}) {
  if (!moves.length) return null;
  const possible = moves.filter((m) => m.path && m.verdict.allowed).length;
  return (
    <details className="sim-reach" open data-sim-reach={data}>
      <summary>{t("sim.reachSummary", { title, possible, total: moves.length })}</summary>
      <table className="sim-table">
        <thead>
          <tr>
            <th>{t("sim.from")}</th>
            <th>{t("sim.to")}</th>
            <th>{t("sim.physical")}</th>
            <th>{t("sim.byRules")}</th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => {
            const isMarked = marked?.from === m.from && marked.to === m.to;
            return (
              <tr
                key={`${m.from}>${m.to}`}
                className={`${isMarked ? "marked" : ""}${m.path ? " clickable" : ""}`}
                onClick={() => m.path && onMark(isMarked ? null : m)}
                data-move={`${m.from}>${m.to}`}
                data-path={m.path ? "yes" : "no"}
                data-allowed={m.verdict.allowed ? "yes" : "no"}
              >
                <td>{m.from}</td>
                <td>{m.to}</td>
                <td className={m.path ? "" : "forbidden"}>{pathText(m)}</td>
                <td className={m.verdict.allowed ? "" : "forbidden"}>{verdictText(m.verdict)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}
