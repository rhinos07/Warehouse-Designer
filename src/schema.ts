// JSON Schema (draft-07) as the repos use it, for building forms: $ref across
// a repo's schema files, allOf merged, and defaults for new values. Checking
// stays with the repos' own validate.py.
import { readYaml, type Value } from "./yamlEdit";
import type { Catalog } from "./types";

export type Schema = { [key: string]: any };

/** Where a schema came from, for resolving its relative $refs. */
export interface Located {
  schema: Schema;
  repo: string;
  file: string; // e.g. schemas/item.schema.json
}

const cache = new Map<string, Schema>();

function load(catalog: Catalog, repo: string, file: string): Schema {
  const key = `${repo}/${file}`;
  if (!cache.has(key)) {
    const text = catalog[repo]?.[file];
    if (text === undefined) throw new Error(`Schema ${key} fehlt im Build.`);
    cache.set(key, JSON.parse(text));
  }
  return cache.get(key)!;
}

function pointer(schema: Schema, path: string): Schema {
  return path
    .split("/")
    .filter(Boolean)
    .reduce((node, part) => node?.[decodeURIComponent(part.replace(/~1/g, "/").replace(/~0/g, "~"))], schema);
}

/** A schema by reference such as "schemas/item.schema.json" or "schemas/wcs.schema.json#/properties/x/items". */
export function schemaAt(catalog: Catalog, repo: string, ref: string): Located {
  const [file, path = ""] = ref.split("#");
  return resolve(catalog, { schema: pointer(load(catalog, repo, file), path), repo, file });
}

/** Follows $ref (keeping the referring schema's own keywords, e.g. its description) and merges allOf. */
export function resolve(catalog: Catalog, at: Located, depth = 0): Located {
  let { schema, file } = at;
  if (!schema || depth > 20) return at;
  if (schema.$ref) {
    const [target, path = ""] = String(schema.$ref).split("#");
    const targetFile = target ? file.replace(/[^/]*$/, target) : file;
    const base = pointer(load(catalog, at.repo, targetFile), path);
    const { $ref: _, ...own } = schema;
    const inner = resolve(catalog, { schema: base, repo: at.repo, file: targetFile }, depth + 1);
    return { ...inner, schema: { ...inner.schema, ...own } };
  }
  if (Array.isArray(schema.allOf)) {
    const parts = schema.allOf.map((s: Schema) => resolve(catalog, { schema: s, repo: at.repo, file }, depth + 1).schema);
    const { allOf: _, ...own } = schema;
    schema = parts.reduce(
      (merged: Schema, part: Schema) => ({
        ...part,
        ...merged,
        properties: { ...part.properties, ...merged.properties },
        required: [...new Set([...(merged.required ?? []), ...(part.required ?? [])])],
      }),
      own,
    );
  }
  return { schema, repo: at.repo, file };
}

export function child(at: Located, schema: Schema | undefined): Located {
  return { schema: schema ?? {}, repo: at.repo, file: at.file };
}

export type Kind = "enum" | "const" | "string" | "number" | "integer" | "boolean" | "object" | "array" | "yaml";

/** How a value is edited: a typed input, nested fields, or YAML text for what a form cannot express. */
export function kindOf(schema: Schema): Kind {
  if (schema.const !== undefined) return "const";
  if (Array.isArray(schema.enum)) return "enum";
  if (schema.oneOf || schema.anyOf) return "yaml";
  const type = Array.isArray(schema.type) ? undefined : schema.type;
  if (type === "object") return schema.properties ? "object" : "yaml";
  if (type === "array") return schema.items && !Array.isArray(schema.items) ? "array" : "yaml";
  if (type === "string" || type === "number" || type === "integer" || type === "boolean") return type;
  return "yaml";
}

/** A minimal value: defaults, else the required fields. */
export function emptyValue(catalog: Catalog, at: Located): Value {
  const { schema } = resolve(catalog, at);
  if (schema.default !== undefined) return schema.default;
  switch (kindOf(schema)) {
    case "const":
      return schema.const;
    case "enum":
      return schema.enum[0];
    case "string":
      return "";
    case "number":
    case "integer":
      return typeof schema.minimum === "number" ? schema.minimum : 0;
    case "boolean":
      return false;
    case "array":
      return schema.minItems ? [emptyValue(catalog, child(at, schema.items))] : [];
    case "object":
      return Object.fromEntries(
        (schema.required ?? []).map((key: string) => [key, emptyValue(catalog, child(at, schema.properties?.[key]))]),
      );
    default:
      return null;
  }
}

/**
 * Ids a field refers to, from the catalog file its description names
 * ("References an id in elements/uom_types.yaml"): suggestions, not a limit.
 */
export function suggestions(catalog: Catalog, repo: string, schema: Schema): string[] {
  const match = /elements\/([a-z_]+\.yaml)/.exec(String(schema.description ?? ""));
  const text = match && catalog[repo]?.[`elements/${match[1]}`];
  if (!text) return [];
  const ids: string[] = [];
  for (const value of Object.values(readYaml(text))) {
    if (Array.isArray(value)) for (const entry of value) if (entry && typeof entry.id === "string") ids.push(entry.id);
  }
  return ids;
}

/** The first sentence of a description, for a hint under the field. */
export function summary(description: unknown): string {
  const text = String(description ?? "").trim();
  const end = text.search(/\.(\s|$)/);
  return end > 0 ? text.slice(0, end + 1) : text;
}
