import { useEffect, useRef, useState } from "react";
import { ChecksView } from "./Checks";
import { assign, canPickDirectory, detectLayout, pickDirectory, scanFileList, type Scan } from "./folder";
import { TopologyView } from "./Topology";
import {
  REPOS,
  type Building,
  type CheckInfo,
  type CheckResult,
  type FromWorker,
  type RepoName,
  type SpecsInfo,
  type ToWorker,
  type UserFile,
} from "./types";

type Phase = "loading" | "ready" | "running" | "failed";
type Tab = "checks" | "topology";

export default function App() {
  const worker = useRef<Worker | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("Wird gestartet …");
  const [specs, setSpecs] = useState<{ repos: SpecsInfo; generatedAt: string } | null>(null);
  const [tab, setTab] = useState<Tab>("checks");
  // Data source: the repos' example data (scan === null) or an opened folder.
  const [scan, setScan] = useState<Scan | null>(null);
  const [chosen, setChosen] = useState<RepoName | "">("");
  const [source, setSource] = useState(0); // bumped whenever the data source changes
  const [checks, setChecks] = useState<CheckInfo[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [checkedSource, setCheckedSource] = useState(-1);
  const [topology, setTopology] = useState<{ source: number; buildings: Building[]; note?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const pendingSource = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === "status") setStatus(m.text);
      else if (m.type === "ready") {
        setSpecs({ repos: m.specs, generatedAt: m.generatedAt });
        setPhase("ready");
      } else if (m.type === "plan") setChecks(m.checks);
      else if (m.type === "result") setResults((r) => ({ ...r, [m.result.id]: m.result }));
      else if (m.type === "done") setPhase("ready");
      else if (m.type === "topology") {
        setTopology({ source: pendingSource.current, buildings: m.buildings });
        setPhase("ready");
      } else if (m.type === "error") {
        setStatus(m.message);
        setPhase("failed");
      }
    };
    w.postMessage({ type: "init", base: new URL(".", document.baseURI).href } satisfies ToWorker);
    return () => w.terminate();
  }, []);

  const layout = scan ? detectLayout(scan) : null;
  const unresolved = layout?.kind === "unknown" && !chosen;

  /** The opened folder's data, null for the example data, undefined if the folder has none. */
  function userFiles(): UserFile[] | null | undefined {
    if (!scan || !layout) return null;
    const files = assign(scan, layout, layout.kind === "unknown" ? chosen || undefined : undefined);
    if (files.length) return files;
    setNotice("In diesem Ordner liegen keine Daten. Erwartet werden die Ordner customers/, sites/ oder examples/ eines Repos.");
    return undefined;
  }

  function changeSource(next: Scan | null) {
    setScan(next);
    setChosen("");
    setChecks([]);
    setResults({});
    setTopology(null);
    setNotice("");
    setSource((s) => s + 1);
  }

  function runChecks() {
    const files = userFiles();
    if (files === undefined) return;
    setChecks([]);
    setResults({});
    setNotice("");
    setCheckedSource(source);
    setPhase("running");
    const repos = files ? [...new Set(files.map((f) => f.repo))] : [...REPOS];
    worker.current?.postMessage({ type: "run", repos, files } satisfies ToWorker);
  }

  function loadTopology() {
    const files = userFiles();
    if (files === undefined) {
      setTopology({ source, buildings: [], note: "Der Ordner enthält keine Daten." });
      return;
    }
    if (files && !files.some((f) => f.repo === "Topology-as-Code")) {
      setTopology({ source, buildings: [], note: "Der Ordner enthält keine Topology-as-Code-Daten." });
      return;
    }
    pendingSource.current = source;
    setPhase("running");
    worker.current?.postMessage({ type: "compile", files } satisfies ToWorker);
  }

  // The topology tab compiles on demand, once per data source.
  useEffect(() => {
    if (tab === "topology" && phase === "ready" && !unresolved && topology?.source !== source) loadTopology();
  });

  async function openFolder() {
    if (!canPickDirectory()) {
      folderInput.current?.click();
      return;
    }
    try {
      changeSource(await pickDirectory());
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setNotice(String((error as Error).message ?? error));
    }
  }

  async function onFileList(list: FileList | null) {
    if (list?.length) changeSource(await scanFileList(list));
  }

  const busy = phase !== "ready";
  const topologyFindings =
    checkedSource === source
      ? Object.values(results).filter((r) => r.repo === "Topology-as-Code").flatMap((r) => [...r.errors, ...r.warnings])
      : [];

  return (
    <div className="page">
      <header>
        <h1>Warehouse Designer</h1>
        <p className="lead">
          Zeigt und prüft Lagerdefinitionen aus Topology-, Allocation-, OrderOrchestration-, MasterData- und
          Warehouse-as-Code mit den Prüfregeln der Repos selbst. Ihre Dateien verlassen den Browser nicht.
        </p>
      </header>

      <section className="panel">
        <div className="source">
          <span>
            Daten: <strong data-source>{scan ? scan.rootName : "Beispieldaten der Repos"}</strong>
            {scan && layout && <span className="hint"> – {describe(layout)}</span>}
          </span>
          <div className="actions">
            <button onClick={openFolder} disabled={busy}>Ordner öffnen …</button>
            {scan && <button className="secondary" onClick={() => changeSource(null)} disabled={busy}>Beispieldaten verwenden</button>}
          </div>
          <input ref={folderInput} type="file" hidden {...{ webkitdirectory: "" }} onChange={(e) => onFileList(e.target.files)} />
        </div>
        {layout?.kind === "unknown" && (
          <label className="choose">
            Die Daten gehören zu{" "}
            <select value={chosen} onChange={(e) => { setChosen(e.target.value as RepoName); setSource((s) => s + 1); }}>
              <option value="">– Repo wählen –</option>
              {REPOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {phase === "loading" && <p className="status">{status}</p>}
        {phase === "failed" && <p className="status error">Fehler: {status}</p>}
        {notice && <p className="status error">{notice}</p>}
      </section>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "checks"} onClick={() => setTab("checks")}>Prüfen</button>
        <button role="tab" aria-selected={tab === "topology"} onClick={() => setTab("topology")}>Topologie</button>
      </nav>

      {tab === "checks" && (
        <>
          <button onClick={runChecks} disabled={busy || unresolved}>Prüfung starten</button>
          <ChecksView checks={checks} results={results} running={phase === "running"} />
        </>
      )}

      {tab === "topology" && (
        <section>
          {unresolved && <p className="status">Bitte oben wählen, zu welchem Repo die Daten gehören.</p>}
          {phase === "running" && !topology && <p className="status">Hallen werden kompiliert …</p>}
          {topology?.note && <p className="status">{topology.note}</p>}
          {topology && !topology.note && (
            <>
              {checkedSource !== source && (
                <p className="hint">Tipp: Nach „Prüfung starten“ werden Knoten mit Befunden hier rot markiert.</p>
              )}
              <TopologyView key={topology.source} buildings={topology.buildings} findings={topologyFindings} />
            </>
          )}
        </section>
      )}

      {specs && (
        <footer>
          Prüfregeln und Schemas vom {new Date(specs.generatedAt).toLocaleString("de-DE")}:{" "}
          {Object.entries(specs.repos).map(([name, info], i) => (
            <span key={name}>
              {i > 0 && " · "}
              {info.commit ? (
                <a href={`https://github.com/rhinos07/${name}/commit/${info.commit}`}>{name} {info.commit.slice(0, 7)}</a>
              ) : (
                name
              )}
            </span>
          ))}
        </footer>
      )}
    </div>
  );
}

function describe(layout: ReturnType<typeof detectLayout>): string {
  if (layout.kind === "workspace") return `enthält ${layout.repos.join(", ")}`;
  if (layout.kind === "repo") return `Daten von ${layout.repo}`;
  return "Repo unbekannt";
}
