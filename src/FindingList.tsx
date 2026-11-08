import { explain } from "./findings";
import { t } from "./i18n";

/** Findings in project language, each with the tool's original line on demand. */
export function FindingList({ items, warnings = false }: { items: string[]; warnings?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className={`findings${warnings ? " warnings" : ""}`}>
      {items.map((raw, i) => {
        const f = explain(raw);
        return (
          <li key={i} className="finding" data-translated={f.translated || undefined}>
            {warnings && `${t("findings.warning")}: `}
            {f.location && <span className="f-location">{f.location}</span>}
            {f.subject && <strong className="f-subject">{f.subject}</strong>}
            <span className="f-text">{f.text}</span>
            <details className="f-original">
              <summary>{t("findings.original")}</summary>
              <code>{f.original}</code>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
