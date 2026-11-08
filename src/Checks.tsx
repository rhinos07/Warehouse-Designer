import type { CheckInfo, CheckResult } from "./types";
import { FindingList } from "./FindingList";

export function ChecksView({ checks, results, running }: {
  checks: CheckInfo[];
  results: Record<string, CheckResult>;
  running: boolean;
}) {
  if (!checks.length) return null;
  const done = checks.filter((c) => results[c.id]);
  const failed = done.filter((c) => !results[c.id].ok).length;
  return (
    <section>
      <h2>
        {running
          ? `Prüfung läuft … ${done.length} von ${checks.length}`
          : failed
            ? `${failed} von ${checks.length} Prüfungen mit Fehlern`
            : `Alle ${checks.length} Prüfungen ohne Fehler`}
      </h2>
      {checks.map((check) => (
        <Result key={check.id} check={check} result={results[check.id]} />
      ))}
    </section>
  );
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
        <FindingList items={result.errors} />
      )}
      {result && result.warnings.length > 0 && (
        <FindingList items={result.warnings} warnings />
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
