import { useState, type FormEvent, type ReactNode } from "react";
import {
  addConnection,
  addDoor,
  addReportingPoint,
  addWorkCenter,
  COMMON_STEPS,
  DIRECTIONS,
  DOOR_DIRECTIONS,
  ENDPOINT_KINDS,
  REPORTING_POINT_TYPES,
  sections,
  TRANSPORT_MODES,
  type Change,
  type Files,
} from "./editor";
import { MODE_LABEL, type Graph } from "./graph";
import type { Building } from "./types";

export type Form =
  | { type: "connection"; from: string; to?: string }
  | { type: "door" }
  | { type: "work_center" }
  | { type: "reporting_point" };

const TITLE: Record<Form["type"], string> = {
  connection: "Neue Verbindung („kann“)",
  door: "Neues Tor",
  work_center: "Neuer Arbeitsplatz",
  reporting_point: "Neuer Meldepunkt",
};
const DIRECTION_LABEL: Record<string, string> = { bidirectional: "in beide Richtungen", one_way: "nur in Pfeilrichtung" };
const DOOR_LABEL: Record<string, string> = { inbound: "Eingang", outbound: "Ausgang", returns: "Retouren" };
const RP_LABEL: Record<string, string> = {
  identification_point: "Identifikationspunkt",
  aisle_decision_point: "Gassenentscheidung",
  clarification_point: "Klärplatz",
};

export function EditPanel({ form, building, files, graph, onChange, onCancel }: {
  form: Form;
  building: Building;
  files: Files;
  graph: Graph;
  onChange: (change: Change) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const endpoints = graph.nodes.filter((n) => ENDPOINT_KINDS.includes(n.kind)).map((n) => n.id).sort();
  const controllers = (building.entities?.controller ?? []).map((c) => c.id);
  const sectionList = sections(building, files);
  // The staging section that fits a door's direction, e.g. STAGING.SEC_STAGING_OUT for outbound.
  const staging = (direction: string) => {
    const word = { inbound: "_IN", outbound: "_OUT", returns: "RETURN" }[direction] ?? "";
    const staged = sectionList.filter((s) => s.includes("STAGING"));
    return staged.find((s) => s.endsWith(word) || s.includes(`${word}_`)) ?? staged[0] ?? sectionList[0] ?? "";
  };
  const steps = [...new Set([...COMMON_STEPS, ...(building.entities?.work_center ?? []).map((w) => String(w.step))])];

  const [values, setValues] = useState<Record<string, string | boolean>>(() => ({
    to: form.type === "connection" ? (form.to ?? endpoints.find((id) => id !== form.from) ?? "") : "",
    transport_mode: "forklift",
    direction: "bidirectional",
    minutes: "",
    door_direction: "inbound",
    staging_section: staging("inbound"),
    determination_group: "",
    step: "",
    storage_point_ref: true,
    description: "",
    controller: controllers[0] ?? "",
    rp_type: "identification_point",
    capacity: "1",
  }));
  const set = (key: string) => (e: { target: HTMLInputElement | HTMLSelectElement }) => {
    const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setValues((v) => ({ ...v, [key]: value, ...(key === "door_direction" ? { staging_section: staging(String(value)) } : {}) }));
  };
  const text = (key: string) => String(values[key]);

  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      if (form.type === "connection") {
        onChange(addConnection(building, files, {
          from: form.from, to: text("to"), direction: text("direction"), transport_mode: text("transport_mode"),
          minutes: Number(text("minutes")) || undefined,
        }));
      } else if (form.type === "door") {
        onChange(addDoor(building, files, {
          direction: text("door_direction"), staging_section: text("staging_section"), determination_group: text("determination_group").trim(),
        }));
      } else if (form.type === "work_center") {
        onChange(addWorkCenter(building, files, { step: text("step"), storage_point_ref: Boolean(values.storage_point_ref), description: text("description") }));
      } else {
        onChange(addReportingPoint(building, files, {
          controller: text("controller"), type: text("rp_type"), capacity: Math.max(1, Number(text("capacity")) || 1),
          storage_point_ref: Boolean(values.storage_point_ref), description: text("description"),
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const select = (key: string, label: string, options: string[], labels: Record<string, string> = {}) => (
    <Field label={label}>
      <select value={text(key)} onChange={set(key)}>
        {options.map((o) => <option key={o} value={o}>{labels[o] ?? o}</option>)}
      </select>
    </Field>
  );
  const pointRef = (
    <label className="check">
      <input type="checkbox" checked={Boolean(values.storage_point_ref)} onChange={set("storage_point_ref")} /> Bestand kann hier gebucht
      werden (storage_point_ref)
    </label>
  );
  const description = (
    <Field label="Beschreibung (optional)">
      <input value={text("description")} onChange={set("description")} />
    </Field>
  );

  return (
    <form className="edit-form" onSubmit={submit} data-form={form.type}>
      <h3>{TITLE[form.type]}</h3>
      {form.type === "connection" && (
        <>
          <p>Von <strong>{form.from}</strong></p>
          {select("to", "Nach", endpoints.filter((id) => id !== form.from))}
          {select("transport_mode", "Transportart", TRANSPORT_MODES, MODE_LABEL)}
          {select("direction", "Richtung", DIRECTIONS, DIRECTION_LABEL)}
          <Field label="Fahrzeit in Minuten (optional)">
            <input type="number" min="1" value={text("minutes")} onChange={set("minutes")} />
          </Field>
        </>
      )}
      {form.type === "door" && (
        <>
          {select("door_direction", "Art", DOOR_DIRECTIONS, DOOR_LABEL)}
          {select("staging_section", "Bereitstellung (staging_section)", sectionList)}
          <Field label="Ermittlungsgruppe (optional)">
            <input value={text("determination_group")} onChange={set("determination_group")} placeholder="z. B. pallets" />
          </Field>
        </>
      )}
      {form.type === "work_center" && (
        <>
          <Field label="Prozessschritt">
            <input value={text("step")} onChange={set("step")} list="steps" required />
            <datalist id="steps">{steps.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          {pointRef}
          {description}
        </>
      )}
      {form.type === "reporting_point" && (
        <>
          {select("controller", "Steuerung", controllers)}
          {select("rp_type", "Typ", REPORTING_POINT_TYPES, RP_LABEL)}
          <Field label="Kapazität (Ladeeinheiten)">
            <input type="number" min="1" value={text("capacity")} onChange={set("capacity")} />
          </Field>
          {pointRef}
          {description}
        </>
      )}
      <p className="hint">Die ID vergibt das Werkzeug; sie ändert sich danach nicht mehr.</p>
      {error && <p className="status error">{error}</p>}
      <div className="actions">
        <button type="submit">Hinzufügen</button>
        <button type="button" className="secondary" onClick={onCancel}>Abbrechen</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
