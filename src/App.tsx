import { useEffect, useMemo, useRef, useState } from "react";
import { LanguageSwitch, t, tn, useLang } from "./i18n";
import { FindingList } from "./FindingList";
import { ChangesView, type ChangedFile } from "./Changes";
import { ChecksView } from "./Checks";
import { DataView, type FileChange, type Focus } from "./DataView";
import type { Change, Files } from "./editor";
import { assign, canPickDirectory, detectLayout, pickDirectory, scanFileList, writeFiles, type Scan } from "./folder";
import type { CreatedBuilding } from "./AmlImportPanel";
import { MaterialFlowView } from "./MaterialFlow";
import { TopologyView } from "./Topology";
import { WorkflowView } from "./Workflow";
import {
  REPOS,
  type Building,
  type Catalog,
  type CheckInfo,
  type CheckResult,
  type FromWorker,
  type RepoName,
  type SpecsInfo,
  type ToWorker,
  type UserFile,
} from "./types";

type Phase = "loading" | "ready" | "running" | "failed";
type Tab = "checks" | "topology" | "simulation" | "workflow" | "data";
const TOPOLOGY: RepoName = "Topology-as-Code";

/** One edit: a file's new text, keyed `<repo>/<path>`; a key not in the data creates that file. */
interface Edit {
  key: string;
  text: string;
  summary: string; // empty for the further files of a group
  /** Edits made together (e.g. an import's files): undone together. */
  group?: number;
}

const keyOf = (f: { repo: string; path: string }) => `${f.repo}/${f.path}`;

