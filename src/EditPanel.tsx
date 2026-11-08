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
import { modeLabel, type Graph } from "./graph";
import { t, tl } from "./i18n";
import type { Building } from "./types";

export type Form =
  | { type: "connection"; from: string; to?: string }
  | { type: "door" }
  | { type: "work_center" }
  | { type: "reporting_point" };


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

  const select = (key: string, label: string, options: string[], labelOf: (value: string) => string = (v) => v) => (
    <Field label={label}>
      <select value={text(key)} onChange={set(key)}>
        {options.map((o) => <option key={o} value={o}>{labelOf(o)}</option>)}
      </select>
    </Field>
  );
  const pointRef = (
    <label className="check">
      <input type="checkbox" checked={Boolean(values.storage_point_ref)} onChange={set("storage_point_ref")} /> {t("edit.pointRef")}
    </label>
  );
  const description = (
    <Field label={t("edit.description")}>
      <input value={text("description")} onChange={set("description")} />
    </Field>
  );

  return (
    <form className="edit-form" onSubmit={submit} data-form={form.type}>
      <h3>{t(`edit.title.${form.type}`)}</h3>
      {form.type === "connection" && (
        <>
          <p>{t("edit.from")} <strong>{form.from}</strong></p>
          {select("to", t("edit.to"), endpoints.filter((id) => id !== form.from))}
          {select("transport_mode", t("edit.transportMode"), TRANSPORT_MODES, modeLabel)}
          {select("direction", t("edit.direction"), DIRECTIONS, (v) => tl("connectionDirection", v))}
          <Field label={t("edit.minutes")}>
            <input type="number" min="1" value={text("minutes")} onChange={set("minutes")} />
          </Field>
        </>
      )}
      {form.type === "door" && (
        <>
          {select("door_direction", t("edit.doorKind"), DOOR_DIRECTIONS, (v) => tl("doorDirection", v))}
          {select("staging_section", t("edit.staging"), sectionList)}
          <Field label={t("edit.determinationGroup")}>
            <input value={text("determination_group")} onChange={set("determination_group")} placeholder={t("edit.determinationExample")} />
          </Field>
        </>
      )}
      {form.type === "work_center" && (
        <>
          <Field label={t("edit.step")}>
            <input value={text("step")} onChange={set("step")} list="steps" required />
            <datalist id="steps">{steps.map((s) => <option key={s} value={s} />)}</datalist>
          </Field>
          {pointRef}
          {description}
        </>
      )}
      {form.type === "reporting_point" && (
        <>
          {select("controller", t("edit.controller"), controllers)}
          {select("rp_type", t("edit.rpType"), REPORTING_POINT_TYPES, (v) => tl("rpType", v))}
          <Field label={t("edit.capacity")}>
            <input type="number" min="1" value={text("capacity")} onChange={set("capacity")} />
          </Field>
          {pointRef}
          {description}
        </>
      )}
      <p className="hint">{t("edit.idHint")}</p>
      {error && <p className="status error">{error}</p>}
      <div className="actions">
        <button type="submit">{t("edit.add")}</button>
        <button type="button" className="secondary" onClick={onCancel}>{t("edit.cancel")}</button>
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
