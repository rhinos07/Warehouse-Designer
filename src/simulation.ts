// Material flow, stage 2: a small discrete-event simulation.
// Load units arrive at random (exponential gaps, seeded) for each flow, take
// the quickest physical path (see flow.ts) and wait where a capacity is used up:
// - a work center with throughput_capacity serves one load unit at a time,
//   3600 / throughput_capacity seconds each (the unit is read as load units);
// - a reporting point serves `capacity` load units at a time, REPORTING_SECONDS each;
// - a conveyor segment holds `capacity` load units at a time;
// - the main conveyor lets capacity_units_per_hour load units per hour enter,
//   shared by all its links;
// - a storage type holds as many load units as it has storage points. A flow
//   into it reserves a place before the load unit starts; a flow out of it
//   needs stock.
// Vehicles, people and travel inside a storage type are not modeled: manual
// links have no capacity limit. The numbers show where flow can jam, not a
// planned throughput.
import { move, type FlowModel, type Link, type Move } from "./flow";

export const REPORTING_SECONDS = 10;

export interface FlowSpec {
  from: string;
  /** An optional stop on the way, e.g. a packing work center. */
  via?: string;
  to: string;
  perHour: number;
}

export interface SimOptions {
  flows: FlowSpec[];
  /** Check the movement rules ("darf"); otherwise only the physical connections count. */
  rules: boolean;
  /** Share of storage points filled at the start, 0..1. */
  fill: number;
  seed: number;
}

/** Why a flow cannot run: a leg without a physical path, or one the rules forbid. */
export interface FlowProblem {
  leg: Move;
  problem: "no_path" | "forbidden";
}

export interface PreparedFlow {
  spec: FlowSpec;
  legs: Move[];
  problems: FlowProblem[];
  nodes: string[];
  links: Link[];
}

export function prepareFlow(model: FlowModel, spec: FlowSpec, rules: boolean): PreparedFlow {
  const stops = [spec.from, ...(spec.via ? [spec.via] : []), spec.to];
  const legs = stops.slice(1).map((to, i) => move(model, stops[i], to));
  const problems: FlowProblem[] = [];
  for (const leg of legs) {
    if (!leg.path) problems.push({ leg, problem: "no_path" });
    else if (rules && !leg.verdict.allowed) problems.push({ leg, problem: "forbidden" });
  }
  const links = problems.length ? [] : legs.flatMap((leg) => leg.path!);
  return { spec, legs, problems, links, nodes: problems.length ? [] : [spec.from, ...links.map((l) => l.to)] };
}

/** Deterministic random numbers (mulberry32). */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Event {
  time: number;
  seq: number;
  run: () => void;
}

/** A capacity: `capacity` load units at a time, and at most one start per `headway` seconds. */
class Resource {
  busy = 0;
  starts = 0;
  served = 0;
  busyTime = 0;
  private since = 0;
  private lastStart = -Infinity;
  private retry = false;
  readonly queue: { lu: Unit; grant: () => void }[] = [];
  constructor(
    private sim: Simulation,
    readonly capacity: number,
    readonly headway = 0,
  ) {}
  private account() {
    this.busyTime += this.busy * (this.sim.now - this.since);
    this.since = this.sim.now;
  }
  request(lu: Unit, grant: () => void) {
    this.queue.push({ lu, grant });
    this.next();
  }
  release() {
    this.account();
    this.busy--;
    this.served++;
    this.next();
  }
  private next() {
    while (this.queue.length && this.busy < this.capacity) {
      const ready = this.lastStart + this.headway;
      if (this.sim.now < ready) {
        if (!this.retry) {
          this.retry = true;
          this.sim.at(ready, () => {
            this.retry = false;
            this.next();
          });
        }
        return;
      }
      const { grant } = this.queue.shift()!;
      this.account();
      this.busy++;
      this.starts++;
      this.lastStart = this.sim.now;
      grant();
    }
  }
  utilization(elapsed: number): number {
    if (elapsed <= 0) return 0;
    this.account();
    const byCapacity = Number.isFinite(this.capacity) ? this.busyTime / (this.capacity * elapsed) : 0;
    const byHeadway = this.headway ? (this.starts * this.headway) / elapsed : 0;
    return Math.min(1, Math.max(byCapacity, byHeadway));
  }
}

