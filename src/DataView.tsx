import { useEffect, useMemo, useState } from "react";
import { FindingList } from "./FindingList";
import { findingsFor } from "./graph";
import { t } from "./i18n";
import { entryLabel, findLists, listKey, listLabel, type ListRef } from "./lists";
import { emptyValue, schemaAt } from "./schema";
import { ObjectFields } from "./SchemaForm";
import type { Catalog, CheckResult, UserFile } from "./types";
import { appendItem, readYaml, removeItem, updateItem, updateTop, type ItemRef, type Value } from "./yamlEdit";

type Obj = Record<string, Value>;

/** An entry to open, e.g. from a diagram; an empty id opens a new entry. */
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
    if (!match) return;
    setSelected(listKey(match));
    if (match.def.single) {
      setEntry(null);
      return;
    }
    if (focus.id) {
      setEntry(focus.id);
      return;
    }
    const at = schemaAt(catalog, match.def.repo, match.def.schema);
    setEntry("new");
    setDraftState({ key: `${listKey(match)}|new|`, value: { ...(at.schema.properties?.id ? { id: "" } : {}), ...(emptyValue(catalog, at) as Obj) } });
    // Only when a new focus arrives, not when the lists change after an edit.
  }, [focus]);

  const list: ListRef | undefined = lists.find((l) => listKey(l) === selected) ?? lists[0];
  const text = list ? files.find((f) => f.repo === list.def.repo && f.path === list.path)?.text ?? "" : "";
  const single = Boolean(list?.def.single);
  const data = useMemo(() => (list ? readYaml(text)[list.def.key] : undefined), [text, list]);
  const entries = (Array.isArray(data) ? data : []) as Obj[];
  const at = useMemo(() => (list ? schemaAt(catalog, list.def.repo, list.def.schema) : null), [catalog, list]);
  const usesIds = entries.length ? entries.every((e) => typeof e?.id === "string") : Boolean(at?.schema.properties?.id);
  const index = entry === null || entry === "new" ? -1 : typeof entry === "number" ? entry : entries.findIndex((e) => e.id === entry);
  const stored = single ? ((data ?? {}) as Obj) : index >= 0 ? entries[index] : undefined;
  const ref: ItemRef | undefined = index < 0 ? undefined : usesIds ? String(entries[index].id) : index;

  const draftKey = `${list ? listKey(list) : ""}|${entry}|${entry === "new" ? "" : JSON.stringify(stored)}`;
  const draft: Obj = draftState?.key === draftKey ? draftState.value : stored ?? {};
  const setDraft = (value: Obj) => setDraftState({ key: draftKey, value });
  useEffect(() => setError(""), [draftKey]);

  const findings = useMemo(() => {
    if (!list || !checks) return [];
    return checks.filter((c) => c.id === `${list.def.repo}/${list.customer}`).flatMap((c) => [...c.errors, ...c.warnings]);
  }, [checks, list]);

  if (!lists.length) return <p className="status">{t("data.noLists")}</p>;
  if (!list || !at) return null;

  function attempt(make: () => FileChange, select?: ItemRef | null) {
    try {
      onChange(make());
      if (select !== undefined) setEntry(select);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const label = single ? listLabel(list.def) : stored ? entryLabel(stored, index) : "";
  const change = (newText: string, summary: string): FileChange => ({ repo: list.def.repo, path: list.path, text: newText, summary });

  function create() {
    const id = typeof draft.id === "string" ? draft.id.trim() : undefined;
    if (usesIds) {
      if (!id) return setError(t("data.needId"));
      const pattern = at!.schema.properties?.id?.pattern;
      if (pattern && !new RegExp(pattern).test(id)) return setError(t("data.idPattern", { pattern }));
      if (entries.some((e) => e.id === id)) return setError(t("data.idTaken", { id }));
    }
    const item = usesIds ? { ...draft, id } : draft;
    attempt(
      () => change(appendItem(text, list!.def.key, item), t("data.created", { list: listLabel(list!.def), entry: id ?? entryLabel(item, entries.length) })),
      usesIds ? id! : entries.length,
    );
  }

  const groups = [...new Set(lists.map((l) => l.def.repo))];
  return (
    <div className="data-view">
      <div className="data-toolbar">
        <label>
          {t("data.list")}{" "}
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
                    {listLabel(l.def)} – {l.customer}{l.scope ? ` / ${l.scope}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="hint"><code>{list.def.repo}/{list.path}</code> · Schema <code>{list.def.schema}</code></span>
      </div>

      <div className={`data-main${single ? " single" : ""}`}>
        {!single && <nav className="data-entries" aria-label={t("data.entries")}>
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
            {t("data.newEntry")}
          </button>
        </nav>}

        <section className="data-form" data-form-entry={entry === "new" ? "new" : label || undefined}>
          {entry === "new" ? (
            <h3>{t("data.newEntryIn", { list: listLabel(list.def) })}</h3>
          ) : stored ? (
            <h3>{label}</h3>
          ) : (
            <p className="hint">{t("data.chooseEntry")}</p>
          )}
          {(entry === "new" || stored) && (
            <>
              {stored && findingsFor(label, findings).length > 0 && (
                <FindingList items={findingsFor(label, findings)} />
              )}
              <ObjectFields
                catalog={catalog}
                at={at}
                value={draft}
                onChange={(v) => setDraft(v)}
                readOnlyKeys={entry === "new" ? [] : ["id"]}
              />
              {entry === "new" && usesIds && <p className="hint">{t("data.idFixed")}</p>}
              {error && <p className="status error" data-edit-error>{error}</p>}
              <div className="actions">
                {entry === "new" ? (
                  <>
                    <button onClick={create} disabled={busy}>{t("data.create")}</button>
                    <button className="secondary" onClick={() => setEntry(null)}>{t("edit.cancel")}</button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() =>
                        attempt(() =>
                          change(
                            single ? updateTop(text, list.def.key, draft) : updateItem(text, list.def.key, ref!, draft),
                            single ? t("data.changedSingle", { list: listLabel(list.def) }) : t("data.changed", { list: listLabel(list.def), entry: label }),
                          ),
                        )
                      }
                      disabled={busy || same(draft, stored)}
                    >
                      {t("data.apply")}
                    </button>
                    <button className="secondary" onClick={() => setDraftState(null)} disabled={same(draft, stored)}>
                      {t("data.reset")}
                    </button>
                    {!single && <button
                      className="secondary"
                      onClick={() => {
                        setEntry("new");
                        setDraftState({ key: `${listKey(list)}|new|`, value: { ...structuredClone(stored!), ...(usesIds ? { id: `${stored!.id}_KOPIE` } : {}) } });
                      }}
                      disabled={busy}
                    >
                      {t("data.copy")}
                    </button>}
                    {!single && <button
                      className="danger"
                      onClick={() =>
                        window.confirm(t("data.confirmDelete", { entry: label })) &&
                        attempt(() => change(removeItem(text, list.def.key, ref!), t("data.deleted", { list: listLabel(list.def), entry: label })), null)
                      }
                      disabled={busy}
                    >
                      {t("data.delete")}
                    </button>}
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
