import { useEffect, useId, useState, type ReactNode } from "react";
import { parse, stringify } from "yaml";
import { t } from "./i18n";
import { child, emptyValue, kindOf, resolve, suggestions, summary, type Located } from "./schema";
import type { Catalog } from "./types";
import type { Value } from "./yamlEdit";

type Obj = Record<string, Value>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

interface FieldProps {
  catalog: Catalog;
  at: Located;
  name: string;
  value: Value;
  onChange: (value: Value) => void;
  required?: boolean;
  onRemove?: () => void;
  readOnly?: boolean;
}

/** One value, edited as its schema says. */
export function Field(props: FieldProps) {
  const { catalog, name, value, onChange, required, onRemove, readOnly } = props;
  const at = resolve(catalog, props.at);
  const { schema } = at;
  const kind = kindOf(schema);
  const listId = useId();
  const id = useId();
  let control: ReactNode;

  if (readOnly || kind === "const") {
    control = <code className="readonly">{String(value ?? schema.const ?? "")}</code>;
  } else if (kind === "enum") {
    const options: Value[] = schema.enum.includes(value) ? schema.enum : [value, ...schema.enum];
    control = (
      <select id={id} value={String(value)} onChange={(e) => onChange(options.find((o) => String(o) === e.target.value) ?? e.target.value)}>
        {options.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}
      </select>
    );
  } else if (kind === "string") {
    const hints = suggestions(catalog, at.repo, schema);
    control = (
      <>
        <input id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} list={hints.length ? listId : undefined} pattern={schema.pattern} />
        {hints.length > 0 && <datalist id={listId}>{hints.map((h) => <option key={h} value={h} />)}</datalist>}
      </>
    );
  } else if (kind === "number" || kind === "integer") {
    control = (
      <input
        id={id}
        type="number"
        step={kind === "integer" ? 1 : "any"}
        min={schema.minimum}
        max={schema.maximum}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? (emptyValue(catalog, at) as number) : Number(e.target.value))}
      />
    );
  } else if (kind === "boolean") {
    control = <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
  } else if (kind === "object") {
    control = <ObjectFields catalog={catalog} at={at} value={isObj(value) ? value : {}} onChange={onChange} />;
  } else if (kind === "array") {
    control = <ArrayField catalog={catalog} at={at} value={Array.isArray(value) ? value : []} onChange={onChange} />;
  } else {
    control = <YamlField id={id} value={value} onChange={onChange} />;
  }

  const nested = kind === "object" || kind === "array";
  return (
    <div className={`sf-field${nested ? " sf-nested" : ""}`} data-field={name}>
      <div className="sf-label">
        <label htmlFor={nested ? undefined : id} title={schema.description}>
          {name}
          {required && <span className="sf-required" title={t("form.required")}> *</span>}
        </label>
        {onRemove && !readOnly && (
          <button type="button" className="sf-icon" onClick={onRemove} title={t("form.remove", { name })} aria-label={t("form.remove", { name })}>×</button>
        )}
      </div>
      {schema.description && <div className="sf-hint">{summary(schema.description)}</div>}
      {control}
    </div>
  );
}

/** The fields of an object: required ones always, optional ones once set or added. */
export function ObjectFields({ catalog, at, value, onChange, readOnlyKeys = [] }: {
  catalog: Catalog;
  at: Located;
  value: Obj;
  onChange: (value: Obj) => void;
  readOnlyKeys?: string[];
}) {
  const { schema } = resolve(catalog, at);
  const properties: Record<string, object> = schema.properties ?? {};
  const required: string[] = schema.required ?? [];
  const shown = [
    ...Object.keys(properties).filter((k) => required.includes(k) || value[k] !== undefined),
    ...Object.keys(value).filter((k) => !(k in properties)), // not in the schema: kept, editable as YAML
  ];
  const absent = Object.keys(properties).filter((k) => !shown.includes(k));
  const set = (key: string, v: Value) => onChange({ ...value, [key]: v });
  const remove = (key: string) => {
    const { [key]: _, ...rest } = value;
    onChange(rest);
  };
  return (
    <div className="sf-object">
      {shown.map((key) => (
        <Field
          key={key}
          catalog={catalog}
          at={child(at, properties[key] ?? {})}
          name={key}
          value={value[key]}
          onChange={(v) => set(key, v)}
          required={required.includes(key)}
          onRemove={required.includes(key) ? undefined : () => remove(key)}
          readOnly={readOnlyKeys.includes(key)}
        />
      ))}
      {absent.length > 0 && (
        <select
          className="sf-add"
          value=""
          aria-label={t("form.addField")}
          onChange={(e) => e.target.value && set(e.target.value, emptyValue(catalog, child(at, properties[e.target.value])))}
        >
          <option value="">{t("form.addFieldOption")}</option>
          {absent.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
    </div>
  );
}

function ArrayField({ catalog, at, value, onChange }: { catalog: Catalog; at: Located; value: Value[]; onChange: (v: Value[]) => void }) {
  const items = child(at, at.schema.items);
  const move = (from: number, to: number) => {
    const next = [...value];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  };
  return (
    <div className="sf-array">
      {value.map((item, i) => (
        <div key={i} className="sf-entry" data-entry={i}>
          <div className="sf-entry-head">
            <span>{i + 1}.</span>
            <button type="button" className="sf-icon" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={t("form.up")}>↑</button>
            <button type="button" className="sf-icon" disabled={i === value.length - 1} onClick={() => move(i, i + 1)} aria-label={t("form.down")}>↓</button>
            <button type="button" className="sf-icon" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={t("form.removeEntry", { n: i + 1 })}>×</button>
          </div>
          <Field catalog={catalog} at={items} name={`${i + 1}`} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} />
        </div>
      ))}
      <button type="button" className="secondary sf-add-entry" onClick={() => onChange([...value, emptyValue(catalog, items)])}>{t("form.addEntry")}</button>
    </div>
  );
}

/** For what a form cannot express (alternatives, free maps): the value as YAML text. */
function YamlField({ id, value, onChange }: { id: string; value: Value; onChange: (v: Value) => void }) {
  const shown = value === undefined ? "" : stringify(value, { lineWidth: 0 }).trimEnd();
  const [text, setText] = useState(shown);
  const [error, setError] = useState("");
  useEffect(() => setText(shown), [shown]);
  return (
    <>
      <textarea
        id={id}
        className="sf-yaml"
        rows={Math.min(12, Math.max(2, text.split("\n").length))}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            onChange(parse(text) ?? null);
            setError("");
          } catch (e) {
            setError(t("form.invalidYaml", { message: (e as Error).message.split("\n")[0] }));
          }
        }}
        spellCheck={false}
      />
      {error && <div className="sf-error">{error}</div>}
    </>
  );
}
