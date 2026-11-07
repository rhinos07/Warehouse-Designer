import { useEffect, useMemo, useRef, useState } from "react";
import { ChangesView, type ChangedFile } from "./Changes";
import { ChecksView } from "./Checks";
import type { Change, Files } from "./editor";
import { assign, canPickDirectory, detectLayout, pickDirectory, scanFileList, writeFiles, type Scan } from "./folder";
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
const TOPOLOGY: RepoName = "Topology-as-Code";

/** One edit: a file's new text, keyed `<repo>/<path>`. */
interface Edit {
  key: string;
  text: string;
  summary: string;
}

const keyOf = (f: { repo: string; path: string }) => `${f.repo}/${f.path}`;

export default function App() {
  const worker = useRef<Worker | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("Wird gestartet …");
  const [specs, setSpecs] = useState<{ repos: SpecsInfo; generatedAt: string } | null>(null);
  const [examples, setExamples] = useState<UserFile[]>([]);
  const [tab, setTab] = useState<Tab>("checks");
  // Data source: the repos' example data (scan === null) or an opened folder.
  const [scan, setScan] = useState<Scan | null>(null);
  const [chosen, setChosen] = useState<RepoName | "">("");
  const [source, setSource] = useState(0); // bumped whenever the data source changes
  const [edits, setEdits] = useState<Edit[]>([]);
  const [version, setVersion] = useState(0); // bumped whenever the data changes: source or edits
  const [checks, setChecks] = useState<CheckInfo[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [checkedVersion, setCheckedVersion] = useState(-1);
  const [topology, setTopology] = useState<{ version: number; buildings: Building[]; checks?: CheckResult[]; note?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState("");
  const pendingVersion = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === "status") setStatus(m.text);
      else if (m.type === "ready") {
        setSpecs({ repos: m.specs, generatedAt: m.generatedAt });
        setExamples(m.examples);
        setPhase("ready");
      } else if (m.type === "plan") setChecks(m.checks);
      else if (m.type === "result") setResults((r) => ({ ...r, [m.result.id]: m.result }));
      else if (m.type === "done") setPhase("ready");
      else if (m.type === "topology") {
        setTopology({ version: pendingVersion.current, buildings: m.buildings, checks: m.checks });
        setPhase("ready");
      } else if (m.type === "error") {
        setStatus(m.message);
        setPhase("failed");
      }
    };
    w.postMessage({ type: "init", base: new URL(".", document.baseURI).href } satisfies ToWorker);
    return () => w.terminate();
  }, []);

  // Leaving the page drops unsaved edits; let the browser ask first.
  useEffect(() => {
    if (!edits.length) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edits.length]);

  const layout = scan ? detectLayout(scan) : null;
  const unresolved = layout?.kind === "unknown" && !chosen;

  /** The data as read: the opened folder's, or the example data; empty if the folder has none. */
  const base = useMemo<UserFile[]>(() => {
    if (!scan || !layout) return examples;
    return assign(scan, layout, layout.kind === "unknown" ? chosen || undefined : undefined);
  }, [scan, chosen, examples]);
  const overrides = useMemo(() => new Map(edits.map((e) => [e.key, e.text])), [edits]);
  /** The data with the unsaved edits applied. */
  const current = useMemo(() => base.map((f) => (overrides.has(keyOf(f)) ? { ...f, text: overrides.get(keyOf(f))! } : f)), [base, overrides]);
  const topologyFiles = useMemo<Files>(
    () => Object.fromEntries(current.filter((f) => f.repo === TOPOLOGY).map((f) => [f.path, f.text])),
    [current],
  );
  const changed = useMemo<ChangedFile[]>(
    () =>
      base
        .filter((f) => overrides.has(keyOf(f)) && overrides.get(keyOf(f)) !== f.text)
        .map((f) => ({ path: keyOf(f), before: f.text, after: overrides.get(keyOf(f))! })),
    [base, overrides],
  );

  function files(): UserFile[] | undefined {
    if (current.length) return current;
    setNotice("In diesem Ordner liegen keine Daten. Erwartet werden die Ordner customers/, sites/ oder examples/ eines Repos.");
    return undefined;
  }

  function changeSource(next: Scan | null) {
    if (edits.length && !window.confirm("Ungespeicherte Änderungen verwerfen?")) return;
    setScan(next);
    setChosen("");
    setEdits([]);
    setChecks([]);
    setResults({});
    setTopology(null);
    setNotice("");
    setSaved("");
    setSource((s) => s + 1);
    setVersion((v) => v + 1);
  }

  function changeData(next: Edit[]) {
    setEdits(next);
    setSaved("");
    setVersion((v) => v + 1);
  }

  function runChecks() {
    const data = files();
    if (!data) return;
    setChecks([]);
    setResults({});
    setNotice("");
    setCheckedVersion(version);
    setPhase("running");
    worker.current?.postMessage({ type: "run", repos: [...new Set(data.map((f) => f.repo))], files: data } satisfies ToWorker);
  }

  function loadTopology() {
    if (!current.length) {
      setTopology({ version, buildings: [], note: "Der Ordner enthält keine Daten." });
      return;
    }
    if (!current.some((f) => f.repo === TOPOLOGY)) {
      setTopology({ version, buildings: [], note: "Der Ordner enthält keine Topology-as-Code-Daten." });
      return;
    }
    // After an edit, also validate the edited customers, so the diagram shows the result at once.
    const validate = [...new Set(edits.filter((e) => e.key.startsWith(`${TOPOLOGY}/customers/`)).map((e) => e.key.split("/")[2]))];
    pendingVersion.current = version;
    setPhase("running");
    worker.current?.postMessage({ type: "compile", files: current, validate } satisfies ToWorker);
  }

  // The topology tab compiles on demand, once per data version.
  useEffect(() => {
    if (tab === "topology" && phase === "ready" && !unresolved && topology?.version !== version) loadTopology();
  });

  async function openFolder() {
    if (!canPickDirectory()) {
      folderInput.current?.click();
      return;
    }
    try {
      const next = await pickDirectory();
      changeSource(next);
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setNotice(String((error as Error).message ?? error));
    }
  }

  async function onFileList(list: FileList | null) {
    if (list?.length) changeSource(await scanFileList(list));
  }

  async function save() {
    if (!scan?.handle) return;
    const targets = base.filter((f) => overrides.has(keyOf(f)) && overrides.get(keyOf(f)) !== f.text && f.source);
    try {
      await writeFiles(scan.handle, targets.map((f) => ({ path: f.source!, text: overrides.get(keyOf(f))!, expected: f.text })));
      const written = new Map(targets.map((f) => [f.source!, overrides.get(keyOf(f))!]));
      setScan({ ...scan, files: scan.files.map((f) => (written.has(f.path) ? { ...f, text: written.get(f.path)! } : f)) });
      setEdits([]); // same data as before, now saved: no new version
      setNotice("");
      setSaved(`${targets.length} Datei${targets.length === 1 ? "" : "en"} im Ordner „${scan.rootName}“ gespeichert.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function applyChange(change: Change) {
    changeData([...edits, { key: `${TOPOLOGY}/${change.path}`, text: change.text, summary: change.summary }]);
  }

  const busy = phase !== "ready";
  const checkFindings = (list: CheckResult[]) =>
    list.filter((r) => r.repo === TOPOLOGY).flatMap((r) => [...r.errors, ...r.warnings]);
  const topologyFindings = topology?.checks
    ? checkFindings(topology.checks)
    : checkedVersion === version
      ? checkFindings(Object.values(results))
      : [];

  return (
    <div className="page">
      <header>
        <h1>Warehouse Designer</h1>
        <p className="lead">
          Zeigt, prüft und bearbeitet Lagerdefinitionen aus Topology-, Allocation-, OrderOrchestration-, MasterData- und
          Warehouse-as-Code mit den Prüfregeln der Repos selbst. Ihre Dateien verlassen den Browser nicht.
        </p>
      </header>

      <section className="panel">
        <div className="source">
          <span>
            Daten: <strong data-source>{scan ? scan.rootName : "Beispieldaten der Repos"}</strong>
            {scan && layout && <span className="hint"> – {describe(layout)}</span>}
            {scan && !scan.handle && <span className="hint"> (nur lesen)</span>}
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
            <select
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value as RepoName);
                setSource((s) => s + 1);
                setVersion((v) => v + 1);
              }}
            >
              <option value="">– Repo wählen –</option>
              {REPOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {phase === "loading" && <p className="status">{status}</p>}
        {phase === "failed" && <p className="status error">Fehler: {status}</p>}
        {notice && <p className="status error">{notice}</p>}
        {saved && <p className="status ok" data-saved>{saved}</p>}
      </section>

      <ChangesView
        files={changed}
        log={edits.map((e) => e.summary)}
        busy={busy}
        saveLabel={scan?.handle ? "In Ordner speichern" : undefined}
        onSave={save}
        onUndo={() => changeData(edits.slice(0, -1))}
        onDiscard={() => window.confirm("Alle ungespeicherten Änderungen verwerfen?") && changeData([])}
      />

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "checks"} onClick={() => setTab("checks")}>Prüfen</button>
        <button role="tab" aria-selected={tab === "topology"} onClick={() => setTab("topology")}>Topologie</button>
      </nav>

      {tab === "checks" && (
        <>
          <button onClick={runChecks} disabled={busy || unresolved}>Prüfung starten</button>
          {edits.length > 0 && <span className="hint"> Geprüft wird mit den ungespeicherten Änderungen.</span>}
          {checks.length > 0 && checkedVersion !== version && (
            <p className="hint">Die Daten haben sich seit dieser Prüfung geändert.</p>
          )}
          <ChecksView checks={checks} results={results} running={phase === "running"} />
        </>
      )}

      {tab === "topology" && (
        <section data-topology={topology?.version === version && phase === "ready" ? "fresh" : "stale"}>
          {unresolved && <p className="status">Bitte oben wählen, zu welchem Repo die Daten gehören.</p>}
          {phase === "running" && !topology && <p className="status">Hallen werden kompiliert …</p>}
          {phase === "running" && topology && <p className="status" data-validating>Wird neu kompiliert und geprüft …</p>}
          {topology?.note && <p className="status">{topology.note}</p>}
          {topology && !topology.note && (
            <>
              {topology.checks ? (
                <Validation checks={topology.checks} />
              ) : (
                checkedVersion !== version && (
                  <p className="hint">Tipp: Nach „Prüfung starten“ werden Knoten mit Befunden hier rot markiert.</p>
                )
              )}
              <TopologyView
                key={source}
                buildings={topology.buildings}
                findings={topologyFindings}
                files={topologyFiles}
                onChange={applyChange}
                busy={busy}
              />
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

/** The result of validating the edited customers with Topology's validate.py. */
function Validation({ checks }: { checks: CheckResult[] }) {
  const errors = checks.flatMap((c) => c.errors);
  const warnings = checks.flatMap((c) => c.warnings);
  return (
    <div className={`validation ${errors.length ? "failed" : "ok"}`} data-validation={errors.length ? "failed" : "ok"}>
      {errors.length
        ? `Nach der Änderung meldet validate.py ${errors.length} Fehler:`
        : `Nach der Änderung: validate.py ohne Fehler (${checks.map((c) => c.title).join(", ")}).`}
      {errors.length > 0 && <ul className="findings">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
      {warnings.length > 0 && <ul className="findings warnings">{warnings.map((w, i) => <li key={i}>Hinweis: {w}</li>)}</ul>}
    </div>
  );
}

function describe(layout: ReturnType<typeof detectLayout>): string {
  if (layout.kind === "workspace") return `enthält ${layout.repos.join(", ")}`;
  if (layout.kind === "repo") return `Daten von ${layout.repo}`;
  return "Repo unbekannt";
}
