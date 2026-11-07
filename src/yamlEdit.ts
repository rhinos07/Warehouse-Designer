// Edits to the repos' YAML files as text splices: every byte outside the
// changed values stays as it was - comments, quoting, alignment and blank
// lines included - so a saved file diffs like a hand edit.
import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair, type Scalar, type YAMLMap, type YAMLSeq } from "yaml";

export type Value = string | number | boolean | null | Value[] | { [key: string]: Value } | undefined;
export type Item = { id: string } & Record<string, Value>;

export class EditError extends Error {}

/** The parsed file as plain data. */
export function readYaml(text: string): Record<string, unknown> {
  const value = parseDocument(text).toJS();
  return value && typeof value === "object" ? value : {};
}

function parse(text: string) {
  const doc = parseDocument(text);
  if (doc.errors.length) throw new EditError(`Die Datei ist kein gültiges YAML: ${doc.errors[0].message}`);
  return doc;
}

function topPair(text: string, key: string): Pair<Node, Node | null> | undefined {
  const doc = parse(text);
  if (!isMap(doc.contents)) return undefined;
  return doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node | null> | undefined;
}

const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
function lineEnd(text: string, pos: number) {
  const end = text.indexOf("\n", Math.max(0, pos - 1));
  return end < 0 ? text.length : end;
}
const lineAt = (text: string, start: number) => text.slice(start, lineEnd(text, start + 1));
const column = (text: string, pos: number) => pos - lineStart(text, pos);

/** Whether a blank line precedes the line at `start`, past any comment lines. */
function blankBefore(text: string, start: number): boolean {
  while (start > 0) {
    const line = lineAt(text, lineStart(text, start - 1)).trim();
    if (!line) return true;
    if (!line.startsWith("#")) return false;
    start = lineStart(text, start - 1);
  }
  return false;
}

/** Offset of the "-" that opens a block sequence item. */
function dashOf(text: string, item: Node): number {
  let pos = item.range![0] - 1;
  while (pos >= 0 && text[pos] === " ") pos--;
  if (text[pos] !== "-") throw new EditError("Unerwartetes Listenformat.");
  return pos;
}

// ---- Writing values in the file's style -----------------------------------

/** Whether the file pads inline maps and lists: `{ value: 1 }` rather than `{value: 1}`. */
export function padded(text: string): boolean {
  const spaced = (text.match(/[{[] \S/g) ?? []).length;
  const tight = (text.match(/[{[][^\s}\]]/g) ?? []).length;
  return spaced > tight;
}

const isObject = (v: unknown): v is Record<string, Value> => !!v && typeof v === "object" && !Array.isArray(v);
const isScalarValue = (v: unknown) => v === null || typeof v !== "object";
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;

function scalarText(value: Value, original?: Scalar): string {
  if (typeof value !== "string") return value === null || value === undefined ? "null" : String(value);
  if (original?.type === "QUOTE_SINGLE") return `'${value.replace(/'/g, "''")}'`;
  const plainSafe = /^[A-Za-z_][A-Za-z0-9_.\-/]*( [A-Za-z0-9_.\-/]+)*$/.test(value) && !RESERVED.test(value);
  if (original?.type === "PLAIN" && plainSafe) return value;
  return JSON.stringify(value);
}

function flowText(value: Value, pad: boolean): string {
  const p = pad ? " " : "";
  if (Array.isArray(value)) return value.length ? `[${p}${value.map((v) => flowText(v, pad)).join(", ")}${p}]` : "[]";
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    return entries.length ? `{${p}${entries.map(([k, v]) => `${k}: ${flowText(v, pad)}`).join(", ")}${p}}` : "{}";
  }
  return scalarText(value);
}

/** Small values go inline, as the repos write quantities and id lists. */
const inline = (value: Value) =>
  isScalarValue(value) ||
  (Array.isArray(value) && value.every(isScalarValue)) ||
  (isObject(value) && Object.keys(value).length <= 4 && Object.values(value).every(isScalarValue));

/** The text after `key:` for a value whose nested lines are indented by `indent`. */
function valueText(value: Value, indent: number, pad: boolean): string {
  if (inline(value) || (Array.isArray(value) && !value.length) || (isObject(value) && !Object.keys(value).length)) {
    return ` ${flowText(value, pad)}`;
  }
  return blockText(value, indent, pad);
}

/** A map or list as block lines at `indent`, each line starting with "\n". */
function blockText(value: Value, indent: number, pad: boolean): string {
  const sp = " ".repeat(indent);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!isObject(item)) return `\n${sp}- ${flowText(item, pad)}`;
        const entries = Object.entries(item).filter(([, v]) => v !== undefined);
        return entries
          .map(([k, v], i) => `\n${sp}${i ? "  " : "- "}${k}:${valueText(v, indent + 4, pad)}`)
          .join("");
      })
      .join("");
  }
  return Object.entries(value as Record<string, Value>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `\n${sp}${k}:${valueText(v, indent + 2, pad)}`)
    .join("");
}

