import { useEffect, useMemo, useState } from "react";
import { findingsFor } from "./graph";
import { entryLabel, findLists, listKey, type ListRef } from "./lists";
import { emptyValue, schemaAt } from "./schema";
import { ObjectFields } from "./SchemaForm";
import type { Catalog, CheckResult, UserFile } from "./types";
import { appendItem, readYaml, removeItem, updateItem, type ItemRef, type Value } from "./yamlEdit";

type Obj = Record<string, Value>;

/** An entry to open, e.g. from the topology diagram. */
export interface Focus {
  repo: string;
  path: string;
  key: string;
  id: string;
}

export interface FileChange {
  repo: string;
  path: string;
  text: string;
  summary: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Master data, rules and topology elements as forms generated from the repos' JSON Schemas. */
export function DataView({ files, catalog, checks, busy, onChange, focus }: {
  files: UserFile[];
  catalog: Catalog;
  /** validate.py results for the customers edited so far. */
  checks?: CheckResult[];
  busy: boolean;
  onChange: (change: FileChange) => void;
  focus?: Focus | null;
}) {
  const lists = useMemo(() => findLists(files), [files]);
  const [selected, setSelected] = useState<string>("");
  const [entry, setEntry] = useState<ItemRef | "new" | null>(null);
  // The draft belongs to one entry as stored; for any other, the form shows the stored entry.
  const [draftState, setDraftState] = useState<{ key: string; value: Obj } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!focus) return;
    const match = lists.find((l) => l.def.repo === focus.repo && l.path === focus.path && l.def.key === focus.key);
    if (match) {
      setSelected(listKey(match));
      setEntry(focus.id);
    }
    // Only when a new focus arrives, not when the lists change after an edit.
  }, [focus]);

  const list: ListRef | undefined = lists.find((l) => listKey(l) === selected) ?? lists[0];
  const text = list ? files.find((f) => f.repo === list.def.repo && f.path === list.path)?.text ?? "" : "";
  const entries = useMemo(() => {
    const value = list ? readYaml(text)[list.def.key] : [];
    return (Array.isArray(value) ? value : []) as Obj[];
  }, [text, list]);
  const at = useMemo(() => (list ? schemaAt(catalog, list.def.repo, list.def.schema) : null), [catalog, list]);
  const usesIds = entries.length ? entries.every((e) => typeof e?.id === "string") : Boolean(at?.schema.properties?.id);
  const index = entry === null || entry === "new" ? -1 : typeof entry === "number" ? entry : entries.findIndex((e) => e.id === entry);
  const stored = index >= 0 ? entries[index] : undefined;
  const ref: ItemRef | undefined = index < 0 ? undefined : usesIds ? String(entries[index].id) : index;

  const draftKey = `${list ? listKey(list) : ""}|${entry}|${entry === "new" ? "" : JSON.stringify(stored)}`;
  const draft: Obj = draftState?.key === draftKey ? draftState.value : stored ?? {};
  const setDraft = (value: Obj) => setDraftState({ key: draftKey, value });
  useEffect(() => setError(""), [draftKey]);

  const findings = useMemo(() => {
    if (!list || !checks) return [];
    return checks.filter((c) => c.id === `${list.def.repo}/${list.customer}`).flatMap((c) => [...c.errors, ...c.warnings]);
  }, [checks, list]);

  if (!lists.length) return <p className="status">In diesen Daten gibt es keine bearbeitbaren Listen.</p>;
  if (!list || !at) return null;

  function attempt(make: () => FileChange, select?: ItemRef | null) {
    try {
      onChange(make());
      if (select !== undefined) setEntry(select);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const label = stored ? entryLabel(stored, index) : "";
  const change = (newText: string, summary: string): FileChange => ({ repo: list.def.repo, path: list.path, text: newText, summary });

  function create() {
    const id = typeof draft.id === "string" ? draft.id.trim() : undefined;
    if (usesIds) {
      if (!id) return setError("Bitte eine ID angeben.");
      const pattern = at!.schema.properties?.id?.pattern;
      if (pattern && !new RegExp(pattern).test(id)) return setError(`Die ID muss dem Muster ${pattern} entsprechen.`);
      if (entries.some((e) => e.id === id)) return setError(`${id} gibt es in dieser Liste schon.`);
    }
    const item = usesIds ? { ...draft, id } : draft;
    attempt(
      () => change(appendItem(text, list!.def.key, item), `${list!.def.label}: ${id ?? entryLabel(item, entries.length)} angelegt`),
      usesIds ? id! : entries.length,
    );
  }

  const groups = [...new Set(lists.map((l) => l.def.repo))];
  return (
    <div className="data-view">
      <div className="data-toolbar">
        <label>
          Liste{" "}
          <select
            value={listKey(list)}
            onChange={(e) => {
              setSelected(e.target.value);
              setEntry(null);
            }}
          >
            {groups.map((repo) => (
              <optgroup key={repo} label={repo}>
                {lists.filter((l) => l.def.repo === repo).map((l) => (
                  <option key={listKey(l)} value={listKey(l)}>
                    {l.def.label} – {l.customer}{l.scope ? ` / ${l.scope}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="hint"><code>{list.def.repo}/{list.path}</code> · Schema <code>{list.def.schema}</code></span>
      </div>

      <div className="data-main">
        <nav className="data-entries" aria-label="Einträge">
          {entries.map((e, i) => {
            const name = entryLabel(e, i);
            const flagged = findingsFor(name, findings).length > 0;
            const current = i === index && entry !== "new";
            return (
              <button
                key={`${i}-${name}`}
                className={`data-entry${current ? " current" : ""}${flagged ? " flagged" : ""}`}
                aria-current={current || undefined}
                onClick={() => setEntry(usesIds ? String(e.id) : i)}
                data-entry={name}
              >
                {name}
                {typeof e.description === "string" && <span className="hint"> {e.description}</span>}
              </button>
            );
          })}
          <button
            className="secondary"
            onClick={() => {
              setEntry("new");
              setDraftState({ key: `${listKey(list)}|new|`, value: { ...(usesIds ? { id: "" } : {}), ...(emptyValue(catalog, at) as Obj) } });
            }}
            disabled={busy}
          >
            + Neuer Eintrag
          </button>
        </nav>

        <section className="data-form" data-form-entry={entry === "new" ? "new" : label || undefined}>
          {entry === "new" ? (
            <h3>Neuer Eintrag in {list.def.label}</h3>
          ) : stored ? (
            <h3>{label}</h3>
          ) : (
            <p className="hint">Einen Eintrag wählen oder einen neuen anlegen. Felder und Auswahllisten kommen aus dem JSON-Schema des Repos.</p>
          )}
          {(entry === "new" || stored) && (
            <>
              {stored && findingsFor(label, findings).length > 0 && (
                <ul className="findings">{findingsFor(label, findings).map((f, i) => <li key={i}>{f}</li>)}</ul>
              )}
              <ObjectFields
                catalog={catalog}
                at={at}
                value={draft}
                onChange={(v) => setDraft(v)}
                readOnlyKeys={entry === "new" ? [] : ["id"]}
              />
              {entry === "new" && usesIds && <p className="hint">Die ID lässt sich nach dem Anlegen nicht mehr ändern.</p>}
              {error && <p className="status error" data-edit-error>{error}</p>}
              <div className="actions">
                {entry === "new" ? (
                  <>
                    <button onClick={create} disabled={busy}>Anlegen</button>
                    <button className="secondary" onClick={() => setEntry(null)}>Abbrechen</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => attempt(() => change(updateItem(text, list.def.key, ref!, draft), `${list.def.label}: ${label} geändert`))}
                      disabled={busy || same(draft, stored)}
                    >
                      Übernehmen
                    </button>
                    <button className="secondary" onClick={() => setDraftState(null)} disabled={same(draft, stored)}>
                      Zurücksetzen
                    </button>
                    <button
                      className="secondary"
                      onClick={() => {
                        setEntry("new");
                        setDraftState({ key: `${listKey(list)}|new|`, value: { ...structuredClone(stored!), ...(usesIds ? { id: `${stored!.id}_KOPIE` } : {}) } });
                      }}
                      disabled={busy}
                    >
                      Kopieren …
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        window.confirm(`${label} löschen?`) &&
                        attempt(() => change(removeItem(text, list.def.key, ref!), `${list.def.label}: ${label} gelöscht`), null)
                      }
                      disabled={busy}
                    >
                      Löschen
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
