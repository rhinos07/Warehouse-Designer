// Packs the spec repos' tools, schemas, catalogs and example data into
// public/specs.json. The page always validates with these files; a
// user's folder only supplies data.
//
// SPECS_DIR: directory holding the repo checkouts side by side (default ./specs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPOS = [
  "Topology-as-Code",
  "Allocation-as-Code",
  "OrderOrchestration-as-Code",
  "MasterData-as-Code",
  "Warehouse-as-Code",
];
const DIRS = ["tools", "schemas", "elements", "customers", "sites", "examples"];
const EXTENSIONS = new Set([".py", ".yaml", ".yml", ".json"]);

const specsDir = path.resolve(process.env.SPECS_DIR ?? "specs");

function findRepo(name) {
  const hit = fs.readdirSync(specsDir).find((d) => d.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`${name} not found in ${specsDir}`);
  return path.join(specsDir, hit);
}

function walk(dir, rel) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name.startsWith(".")) continue;
    const relPath = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), relPath));
    else if (EXTENSIONS.has(path.extname(entry.name))) out.push(relPath);
  }
  return out;
}

function commitOf(repoDir) {
  try {
    return execFileSync("git", ["-C", repoDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const bundle = { generatedAt: new Date().toISOString(), repos: {} };
for (const name of REPOS) {
  const repoDir = findRepo(name);
  const files = {};
  for (const sub of DIRS) {
    if (!fs.existsSync(path.join(repoDir, sub))) continue;
    for (const rel of walk(path.join(repoDir, sub), sub)) {
      files[rel] = fs.readFileSync(path.join(repoDir, rel), "utf8");
    }
  }
  bundle.repos[name] = { commit: commitOf(repoDir), files };
  console.log(`${name}: ${Object.keys(files).length} files`);
}
fs.mkdirSync("public", { recursive: true });
fs.writeFileSync("public/specs.json", JSON.stringify(bundle));