/** A list item in the file's style, its dash at `column`. */
export function formatItem(item: Record<string, Value>, column: number, pad = false): string {
  return blockText([item], column, pad).slice(1);
}

// ---- Adding and removing list items ----------------------------------------

/** Appends an item to the top-level list `key`, creating the list if needed. */
export function appendItem(text: string, key: string, item: Record<string, Value>): string {
  const pad = padded(text);
  const pair = topPair(text, key);
  if (!pair) {
    const body = text.length && !text.endsWith("\n") ? `${text}\n` : text;
    return `${body}${body.trim() ? "\n" : ""}${key}:\n${formatItem(item, 2, pad)}\n`;
  }
  const seq = pair.value;
  if (isSeq(seq) && !seq.flow && seq.items.length) {
    const items = seq.items as Node[];
    const dash = dashOf(text, items[0]);
    // Keep the list's spacing: a blank line between items if it has one.
    const blank = items.length < 2 || blankBefore(text, lineStart(text, dashOf(text, items[1])));
    const end = lineEnd(text, items[items.length - 1].range![1]);
    return `${text.slice(0, end)}\n${blank ? "\n" : ""}${formatItem(item, column(text, dash), pad)}${text.slice(end)}`;
  }
  if (seq === null || (isScalar(seq) && seq.value === null) || (isSeq(seq) && !seq.items.length)) {
    const start = lineStart(text, pair.key.range![0]);
    const end = lineEnd(text, seq?.range ? seq.range[1] : pair.key.range![1]);
    return `${text.slice(0, start)}${key}:\n${formatItem(item, 2, pad)}${text.slice(end)}`;
  }
  throw new EditError(`„${key}“ ist keine Blockliste – bitte von Hand ändern.`);
}

/** The lines of a block sequence item, with the comment and blank lines that lead into it. */
function itemRegion(text: string, items: Node[], index: number): [number, number] {
  let start = lineStart(text, dashOf(text, items[index]));
  while (start > 0) {
    const previous = lineStart(text, start - 1);
    const line = lineAt(text, previous).trim();
    if (line && !line.startsWith("#")) break;
    start = previous;
  }
  let end = Math.min(text.length, lineEnd(text, items[index].range![1]) + 1);
  if (index === 0) {
    // First item: keep the lines after the list key, drop the gap to the next item instead.
    while (start < end && !lineAt(text, start).trim()) start = lineEnd(text, start + 1) + 1;
    while (end < text.length && !lineAt(text, end).trim()) end = lineEnd(text, end + 1) + 1;
  }
  return [start, end];
}

/** An item: by its id, or by its position for lists without ids. */
export type ItemRef = string | number;

function findItem(text: string, key: string, ref: ItemRef): { pair: Pair<Node, Node | null>; seq: YAMLSeq; items: Node[]; index: number } {
  const pair = topPair(text, key);
  const seq = pair?.value;
  if (!pair || !isSeq(seq)) throw new EditError(`Liste „${key}“ nicht gefunden.`);
  const items = seq.items as Node[];
  const index = typeof ref === "number" ? (ref < items.length && isMap(items[ref]) ? ref : -1) : items.findIndex((it) => isMap(it) && it.get("id") === ref);
  if (index < 0) throw new EditError(`„${ref}“ steht nicht in „${key}“.`);
  if (seq.flow) throw new EditError(`„${key}“ ist keine Blockliste – bitte von Hand ändern.`);
  return { pair, seq, items, index };
}

