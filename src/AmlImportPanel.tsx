// The AutomationML import: which element becomes what, where the new building
// goes, and what the import had to assume - before anything is written.
import { useMemo, useState } from "react";
import { CHOOSABLE, toTopology, type AmlModel, type Kind, type Note } from "./amlImport";
import type { Files } from "./editor";
import { t, tl, useLang } from "./i18n";
import type { Catalog } from "./types";
import { readYaml } from "./yamlEdit";

export interface CreatedBuilding {
  files: { path: string; text: string }[];
  warehousePath: string;
  summary: string;
}

/** Facilities the new building can go into: every facility.yaml of the Topology data. */
function facilities(files: Files) {
  return Object.keys(files)
    .filter((p) => /^customers\/[^/]+\/facilities\/[^/]+\/facility\.yaml$/.test(p))
    .sort()
    .map((path) => {
      const facility = (readYaml(files[path]).facility ?? {}) as Record<string, unknown>;
      return {
        path,
        customer: path.split("/")[1],
        // validate.py compares target.facility with the reference number, else the id.
        id: String(facility.reference_number ?? facility.id ?? ""),
        label: `${path.split("/")[1]} / ${String(facility.id ?? path.split("/")[3])}`,
      };
    });
}

const suggestedId = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "hall";

function note(n: Note): string {
  switch (n.code) {
    case "dropped":
      return t("import.note.dropped", { kind: tl("importKind", n.kind), count: n.count, fields: n.fields.join(", ") });
    case "assumedMode":
      return t("import.note.assumedMode", { element: n.element, mode: n.mode });
    default:
      return t(`import.note.${n.code}`, n as unknown as Record<string, string | number>);
  }
}

export function AmlImport({ model, fileName, files, catalog, onCreate, onCancel }: {
  model: AmlModel;
  fileName: string;
  files: Files;
  catalog: Catalog;
  onCreate: (created: CreatedBuilding) => void;
  onCancel: () => void;
}) {
  useLang();
  const targets = useMemo(() => facilities(files), [files]);
  const named = (kind: Kind) => model.elements.find((e) => e.proposed === kind && !e.mirrorOf);
  const [facilityPath, setFacilityPath] = useState(() => {
    // The facility of the file's name, if the data has it.
    const site = named("facility")?.name;
    return (targets.find((f) => f.id === site || f.label.endsWith(`/ ${site}`)) ?? targets[0])?.path ?? "";
  });
  const facility = targets.find((f) => f.path === facilityPath);
  const exists = (id: string) => files[`${facilityPath.replace(/\/[^/]*$/, "")}/buildings/${id}/warehouse.yaml`] !== undefined;
  const [building, setBuilding] = useState(() => {
    const base = suggestedId(named("building")?.name ?? "hall_1");
    let id = base;
    for (let n = 2; facilityPath && files[`${facilityPath.replace(/\/[^/]*$/, "")}/buildings/${id}/warehouse.yaml`] !== undefined; n++) {
      id = `${base.replace(/_\d+$/, "")}_${n}`;
    }
    return id;
  });
  const [kinds, setKinds] = useState<Record<string, Kind>>({});
  const kindOf = (id: string, proposed: Kind) => kinds[id] ?? proposed;

  const problem = !facility
    ? t("import.noFacility")
    : !/^[a-z0-9_]+$/.test(building)
      ? t("import.buildingInvalid")
      : exists(building)
        ? t("import.buildingTaken")
        : "";
  const result = useMemo(() => {
    if (!facility) return null;
    try {
      return toTopology(model, kinds, { customer: facility.customer, facilityPath, facility: facility.id, building: building || "x" }, files[facilityPath], catalog, fileName);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [model, kinds, facility, facilityPath, building, files, catalog, fileName]);

  // Storage points are many: they go with their storage type and are counted, not listed.
  const rows = model.elements.filter((e) => !e.mirrorOf && kindOf(e.id, e.proposed) !== "storage_point");
  const points = model.elements.filter((e) => !e.mirrorOf && kindOf(e.id, e.proposed) === "storage_point").length;
  const structural = (k: Kind) => k === "company" || k === "facility" || k === "building";

  return (
    <section className="aml-import panel" data-aml-import>
      <h3>{t("import.title", { file: fileName })}</h3>
      <p className="hint">{t("import.intro")}</p>
      <div className="import-target">
        <label className="field">
          <span>{t("import.facility")}</span>
          <select value={facilityPath} onChange={(e) => setFacilityPath(e.target.value)}>
            {targets.map((f) => <option key={f.path} value={f.path}>{f.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t("import.building")}</span>
          <input value={building} onChange={(e) => setBuilding(e.target.value.trim())} />
        </label>
      </div>
      {problem && <p className="status error">{problem}</p>}

      <table className="import-elements">
        <thead>
          <tr><th>{t("import.name")}</th><th>{t("import.role")}</th><th>{t("import.as")}</th></tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const kind = kindOf(e.id, e.proposed);
            return (
              <tr key={e.id} data-element={e.name}>
                <td style={{ paddingLeft: 4 + 14 * e.depth }}>{e.name}</td>
                <td><code>{e.role.split("/").pop() || "–"}</code></td>
                <td>
                  {structural(kind) ? (
                    tl("importKind", kind)
                  ) : (
                    <select aria-label={t("import.asFor", { name: e.name })} value={kind} onChange={(ev) => setKinds({ ...kinds, [e.id]: ev.target.value as Kind })}>
                      {CHOOSABLE.map((k) => <option key={k} value={k}>{tl("importKind", k)}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {points > 0 && <p className="hint">{t("import.points", { n: points })}</p>}

      {result && "error" in result && <p className="status error">{result.error}</p>}
      {result && "files" in result && (
        <>
          <p data-import-counts>
            {t("import.creates")}{" "}
            {Object.entries(result.counts).map(([k, n]) => `${n} × ${tl("importKind", k)}`).join(", ") || t("import.nothing")}
          </p>
          {result.notes.length > 0 && (
            <details className="import-notes" open={result.notes.length <= 8}>
              <summary>{t("import.notes", { n: result.notes.length })}</summary>
              <ul>{result.notes.map((n, i) => <li key={i}>{note(n)}</li>)}</ul>
            </details>
          )}
        </>
      )}
      <div className="actions">
        <button
          disabled={Boolean(problem) || !result || "error" in result}
          onClick={() =>
            result && "files" in result &&
            onCreate({
              files: result.files,
              warehousePath: result.warehousePath,
              summary: t("import.summary", { building, facility: facility!.label, file: fileName }),
            })
          }
        >
          {t("import.create")}
        </button>
        <button className="secondary" onClick={onCancel}>{t("import.cancel")}</button>
      </div>
    </section>
  );
}