/** A storage type's places and stock. */
class Store {
  /** Load units physically there. */
  present: number;
  /** Places reserved by load units on their way in. */
  incoming = 0;
  /** Load units there that a flow has already claimed. */
  claimed = 0;
  readonly waitSpace: (() => void)[] = [];
  readonly waitStock: (() => void)[] = [];
  constructor(readonly capacity: number, fill: number) {
    this.present = Number.isFinite(capacity) ? Math.round(capacity * fill) : 0;
  }
  get free() {
    return this.capacity - this.present - this.incoming;
  }
  get available() {
    return this.present - this.claimed;
  }
  reserveSpace(grant: () => void) {
    if (!this.waitSpace.length && this.free > 0) {
      this.incoming++;
      grant();
    } else this.waitSpace.push(grant);
  }
  claimStock(grant: () => void) {
    if (!this.waitStock.length && this.available > 0) {
      this.claimed++;
      grant();
    } else this.waitStock.push(grant);
  }
  arrive() {
    this.incoming--;
    this.present++;
    while (this.waitStock.length && this.available > 0) {
      this.claimed++;
      this.waitStock.shift()!();
    }
  }
  leave() {
    this.claimed--;
    this.present--;
    while (this.waitSpace.length && this.free > 0) {
      this.incoming++;
      this.waitSpace.shift()!();
    }
  }
}

export interface Unit {
  id: number;
  flow: number;
  created: number;
  /** Index into the flow's nodes: where the load unit is, or the node it left on its current link. */
  at: number;
  /** On a link: when it entered and when it arrives. */
  travel?: { link: Link; start: number; end: number };
  /** Waiting at its node, e.g. for a work center, a conveyor, stock or space. */
  waiting?: "start" | "node" | "link";
}

export interface FlowStats {
  created: number;
  done: number;
  leadTime: number; // sum, seconds
  /** Load units still waiting to start: no stock or no free place at the target. */
  waitingToStart: number;
}

export interface NodeStats {
  id: string;
  queue: number;
  maxQueue: number;
  served: number;
  utilization: number;
  stock?: number;
  capacity?: number;
}

export interface Snapshot {
  now: number;
  units: { id: number; flow: number; link: Link; progress: number }[];
  flows: FlowStats[];
  nodes: Map<string, NodeStats>;
  links: Map<string, { utilization: number; queue: number }>;
  /** The node or link resource with the highest utilization, if it is busy at all. */
  bottleneck?: { id: string; utilization: number };
}

export class Simulation {
  now = 0;
  readonly flows: PreparedFlow[];
  private events: Event[] = [];
  private seq = 0;
  private units = new Map<number, Unit>();
  private nextId = 1;
  private rand: () => number;
  private servers = new Map<string, { resource: Resource; seconds: number }>();
  private conveyors = new Map<string, Resource>();
  private stores = new Map<string, Store>();
  private stats: FlowStats[];
  /** Load units waiting at each node, now and at most. */
  private queues = new Map<string, { now: number; max: number }>();

  constructor(model: FlowModel, pointCounts: Record<string, number>, options: SimOptions) {
    this.rand = random(options.seed);
    this.flows = options.flows.map((spec) => prepareFlow(model, spec, options.rules));
    this.stats = this.flows.map(() => ({ created: 0, done: 0, leadTime: 0, waitingToStart: 0 }));
    for (const node of model.nodes.values()) {
      const e = node.entity;
      if (node.kind === "storage_type") this.stores.set(node.id, new Store(pointCounts[node.id] ?? Infinity, options.fill));
      if (node.kind === "work_center" && typeof e?.throughput_capacity === "number" && e.throughput_capacity > 0) {
        this.servers.set(node.id, { resource: new Resource(this, 1), seconds: 3600 / e.throughput_capacity });
      }
      if (node.kind === "reporting_point" && typeof e?.capacity === "number" && e.capacity > 0) {
        this.servers.set(node.id, { resource: new Resource(this, e.capacity), seconds: REPORTING_SECONDS });
      }
    }
    for (const link of model.links) {
      if (this.conveyors.has(link.resource) || (!link.capacity && !link.perHour)) continue;
      this.conveyors.set(link.resource, new Resource(this, link.capacity ?? Infinity, link.perHour ? 3600 / link.perHour : 0));
    }
    this.flows.forEach((flow, index) => {
      if (!flow.problems.length && flow.spec.perHour > 0) this.arrival(index);
    });
  }