/** Removes the item with this id from the top-level list `key`, with the comments directly above it. */
export function removeItem(text: string, key: string, ref: ItemRef): string {
  const { pair, items, index } = findItem(text, key, ref);
  if (items.length === 1) {
    const start = lineStart(text, pair.key.range![0]);
    const end = lineEnd(text, items[0].range![1]);
    return `${text.slice(0, start)}${key}: []${text.slice(end)}`;
  }
  const [start, end] = itemRegion(text, items, index);
  return text.slice(0, start) + text.slice(end);
}

// ---- Changing a list item field by field -----------------------------------

type Splice = { start: number; end: number; text: string };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** End of a node's value, before the newline its range may include. */
function valueEnd(text: string, node: Node): number {
  let end = node.range![1];
  while (end > node.range![0] && text[end - 1] === "\n") end--;
  return end;
}

class Patcher {
  splices: Splice[] = [];
  constructor(readonly text: string, readonly pad: boolean) {}

  /** Changes `node` (holding `before`) to `after`. False if the node's shape does not allow it in place. */
  value(node: Node | null, before: unknown, after: Value, _indent: number): boolean {
    if (same(before, after)) return true;
    if (isScalar(node) && isScalarValue(before) && isScalarValue(after)) {
      this.splices.push({ start: node.range![0], end: node.range![1], text: scalarText(after, node) });
      return true;
    }
    if (isMap(node) && isObject(before) && isObject(after)) return this.map(node, before, after);
    if (isSeq(node) && Array.isArray(before) && Array.isArray(after)) return this.seq(node, before, after);
    return false;
  }

  map(node: YAMLMap, before: Record<string, unknown>, after: Record<string, Value>): boolean {
    const pairs = node.items as Pair<Scalar, Node | null>[];
    const keys = (obj: object) => Object.keys(obj).filter((k) => (obj as Record<string, unknown>)[k] !== undefined);
    if (node.flow) {
      if (!same(keys(before), keys(after))) {
        this.splices.push({ start: node.range![0], end: node.range![1], text: flowText(after, this.pad) });
        return true;
      }
      return pairs.every((p) => this.value(p.value, before[String(p.key.value)], after[String(p.key.value)], 0));
    }
    const kept = pairs.filter((p) => after[String(p.key.value)] !== undefined);
    if (!kept.length) return false;
    const col = column(this.text, pairs[0].key.range![0]);
    for (const p of pairs) {
      const key = String(p.key.value);
      if (after[key] === undefined) {
        this.removePair(p);
      } else if (!this.value(p.value, before[key], after[key], col + 2)) {
        this.replacePairValue(p, after[key], col + 2);
      }
    }
    const added = Object.keys(after).filter((k) => after[k] !== undefined && !pairs.some((p) => String(p.key.value) === k));
    if (added.length) {
      const last = kept[kept.length - 1];
      const at = lineEnd(this.text, last.value ? valueEnd(this.text, last.value) : last.key.range![1]);
      const sp = " ".repeat(col);
      this.splices.push({ start: at, end: at, text: added.map((k) => `\n${sp}${k}:${valueText(after[k], col + 2, this.pad)}`).join("") });
    }
    return true;
  }

