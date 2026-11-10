// A floor plan image behind the hall plan, to place the areas on it.
// The image and its settings stay in the browser: they are kept in
// localStorage per hall and are not written to the repo's files.
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";

export interface PlanBackground {
  /** The image as a data URL. */
  url: string;
  name: string;
  /** Width of the image in the hall, in metres: this sets its scale. */
  width: number;
  /** Where the image's upper left corner lies, in metres from the reference point. May be negative. */
  x: number;
  y: number;
  /** 0..1 */
  opacity: number;
}

const keyOf = (hall: string) => `plan-background:${hall}`;

function read(hall: string): PlanBackground | null {
  try {
    const saved = JSON.parse(localStorage.getItem(keyOf(hall)) ?? "null") as PlanBackground | null;
    return saved && typeof saved.url === "string" && saved.width > 0 ? saved : null;
  } catch {
    return null;
  }
}

/**
 * The background of one hall. `kept` is false when the browser could not
 * store it (storage blocked or the image too large): it then lasts until the
 * page is reloaded.
 */
export function usePlanBackground(hall: string): [PlanBackground | null, (next: PlanBackground | null) => void, boolean] {
  const [state, setState] = useState<{ hall: string; value: PlanBackground | null; kept: boolean }>(() => ({ hall, value: read(hall), kept: true }));
  useEffect(() => {
    setState((s) => (s.hall === hall ? s : { hall, value: read(hall), kept: true }));
  }, [hall]);
  const set = useCallback((next: PlanBackground | null) => {
    let kept = true;
    try {
      if (next) localStorage.setItem(keyOf(hall), JSON.stringify(next));
      else localStorage.removeItem(keyOf(hall));
    } catch {
      kept = false;
      try {
        localStorage.removeItem(keyOf(hall)); // do not leave an older image behind
      } catch {
        // storage blocked
      }
    }
    setState({ hall, value: next, kept });
  }, [hall]);
  return [state.hall === hall ? state.value : read(hall), set, state.kept];
}

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Toolbar controls: load an image, set its scale, offset and opacity, remove it. */
export function PlanBackgroundControls({ value, onChange, kept, defaultWidth }: {
  value: PlanBackground | null;
  onChange: (next: PlanBackground | null) => void;
  kept: boolean;
  /** Width a new image gets, in metres: the hall's width. */
  defaultWidth: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  async function load(file: File | undefined) {
    if (!file) return;
    try {
      if (!file.type.startsWith("image/")) throw new Error(t("background.notImage"));
      onChange({ url: await readFile(file), name: file.name, width: value?.width ?? defaultWidth, x: value?.x ?? 0, y: value?.y ?? 0, opacity: value?.opacity ?? 0.6 });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (input.current) input.current.value = "";
    }
  }
  const number = (field: "width" | "x" | "y", min?: number) => (
    <input
      type="number" step={0.5} min={min} value={value![field]} data-background={field}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n) && (min === undefined || n >= min)) onChange({ ...value!, [field]: n });
      }}
    />
  );
  return (
    <div className="plan-background-controls" data-background-controls>
      <button className="secondary" onClick={() => input.current?.click()} title={t("background.hint")}>
        {value ? t("background.replace") : t("background.load")}
      </button>
      <input ref={input} type="file" accept="image/*" hidden data-background-file onChange={(e) => load(e.target.files?.[0])} />
      {value && (
        <>
          <label title={t("background.widthHint")}>{t("background.width")} {number("width", 0.5)} m</label>
          <label title={t("background.offsetHint")}>x {number("x")} m</label>
          <label title={t("background.offsetHint")}>y {number("y")} m</label>
          <label>
            {t("background.opacity")}{" "}
            <input
              type="range" min={0.1} max={1} step={0.1} value={value.opacity} data-background="opacity"
              onChange={(e) => onChange({ ...value, opacity: Number(e.target.value) })}
            />
          </label>
          <button className="secondary" onClick={() => onChange(null)} data-background-remove>{t("background.remove")}</button>
        </>
      )}
      {value && !kept && <span className="hint" data-background-not-kept>{t("background.notKept")}</span>}
      {error && <span className="forbidden">{error}</span>}
    </div>
  );
}
