// Edits to the repos' YAML files as text splices: every byte outside the
// changed list item stays as it was - comments, quoting, alignment and blank
// lines included - so a saved file diffs like a hand edit.
import { isMap, isScalar, isSeq, parseDocument, type Node, type Pair } from "yaml";

export type Value = string | number | boolean | Value[] | { [key: string]: Value } | undefined;
export type Item = { id: string } & Record<string, Value>;

export class EditError extends Error {}

/** The parsed file as plain data. */
export function readYaml(text: string): Record<string, unknown> {
  const value = parseDocument(text).toJS();
  return value && typeof value === "object" ? value : {};
}

function topPair(text: string, key: string): Pair<Node, Node | null> | undefined {
  const doc = parseDocument(text, { keepSourceTokens: false });
  if (doc.errors.length) throw new EditError(`Die Datei ist kein gültiges YAML: ${doc.errors[0].message}`);
  if (!isMap(doc.contents)) return undefined;
  return doc.contents.items.find((p) => isScalar(p.key) && p.key.value === key) as Pair<Node, Node | null> | undefined;
}

const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
function lineEnd(text: string, pos: number) {
  const end = text.indexOf("\n", Math.max(0, pos - 1));
  return end < 0 ? text.length : end;
}
const lineAt = (text: string, start: number) => text.slice(start, lineEnd(text, start + 1));

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

function scalar(value: Value): string {
  if (Array.isArray(value)) return `[${value.map(scalar).join(", ")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${scalar(v)}`)
      .join(", ")}}`;
  }
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

/** A list item in the repos' style: double-quoted strings, small maps and lists inline. */
export function formatItem(item: Item, column: number): string {
  const pad = " ".repeat(column);
  return Object.entries(item)
    .filter(([, v]) => v !== undefined)
    .map(([key, value], i) => `${pad}${i === 0 ? "- " : "  "}${key}: ${scalar(value)}`)
    .join("\n");
}

/** Appends an item to the top-level list `key`, creating the list if needed. */
export function appendItem(text: string, key: string, item: Item): string {
  const pair = topPair(text, key);
  if (!pair) {
    const body = text.length && !text.endsWith("\n") ? `${text}\n` : text;
    return `${body}${body.trim() ? "\n" : ""}${key}:\n${formatItem(item, 2)}\n`;
  }
  const seq = pair.value;
  if (isSeq(seq) && !seq.flow && seq.items.length) {
    const items = seq.items as Node[];
    const first = items[0];
    const column = dashOf(text, first) - lineStart(text, dashOf(text, first));
    // Keep the list's spacing: a blank line between items if it has one.
    const blank = items.length < 2 || blankBefore(text, lineStart(text, dashOf(text, items[1])));
    const end = lineEnd(text, items[items.length - 1].range![1]);
    return `${text.slice(0, end)}\n${blank ? "\n" : ""}${formatItem(item, column)}${text.slice(end)}`;
  }
  if (seq === null || (isScalar(seq) && seq.value === null) || (isSeq(seq) && !seq.items.length)) {
    const start = lineStart(text, pair.key.range![0]);
    const end = lineEnd(text, seq?.range ? seq.range[1] : pair.key.range![1]);
    return `${text.slice(0, start)}${key}:\n${formatItem(item, 2)}${text.slice(end)}`;
  }
  throw new EditError(`„${key}“ ist keine Blockliste – bitte von Hand ändern.`);
}

/** Removes the item with this id from the top-level list `key`, with the comments directly above it. */
export function removeItem(text: string, key: string, id: string): string {
  const pair = topPair(text, key);
  const seq = pair?.value;
  if (!pair || !isSeq(seq)) throw new EditError(`Liste „${key}“ nicht gefunden.`);
  const items = seq.items as Node[];
  const index = items.findIndex((it) => isMap(it) && it.get("id") === id);
  if (index < 0) throw new EditError(`„${id}“ steht nicht in „${key}“.`);
  if (seq.flow) throw new EditError(`„${key}“ ist keine Blockliste – bitte von Hand ändern.`);

  if (items.length === 1) {
    const start = lineStart(text, pair.key.range![0]);
    const end = lineEnd(text, items[0].range![1]);
    return `${text.slice(0, start)}${key}: []${text.slice(end)}`;
  }

  // Walk up over the comment and blank lines that lead into the item.
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
  return text.slice(0, start) + text.slice(end);
}