  seq(node: YAMLSeq, before: unknown[], after: Value[]): boolean {
    const items = node.items as Node[];
    if (node.flow || before.every(isScalarValue) || after.every(isScalarValue)) {
      if (node.flow) this.splices.push({ start: node.range![0], end: node.range![1], text: flowText(after, this.pad) });
      else return false;
      return true;
    }
    if (!items.length) return false;
    const dashCol = column(this.text, dashOf(this.text, items[0]));
    const byId = [...before, ...after].every((v) => isObject(v) && typeof v.id === "string");
    // Pair old and new items: by id where every item has one, else by position.
    const match = (i: number) => (byId ? after.findIndex((v) => (v as Item).id === (before[i] as Item).id) : i < after.length ? i : -1);
    const pairs = before.map((_, i) => match(i));
    const keptOrder = pairs.filter((j) => j >= 0);
    if (keptOrder.some((j, k) => k > 0 && j < keptOrder[k - 1])) return false; // reordered
    let lastKept = -1;
    pairs.forEach((j, i) => {
      if (j < 0) {
        const [start, end] = itemRegion(this.text, items, i);
        this.splices.push({ start, end, text: "" });
        return;
      }
      lastKept = i;
      if (!this.value(items[i], before[i], after[j], dashCol + 2)) {
        this.splices.push({ start: items[i].range![0], end: valueEnd(this.text, items[i]), text: blockText([after[j]], dashCol, this.pad).slice(dashCol + 3) });
      }
    });
    const added = after.filter((_, j) => !pairs.includes(j));
    if (added.length) {
      if (lastKept < 0) return false;
      const blank = items.length > 1 && blankBefore(this.text, lineStart(this.text, dashOf(this.text, items[1])));
      const at = lineEnd(this.text, valueEnd(this.text, items[lastKept]));
      this.splices.push({ start: at, end: at, text: added.map((v) => `${blank ? "\n" : ""}${blockText([v], dashCol, this.pad)}`).join("") });
    }
    return true;
  }

  removePair(p: Pair<Scalar, Node | null>) {
    let start = lineStart(this.text, p.key.range![0]);
    if (this.text.slice(start, p.key.range![0]).trim()) throw new EditError("cannot remove the first field of a list item");
    // Comment lines directly above the field describe it: they go too.
    while (start > 0 && lineAt(this.text, lineStart(this.text, start - 1)).trim().startsWith("#")) start = lineStart(this.text, start - 1);
    const end = Math.min(this.text.length, lineEnd(this.text, p.value ? valueEnd(this.text, p.value) : p.key.range![1]) + 1);
    this.splices.push({ start, end, text: "" });
  }

  replacePairValue(p: Pair<Scalar, Node | null>, value: Value, indent: number) {
    const colon = this.text.indexOf(":", p.key.range![1]);
    const end = p.value ? valueEnd(this.text, p.value) : colon + 1;
    this.splices.push({ start: colon + 1, end, text: valueText(value, indent, this.pad) });
  }

  apply(): string {
    const sorted = [...this.splices].sort((a, b) => b.start - a.start);
    sorted.forEach((s, i) => {
      if (i && s.end > sorted[i - 1].start) throw new EditError("overlapping edits");
    });
    return sorted.reduce((text, s) => text.slice(0, s.start) + s.text + text.slice(s.end), this.text);
  }
}

/**
 * Replaces the item with this id in the top-level list `key` by `value`,
 * changing only the fields that differ. Comments stay with the fields they
 * describe; a removed field takes the comment lines directly above it along.
 */
export function updateItem(text: string, key: string, ref: ItemRef, value: Record<string, Value>): string {
  const { items, index } = findItem(text, key, ref);
  const node = items[index] as YAMLMap;
  const before = node.toJSON();
  const patcher = new Patcher(text, padded(text));
  try {
    if (patcher.value(node, before, value, 0)) return patcher.apply();
  } catch (error) {
    if (!(error instanceof EditError)) throw error;
  }
  // The shape changed too much for field-by-field splices: rewrite the item.
  const dash = dashOf(text, node);
  const end = valueEnd(text, node);
  return text.slice(0, dash) + formatItem(value as Item, column(text, dash), padded(text)).trimStart() + text.slice(end);
}

/** The item in the top-level list `key`, as plain data. */
export function getItem(text: string, key: string, ref: ItemRef): Item {
  const { items, index } = findItem(text, key, ref);
  return (items[index] as YAMLMap).toJSON() as Item;
}
