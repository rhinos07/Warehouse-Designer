// A line diff for reviewing changes before saving: what Git would show.

export type DiffLine = { kind: " " | "+" | "-"; text: string; old?: number; new?: number };

/** Changed lines with `context` unchanged lines around them; null marks skipped lines. */
export function diffLines(before: string, after: string, context = 2): (DiffLine | null)[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // Trim the common head and tail; the edits here touch one place per file.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);
  // Longest common subsequence of the middle part.
  const lcs = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }
  const lines: DiffLine[] = a.slice(0, head).map((text, i) => ({ kind: " ", text, old: i + 1, new: i + 1 }));
  let [i, j] = [0, 0];
  const at = () => ({ old: head + i + 1, new: head + j + 1 });
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) {
      lines.push({ kind: " ", text: x[i], ...at() });
      i++, j++;
    } else if (j < y.length && (i >= x.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      lines.push({ kind: "+", text: y[j], new: at().new });
      j++;
    } else {
      lines.push({ kind: "-", text: x[i], old: at().old });
      i++;
    }
  }
  const offset = b.length - tail - (a.length - tail);
  a.slice(a.length - tail).forEach((text, k) => {
    const old = a.length - tail + k + 1;
    lines.push({ kind: " ", text, old, new: old + offset });
  });
  const keep = lines.map((_, n) => lines.slice(Math.max(0, n - context), n + context + 1).some((l) => l.kind !== " "));
  const out: (DiffLine | null)[] = [];
  lines.forEach((line, n) => {
    if (keep[n]) out.push(line);
    else if (out[out.length - 1] !== null) out.push(null);
  });
  if (out[out.length - 1] === null) out.pop();
  return out;
}

export const countChanges = (lines: (DiffLine | null)[]) => ({
  added: lines.filter((l) => l?.kind === "+").length,
  removed: lines.filter((l) => l?.kind === "-").length,
});
