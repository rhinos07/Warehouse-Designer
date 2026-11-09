// A small XML reader for AutomationML files: elements, attributes and text,
// enough for CAEX. Runs in the browser and in the Node unit tests alike
// (Node has no DOMParser). Namespace prefixes are dropped from names.

export interface XmlElement {
  name: string; // local name, e.g. InternalElement
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string; // the element's own text, trimmed
}

export class XmlError extends Error {}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith("#x")) return String.fromCodePoint(parseInt(ref.slice(2), 16));
    if (ref.startsWith("#")) return String.fromCodePoint(parseInt(ref.slice(1), 10));
    return ENTITIES[ref] ?? whole;
  });
}

const local = (name: string) => name.slice(name.indexOf(":") + 1);

/** Parses a document; throws XmlError with the position for what is not well-formed. */
export function parseXml(source: string): XmlElement {
  const text = source.replace(/^﻿/, "");
  let pos = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const fail = (message: string): never => {
    const line = text.slice(0, pos).split("\n").length;
    throw new XmlError(`${message} (line ${line})`);
  };
  while (pos < text.length) {
    const lt = text.indexOf("<", pos);
    const chunk = text.slice(pos, lt < 0 ? text.length : lt);
    if (stack.length) stack[stack.length - 1].text += decode(chunk);
    else if (chunk.trim()) fail("text outside the root element");
    if (lt < 0) break;
    pos = lt;
    if (text.startsWith("<!--", pos)) {
      const end = text.indexOf("-->", pos);
      if (end < 0) fail("unclosed comment");
      pos = end + 3;
    } else if (text.startsWith("<![CDATA[", pos)) {
      const end = text.indexOf("]]>", pos);
      if (end < 0) fail("unclosed CDATA section");
      if (stack.length) stack[stack.length - 1].text += text.slice(pos + 9, end);
      pos = end + 3;
    } else if (text.startsWith("<?", pos)) {
      const end = text.indexOf("?>", pos);
      if (end < 0) fail("unclosed processing instruction");
      pos = end + 2;
    } else if (text.startsWith("<!", pos)) {
      const end = text.indexOf(">", pos); // DOCTYPE without an internal subset
      if (end < 0) fail("unclosed declaration");
      pos = end + 1;
    } else if (text.startsWith("</", pos)) {
      const end = text.indexOf(">", pos);
      if (end < 0) fail("unclosed end tag");
      const name = local(text.slice(pos + 2, end).trim());
      const open = stack.pop();
      if (!open || open.name !== name) fail(`end tag </${name}> does not match <${open?.name ?? ""}>`);
      open!.text = open!.text.trim();
      pos = end + 1;
    } else {
      const tag = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(pos, pos + 200));
      if (!tag) fail("invalid tag");
      pos += tag![0].length;
      const element: XmlElement = { name: local(tag![1]), attrs: {}, children: [], text: "" };
      const attr = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?>)/y;
      let closed = false;
      for (;;) {
        attr.lastIndex = pos;
        const m = attr.exec(text);
        if (!m) fail(`invalid attribute in <${element.name}>`);
        pos = attr.lastIndex;
        if (m![5]) {
          closed = m![5] === "/>";
          break;
        }
        if (!m![1].startsWith("xmlns")) element.attrs[local(m![1])] = decode(m![3] ?? m![4]);
      }
      if (stack.length) stack[stack.length - 1].children.push(element);
      else if (root) fail("a second root element");
      else root = element;
      if (!closed) stack.push(element);
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> is not closed`);
  if (!root) throw new XmlError("no root element");
  return root;
}

export const childrenNamed = (e: XmlElement, name: string) => e.children.filter((c) => c.name === name);
export const childNamed = (e: XmlElement, name: string) => e.children.find((c) => c.name === name);
