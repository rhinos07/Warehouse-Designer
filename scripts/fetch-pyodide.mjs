// Puts a self-hosted Pyodide into public/pyodide/: the runtime from the
// pyodide npm package plus the wheels the validators need (pyyaml,
// jsonschema and their dependencies), checked against the lock file's
// sha256. Self-hosting keeps the page working where a company network
// blocks CDNs.
//
// PYODIDE_DIR: optional local directory holding the wheels (else the
// official CDN is used).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT_PACKAGES = ["pyyaml", "jsonschema"];
const RUNTIME = ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

const require = createRequire(import.meta.url);
const npmDir = path.dirname(require.resolve("pyodide/package.json"));
const { version } = JSON.parse(fs.readFileSync(path.join(npmDir, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(npmDir, "pyodide-lock.json"), "utf8"));
const outDir = path.resolve("public/pyodide");

function closure(names) {
  const seen = new Set();
  const visit = (name) => {
    const key = name.toLowerCase().replace(/[-_.]+/g, "-"); // PEP 503, as the lock file's keys
    if (seen.has(key)) return;
    if (!lock.packages[key]) throw new Error(`package ${name} not in pyodide-lock.json`);
    seen.add(key);
    lock.packages[key].depends.forEach(visit);
  };
  names.forEach(visit);
  return [...seen].map((key) => lock.packages[key]);
}

async function wheelBytes(fileName) {
  if (process.env.PYODIDE_DIR) return fs.readFileSync(path.join(process.env.PYODIDE_DIR, fileName));
  const url = `https://cdn.jsdelivr.net/pyodide/v${version}/full/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const file of RUNTIME) fs.copyFileSync(path.join(npmDir, file), path.join(outDir, file));
for (const pkg of closure(ROOT_PACKAGES)) {
  const bytes = await wheelBytes(pkg.file_name);
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  if (sha !== pkg.sha256) throw new Error(`${pkg.file_name}: sha256 mismatch`);
  fs.writeFileSync(path.join(outDir, pkg.file_name), bytes);
  console.log(`pyodide ${version}: ${pkg.file_name}`);
}