  at(time: number, run: () => void) {
    const event = { time, seq: this.seq++, run };
    // Binary heap on (time, seq).
    const heap = this.events;
    heap.push(event);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(heap[i], heap[parent])) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  }

  private pop(): Event | undefined {
    const heap = this.events;
    const top = heap[0];
    const last = heap.pop();
    if (heap.length && last) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < heap.length && before(heap[l], heap[m])) m = l;
        if (r < heap.length && before(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  }

  /** Runs every event up to `time` and sets the clock to it. */
  advance(time: number) {
    while (this.events.length && this.events[0].time <= time) {
      const event = this.pop()!;
      this.now = event.time;
      event.run();
    }
    this.now = Math.max(this.now, time);
  }

  private arrival(index: number) {
    const mean = 3600 / this.flows[index].spec.perHour;
    this.at(this.now - mean * Math.log(1 - this.rand()), () => {
      this.create(index);
      this.arrival(index);
    });
  }

  private create(index: number) {
    const flow = this.flows[index];
    const lu: Unit = { id: this.nextId++, flow: index, created: this.now, at: 0 };
    this.units.set(lu.id, lu);
    this.stats[index].created++;
    this.stats[index].waitingToStart++;
    this.hold(lu, "start");
    const source = this.stores.get(flow.spec.from);
    const target = this.stores.get(flow.spec.to);
    const go = () => {
      this.stats[index].waitingToStart--;
      this.release(lu);
      this.step(lu);
    };
    const withSpace = () => (target ? target.reserveSpace(go) : go());
    if (source) source.claimStock(withSpace);
    else withSpace();
  }

  /** The load unit is at node lu.at: be served there (not at the start), then travel on or finish. */
  private step(lu: Unit) {
    const flow = this.flows[lu.flow];
    const node = flow.nodes[lu.at];
    const server = lu.at > 0 ? this.servers.get(node) : undefined;
    if (server) {
      this.hold(lu, "node");
      server.resource.request(lu, () => {
        this.release(lu);
        this.at(this.now + server.seconds, () => {
          server.resource.release();
          this.onward(lu);
        });
      });
    } else this.onward(lu);
  }

  private onward(lu: Unit) {
    const flow = this.flows[lu.flow];
    if (lu.at === flow.links.length) {
      this.stores.get(flow.spec.to)?.arrive();
      const stats = this.stats[lu.flow];
      stats.done++;
      stats.leadTime += this.now - lu.created;
      this.units.delete(lu.id);
      return;
    }
    const link = flow.links[lu.at];
    const conveyor = this.conveyors.get(link.resource);
    const enter = () => {
      this.release(lu);
      if (lu.at === 0) this.stores.get(flow.spec.from)?.leave();
      lu.travel = { link, start: this.now, end: this.now + link.seconds };
      this.at(lu.travel.end, () => {
        lu.travel = undefined;
        conveyor?.release();
        lu.at++;
        this.step(lu);
      });
    };
    if (conveyor) {
      this.hold(lu, "link");
      conveyor.request(lu, enter);
    } else enter();
  }

  private hold(lu: Unit, why: NonNullable<Unit["waiting"]>) {
    const node = this.flows[lu.flow].nodes[lu.at];
    let q = this.queues.get(node);
    if (!q) this.queues.set(node, (q = { now: 0, max: 0 }));
    q.now++;
    q.max = Math.max(q.max, q.now);
    lu.waiting = why;
  }

  private release(lu: Unit) {
    if (!lu.waiting) return;
    this.queues.get(this.flows[lu.flow].nodes[lu.at])!.now--;
    lu.waiting = undefined;
  }

  snapshot(): Snapshot {
    const elapsed = this.now;
    const nodes = new Map<string, NodeStats>();
    const stat = (id: string) => {
      let s = nodes.get(id);
      if (!s) nodes.set(id, (s = { id, queue: 0, maxQueue: 0, served: 0, utilization: 0 }));
      return s;
    };
    for (const [id, { resource }] of this.servers) {
      Object.assign(stat(id), { served: resource.served, utilization: resource.utilization(elapsed) });
    }
    for (const [id, q] of this.queues) Object.assign(stat(id), { queue: q.now, maxQueue: q.max });
    for (const [id, store] of this.stores) {
      if (Number.isFinite(store.capacity)) Object.assign(stat(id), { stock: store.present, capacity: store.capacity });
    }
    const units: Snapshot["units"] = [];
    for (const lu of this.units.values()) {
      if (lu.travel) {
        const { link, start, end } = lu.travel;
        units.push({ id: lu.id, flow: lu.flow, link, progress: end > start ? (this.now - start) / (end - start) : 1 });
      }
    }
    const links = new Map<string, { utilization: number; queue: number }>();
    for (const [id, conveyor] of this.conveyors) links.set(id, { utilization: conveyor.utilization(elapsed), queue: conveyor.queue.length });
    let bottleneck: Snapshot["bottleneck"];
    const consider = (id: string, utilization: number) => {
      if (utilization > 0.05 && (!bottleneck || utilization > bottleneck.utilization)) bottleneck = { id, utilization };
    };
    for (const [id, s] of nodes) consider(id, s.utilization);
    for (const [id, l] of links) consider(id, l.utilization);
    return { now: this.now, units, flows: this.stats.map((s) => ({ ...s })), nodes, links, bottleneck };
  }
}

const before = (a: Event, b: Event) => a.time < b.time || (a.time === b.time && a.seq < b.seq);
