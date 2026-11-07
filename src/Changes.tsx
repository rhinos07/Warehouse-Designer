import { useEffect, useMemo } from "react";
import { countChanges, diffLines } from "./diff";

export interface ChangedFile {
  path: string; // shown to the user: repo path, e.g. Topology-as-Code/customers/...
  before: string;
  after: string;
}

/** Unsaved edits: what changed, as a diff, with undo, discard and save or download. */
export function ChangesView({ files, log, busy, saveLabel, onSave, onUndo, onDiscard }: {
  files: ChangedFile[];
  log: string[];
  busy: boolean;
  /** Set when the opened folder can be written to. */
  saveLabel?: string;
  onSave: () => void;
  onUndo: () => void;
  onDiscard: () => void;
}) {
  if (!log.length) return null;
  return (
    <section className="changes panel" data-changes>
      <div className="changes-head">
        <strong>
          {log.length} ungespeicherte Änderung{log.length === 1 ? "" : "en"} in {files.length} Datei{files.length === 1 ? "" : "en"}
        </strong>
        <div className="actions">
          {saveLabel && <button onClick={onSave} disabled={busy}>{saveLabel}</button>}
          <button className="secondary" onClick={onUndo} disabled={busy}>Rückgängig</button>
          <button className="secondary" onClick={onDiscard} disabled={busy}>Alle verwerfen</button>
        </div>
      </div>
      <ol className="change-log">{log.map((entry, i) => <li key={i}>{entry}</li>)}</ol>
      {!saveLabel && (
        <p className="hint">
          Speichern direkt in den Ordner geht in Edge und Chrome nach „Ordner öffnen …“. Hier die geänderten Dateien
          herunterladen und im Repo ersetzen:
        </p>
      )}
      {files.map((file) => <FileDiff key={file.path} file={file} download={!saveLabel} />)}
    </section>
  );
}

function FileDiff({ file, download }: { file: ChangedFile; download: boolean }) {
  const lines = useMemo(() => diffLines(file.before, file.after), [file]);
  const { added, removed } = countChanges(lines);
  const url = useMemo(() => (download ? URL.createObjectURL(new Blob([file.after], { type: "text/yaml" })) : ""), [file, download]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return (
    <details className="file-diff" data-file={file.path}>
      <summary>
        <code>{file.path}</code> <span className="added">+{added}</span> <span className="removed">−{removed}</span>
        {download && (
          <>
            {" "}
            <a href={url} download={file.path.split("/").pop()} onClick={(e) => e.stopPropagation()}>herunterladen</a>
          </>
        )}
      </summary>
      <pre className="diff">
        {lines.map((line, i) =>
          line ? (
            <div key={i} className={`diff-${line.kind === "+" ? "add" : line.kind === "-" ? "del" : "ctx"}`}>
              <span className="ln">{line.kind === "+" ? "" : line.old}</span>
              <span className="ln">{line.kind === "-" ? "" : line.new}</span>
              {line.kind} {line.text}
            </div>
          ) : (
            <div key={i} className="diff-gap">…</div>
          ),
        )}
      </pre>
    </details>
  );
}