export default function App() {
  const worker = useRef<Worker | null>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("starting"); // a status key while loading, the error text once failed
  const [specs, setSpecs] = useState<{ repos: SpecsInfo; generatedAt: string } | null>(null);
  const [examples, setExamples] = useState<UserFile[]>([]);
  const [catalog, setCatalog] = useState<Catalog>({});
  const [dataChecks, setDataChecks] = useState<{ version: number; checks: CheckResult[] } | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
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
        setCatalog(m.catalog);
        setPhase("ready");
      } else if (m.type === "plan") setChecks(m.checks);
      else if (m.type === "result") setResults((r) => ({ ...r, [m.result.id]: m.result }));
      else if (m.type === "done") setPhase("ready");
      else if (m.type === "validated") {
        setDataChecks({ version: pendingVersion.current, checks: m.checks });
        setPhase("ready");
      } else if (m.type === "topology") {
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
  /** Where a new file of a repo goes in the opened folder; undefined if the folder has no place for that repo. */
  function sourceFor(repo: RepoName, path: string): string | undefined {
    if (!scan || !layout) return undefined;
    if (layout.kind === "workspace") {
      const dir = scan.files.map((f) => f.path.split("/")[0]).find((d) => d.toLowerCase() === repo.toLowerCase());
      return dir ? `${dir}/${path}` : undefined;
    }
    return (layout.kind === "repo" ? layout.repo : chosen) === repo ? path : undefined;
  }
  /** Files the edits create: in no data read so far. */
  const created = useMemo<UserFile[]>(() => {
    const known = new Set(base.map(keyOf));
    return [...overrides].filter(([key]) => !known.has(key)).map(([key, text]) => {
      const repo = REPOS.find((r) => key.startsWith(`${r}/`))!;
      const path = key.slice(repo.length + 1);
      return { repo, path, text, source: sourceFor(repo, path) };
    });
  }, [base, overrides, scan, chosen]);
  /** The data with the unsaved edits applied. */
  const current = useMemo(
    () => [...base.map((f) => (overrides.has(keyOf(f)) ? { ...f, text: overrides.get(keyOf(f))! } : f)), ...created],
    [base, overrides, created],
  );
  const topologyFiles = useMemo<Files>(
    () => Object.fromEntries(current.filter((f) => f.repo === TOPOLOGY).map((f) => [f.path, f.text])),
    [current],
  );
  const changed = useMemo<ChangedFile[]>(
    () =>
      base
        .filter((f) => overrides.has(keyOf(f)) && overrides.get(keyOf(f)) !== f.text)
        .map((f) => ({ path: keyOf(f), before: f.text, after: overrides.get(keyOf(f))! }))
        .concat(created.map((f) => ({ path: keyOf(f), before: "", after: f.text, created: true }))),
    [base, overrides, created],
  );

  function files(): UserFile[] | undefined {
    if (current.length) return current;
    setNotice(t("app.noDataNotice"));
    return undefined;
  }

  function changeSource(next: Scan | null) {
    if (edits.length && !window.confirm(t("app.confirmDiscardSource"))) return;
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
      setTopology({ version, buildings: [], note: "app.folderNoData" });
      return;
    }
    if (!current.some((f) => f.repo === TOPOLOGY)) {
      setTopology({ version, buildings: [], note: "app.folderNoTopology" });
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
    if ((tab === "topology" || tab === "simulation") && phase === "ready" && !unresolved && topology?.version !== version) loadTopology();
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
    const homeless = created.filter((f) => !f.source);
    if (homeless.length) {
      setNotice(t("app.noPlaceForNew", { files: homeless.map(keyOf).join(", ") }));
      return;
    }
    try {
      await writeFiles(scan.handle, [
        ...targets.map((f) => ({ path: f.source!, text: overrides.get(keyOf(f))!, expected: f.text as string | null })),
        ...created.map((f) => ({ path: f.source!, text: f.text, expected: null })),
      ]);
      const written = new Map(targets.map((f) => [f.source!, overrides.get(keyOf(f))!]));
      setScan({
        ...scan,
        files: [
          ...scan.files.map((f) => (written.has(f.path) ? { ...f, text: written.get(f.path)! } : f)),
          ...created.map((f) => ({ path: f.source!, text: f.text })),
        ],
      });
      setEdits([]); // same data as before, now saved: no new version
      setNotice("");
      setSaved(tn("app.saved", targets.length + created.length, { folder: scan.rootName }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  }

  function applyFileChange(change: FileChange) {
    changeData([...edits, { key: `${change.repo}/${change.path}`, text: change.text, summary: change.summary }]);
  }

  // The data tab validates the edited customers after every edit, with each repo's validate.py.
  const editedChecks = [
    ...new Set(
      edits
        .map((e) => e.key.split("/"))
        .filter((parts) => parts[1] === "customers" && parts[0] !== "Warehouse-as-Code")
        .map((parts) => `${parts[0]}/${parts[2]}`),
    ),
  ];
  useEffect(() => {
    if ((tab !== "data" && tab !== "workflow") || phase !== "ready" || !editedChecks.length || dataChecks?.version === version) return;
    pendingVersion.current = version;
    setPhase("running");
    worker.current?.postMessage({ type: "validate", files: current, checks: editedChecks } satisfies ToWorker);
  });

  function applyChange(change: Change) {
    changeData([...edits, { key: `${TOPOLOGY}/${change.path}`, text: change.text, summary: change.summary }]);
  }

  /** Changes to several files made together, as one edit to undo. */
  function applyChanges(changes: Change[]) {
    const group = Date.now();
    changeData([...edits, ...changes.map((c) => ({ key: `${TOPOLOGY}/${c.path}`, text: c.text, summary: c.summary, group }))]);
  }

  /** A new building's files (and its facility.yaml), as one edit to undo. */
  function createBuilding(building: CreatedBuilding) {
    const group = Date.now();
    changeData([
      ...edits,
      ...building.files.map((f, i) => ({ key: `${TOPOLOGY}/${f.path}`, text: f.text, summary: i ? "" : building.summary, group })),
    ]);
  }

  /** Undoes the last edit, or the last group of edits made together. */
  function undo() {
    const last = edits[edits.length - 1];
    let keep = edits.length - 1;
    while (last?.group !== undefined && keep > 0 && edits[keep - 1].group === last.group) keep--;
    changeData(edits.slice(0, keep));
  }

  const lang = useLang();
  const busy = phase !== "ready";
  const checkFindings = (list: CheckResult[]) =>
    list.filter((r) => r.repo === TOPOLOGY).flatMap((r) => [...r.errors, ...r.warnings]);
  const orderFindings = (dataChecks?.version === version ? dataChecks.checks : checkedVersion === version ? Object.values(results) : [])
    .filter((r) => r.repo === "OrderOrchestration-as-Code")
    .flatMap((r) => [...r.errors, ...r.warnings]);
  const topologyFindings = topology?.checks
    ? checkFindings(topology.checks)
    : checkedVersion === version
      ? checkFindings(Object.values(results))
      : [];

  return (
    <div className="page">
      <header>
        <div className="title-row">
          <h1>Warehouse Designer</h1>
          <LanguageSwitch />
        </div>
        <p className="lead">{t("app.lead")}</p>
      </header>

      <section className="panel">
        <div className="source">
          <span>
            {t("app.data")}: <strong data-source>{scan ? scan.rootName : t("app.exampleData")}</strong>
            {scan && layout && <span className="hint"> – {describe(layout)}</span>}
            {scan && !scan.handle && <span className="hint"> ({t("app.readOnly")})</span>}
          </span>
          <div className="actions">
            <button onClick={openFolder} disabled={busy}>{t("app.openFolder")}</button>
            {scan && <button className="secondary" onClick={() => changeSource(null)} disabled={busy}>{t("app.useExamples")}</button>}
          </div>
          <input ref={folderInput} type="file" hidden data-folder-input {...{ webkitdirectory: "" }} onChange={(e) => onFileList(e.target.files)} />
        </div>
        {layout?.kind === "unknown" && (
          <label className="choose">
            {t("app.dataBelongsTo")}{" "}
            <select
              value={chosen}
              onChange={(e) => {
                setChosen(e.target.value as RepoName);
                setSource((s) => s + 1);
                setVersion((v) => v + 1);
              }}
            >
              <option value="">{t("app.chooseRepo")}</option>
              {REPOS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
        )}
        {phase === "loading" && <p className="status">{t(`status.${status}`)}</p>}
        {phase === "failed" && <p className="status error">{t("app.error")}: {status}</p>}
        {notice && <p className="status error">{notice}</p>}
        {saved && <p className="status ok" data-saved>{saved}</p>}
      </section>

      <ChangesView
        files={changed}
        log={edits.filter((e) => e.summary).map((e) => e.summary)}
        busy={busy}
        saveLabel={scan?.handle ? t("app.saveToFolder") : undefined}
        onSave={save}
        onUndo={undo}
        onDiscard={() => window.confirm(t("app.confirmDiscardAll")) && changeData([])}
      />

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "checks"} onClick={() => setTab("checks")}>{t("tab.checks")}</button>
        <button role="tab" aria-selected={tab === "topology"} onClick={() => setTab("topology")}>{t("tab.topology")}</button>
        <button role="tab" aria-selected={tab === "simulation"} onClick={() => setTab("simulation")}>{t("tab.simulation")}</button>
        <button role="tab" aria-selected={tab === "workflow"} onClick={() => setTab("workflow")}>{t("tab.workflow")}</button>
        <button role="tab" aria-selected={tab === "data"} onClick={() => setTab("data")}>{t("tab.data")}</button>
      </nav>

      {tab === "checks" && (
        <>
          <button onClick={runChecks} disabled={busy || unresolved}>{t("app.runChecks")}</button>
          {edits.length > 0 && <span className="hint"> {t("app.checksUseEdits")}</span>}
          {checks.length > 0 && checkedVersion !== version && (
            <p className="hint">{t("app.checksStale")}</p>
          )}
          <ChecksView checks={checks} results={results} running={phase === "running"} />
        </>
      )}

      {tab === "topology" && (
        <section data-topology={topology?.version === version && phase === "ready" ? "fresh" : "stale"}>
          {unresolved && <p className="status">{t("app.chooseRepoFirst")}</p>}
          {phase === "running" && !topology && <p className="status">{t("app.compiling")}</p>}
          {phase === "running" && topology && <p className="status" data-validating>{t("app.recompiling")}</p>}
          {topology?.note && <p className="status">{t(topology.note)}</p>}
          {topology && !topology.note && (
            <>
              {topology.checks ? (
                <Validation checks={topology.checks} />
              ) : (
                checkedVersion !== version && (
                  <p className="hint">{t("app.tipNodes")}</p>
                )
              )}
              <TopologyView
                key={source}
                buildings={topology.buildings}
                findings={topologyFindings}
                files={topologyFiles}
                onChange={applyChange}
                onChanges={applyChanges}
                onCreate={createBuilding}
                onOpen={(target) => {
                  setFocus({ repo: TOPOLOGY, ...target });
                  setTab("data");
                }}
                catalog={catalog}
                busy={busy}
              />
            </>
          )}
        </section>
      )}

      {tab === "simulation" && (
        <section data-simulation={topology?.version === version && phase === "ready" ? "fresh" : "stale"}>
          {unresolved && <p className="status">{t("app.chooseRepoFirst")}</p>}
          {phase === "running" && !topology && <p className="status">{t("app.compiling")}</p>}
          {topology?.note && <p className="status">{t(topology.note)}</p>}
          {topology && !topology.note && <MaterialFlowView key={`${source}:${topology.version}`} buildings={topology.buildings} />}
        </section>
      )}

      {tab === "workflow" && (
        <section data-workflow={phase === "ready" && (!editedChecks.length || dataChecks?.version === version) ? "fresh" : "stale"}>
          {unresolved && <p className="status">{t("app.chooseRepoFirst")}</p>}
          {editedChecks.length > 0 && dataChecks?.version === version && <Validation checks={dataChecks.checks} />}
          {editedChecks.length > 0 && dataChecks?.version !== version && <p className="status">{t("app.checking")}</p>}
          {!editedChecks.length && checkedVersion !== version && (
            <p className="hint">{t("app.tipRules")}</p>
          )}
          {!unresolved && specs && (
            <WorkflowView
              key={source}
              files={current}
              findings={orderFindings}
              busy={busy}
              onOpen={(target) => {
                setFocus(target);
                setTab("data");
              }}
            />
          )}
        </section>
      )}

      {tab === "data" && (
        <section data-data={phase === "ready" && (!editedChecks.length || dataChecks?.version === version) ? "fresh" : "stale"}>
          {unresolved && <p className="status">{t("app.chooseRepoFirst")}</p>}
          {editedChecks.length > 0 && dataChecks?.version === version && <Validation checks={dataChecks.checks} />}
          {editedChecks.length > 0 && dataChecks?.version !== version && <p className="status">{t("app.checking")}</p>}
          {!unresolved && specs && (
            <DataView
              key={source}
              files={current}
              catalog={catalog}
              checks={dataChecks?.version === version ? dataChecks.checks : undefined}
              busy={busy}
              onChange={applyFileChange}
              focus={focus}
            />
          )}
        </section>
      )}

      {specs && (
        <footer>
          {t("app.footer", { date: new Date(specs.generatedAt).toLocaleString(lang === "de" ? "de-DE" : "en-GB") })}{" "}
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
        ? tn("app.validationFailed", errors.length)
        : t("app.validationOk", { checks: checks.map((c) => c.id).join(", ") })}
      <FindingList items={errors} />
      <FindingList items={warnings} warnings />
    </div>
  );
}

function describe(layout: ReturnType<typeof detectLayout>): string {
  if (layout.kind === "workspace") return t("app.layoutWorkspace", { repos: layout.repos.join(", ") });
  if (layout.kind === "repo") return t("app.layoutRepo", { repo: layout.repo });
  return t("app.layoutUnknown");
}
