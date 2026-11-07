import { useEffect, useRef, useState } from "react";
import { assign, canPickDirectory, detectLayout, pickDirectory, scanFileList, type Layout, type Scan } from "./folder";
import { REPOS, type CheckInfo, type CheckResult, type FromWorker, type RepoName, type SpecsInfo, type ToWorker } from "./types";

type Phase = "loading" | "ready" | "running" | "failed";

export default function App() {
  const worker = useRef<Worker | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("Wird gestartet …");
  const [specs, setSpecs] = useState<{ repos: SpecsInfo; generatedAt: string } | null>(null);
  const [scan, setScan] = useState<Scan | null>(null);
  const [chosen, setChosen] = useState<RepoName | "">("");
  const [checks, setChecks] = useState<CheckInfo[]>([]);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [notice, setNotice] = useState("");

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
      else if (m.type === "error") {
        setStatus(m.message);
        setPhase("failed");
      }
    };
    w.postMessage({ type: "init", base: new URL(".", document.baseURI).href } satisfies ToWorker);
    return () => w.terminate();
  }, []);

  const layout: Layout | null = scan ? detectLayout(scan) : null;

  function start(message: ToWorker) {
    setChecks([]);
    setResults({});
    setNotice("");
    setPhase("running");
    worker.current?.postMessage(message);
  }

  function runExamples() {
    setScan(null);
    start({ type: "run", repos: [...REPOS], files: null });
  }

  function runFolder() {
    if (!scan || !layout) return;
    const repo = layout.kind === "unknown" ? chosen || undefined : undefined;
    const files = assign(scan, layout, repo);
    if (!files.length) {
      setNotice("In diesem Ordner liegen keine Daten. Erwartet werden die Ordner customers/, sites/ oder examples/ eines Repos.");
      return;
    }
    start({ type: "run", repos: [...new Set(files.map((f) => f.repo))], files });
  }

  async function openFolder() {
    if (!canPickDirectory()) {
      folderInput.current?.click();
      return;
    }
    try {
      setScan(await pickDirectory());
      setChecks([]);
      setResults({});
      setNotice("");
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setNotice(String((error as Error).message ?? error));
    }
  }

  async function onFileList(list: FileList | null) {
    if (!list?.length) return;
    setScan(await scanFileList(list));
    setChecks([]);
    setResults({});
    setNotice("");
  }

  const busy = phase !== "ready";
  const done = checks.filter((c) => results[c.id]);
  const failed = done.filter((c) => !results[c.id].ok).length;

  return (
    <div className="page">
      <header>
        <h1>Warehouse Designer</h1>
        <p className="lead">
          Prüft Lagerdefinitionen aus Topology-, Allocation-, OrderOrchestration-, MasterData- und Warehouse-as-Code mit den
          Prüfregeln der Repos selbst. Ihre Dateien verlassen den Browser nicht.
        </p>
      </header>

      <section className="panel">
        <div className="actions">
          <button onClick={openFolder} disabled={busy}>Ordner öffnen …</button>
          <button className="secondary" onClick={runExamples} disabled={busy}>Beispieldaten der Repos prüfen</button>
          <input
            ref={folderInput}
            type="file"
            hidden
            {...{ webkitdirectory: "" }}
            onChange={(e) => onFileList(e.target.files)}
          />
        </div>
        {phase === "loading" && <p className="status">{status}</p>}
        {phase === "failed" && <p className="status error">Fehler: {status}</p>}
        {scan && layout && (
          <div className="scan">
            <p>
              <strong>{scan.rootName}</strong>: {describe(layout)}
            </p>
            {layout.kind === "unknown" && (
              <label>
                Daten gehören zu{" "}
                <select value={chosen} onChange={(e) => setChosen(e.target.value as RepoName)}>
                  <option value="">– Repo wählen –</option>
                  {REPOS.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <button onClick={runFolder} disabled={busy || (layout.kind === "unknown" && !chosen)}>Prüfen</button>
          </div>
        )}
        {notice && <p className="status error">{notice}</p>}
      </section>

      {checks.length > 0 && (
        <section>
          <h2>
            {phase === "running"
              ? `Prüfung läuft … ${done.length} von ${checks.length}`
              : failed
                ? `${failed} von ${checks.length} Prüfungen mit Fehlern`
                : `Alle ${checks.length} Prüfungen ohne Fehler`}
          </h2>
          {checks.map((check) => (
            <Result key={check.id} check={check} result={results[check.id]} />
          ))}
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

function describe(layout: Layout): string {
  if (layout.kind === "workspace") return `enthält ${layout.repos.join(", ")}.`;
  if (layout.kind === "repo") return `Daten von ${layout.repo}.`;
  return "Zu welchem Repo gehören diese Daten?";
}

function Result({ check, result }: { check: CheckInfo; result?: CheckResult }) {
  const state = !result ? "pending" : result.ok ? "ok" : "failed";
  return (
    <article className={`result ${state}`} data-check={check.id} data-state={state}>
      <div className="result-head">
        <span className="badge">{!result ? "…" : result.ok ? "OK" : `${result.errors.length} Fehler`}</span>
        <span className="repo">{check.repo}</span>
        <span className="title">{check.title}</span>
        {result && <span className="ms">{(result.ms / 1000).toFixed(1)} s</span>}
      </div>
      {result && result.errors.length > 0 && (
        <ul className="findings">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
      )}
      {result && result.warnings.length > 0 && (
        <ul className="findings warnings">{result.warnings.map((w, i) => <li key={i}>Hinweis: {w}</li>)}</ul>
      )}
      {result && (
        <details>
          <summary>Ausgabe des Prüfwerkzeugs</summary>
          <pre>{result.output}</pre>
        </details>
      )}
    </article>
  );
}
