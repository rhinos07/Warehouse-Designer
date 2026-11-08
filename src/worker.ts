/// <reference lib="webworker" />
import type { PyodideInterface } from "pyodide";
import runnerSource from "./runner.py?raw";
import { DATA_DIRS, type Catalog, type CheckResult, type FromWorker, type RepoName, type ToWorker, type UserFile } from "./types";

interface Specs {
  generatedAt: string;
  repos: Record<string, { commit: string | null; files: Record<string, string> }>;
}

let py: PyodideInterface;
let specs: Specs;

const post = (message: FromWorker) => self.postMessage(message);

async function init(base: string) {
  post({ type: "status", text: "loadingPython" });
  const { loadPyodide } = await import(/* @vite-ignore */ `${base}pyodide/pyodide.mjs`);
  py = await loadPyodide({ indexURL: `${base}pyodide/` });
  post({ type: "status", text: "loadingTools" });
  await py.loadPackage(["pyyaml", "jsonschema"]);
  const response = await fetch(`${base}specs.json`);
  if (!response.ok) throw new Error(`specs.json: HTTP ${response.status}`);
  specs = await response.json();
  py.FS.writeFile("/runner.py", runnerSource);
  py.runPython("import sys; sys.path.insert(0, '/'); import runner");
  const info = Object.fromEntries(
    Object.entries(specs.repos).map(([name, repo]) => [name, { commit: repo.commit, files: Object.keys(repo.files).length }]),
  );
  const examples: UserFile[] = [];
  const catalog: Catalog = {};
  for (const [repo, { files }] of Object.entries(specs.repos)) {
    catalog[repo] = {};
    for (const [path, text] of Object.entries(files)) {
      if (DATA_DIRS.some((d) => path.startsWith(`${d}/`))) examples.push({ repo: repo as RepoName, path, text });
      else if (path.startsWith("schemas/") || path.startsWith("elements/")) catalog[repo][path] = text;
    }
  }
  post({ type: "ready", specs: info, generatedAt: specs.generatedAt, examples, catalog });
}

function write(path: string, text: string) {
  py.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
  py.FS.writeFile(path, text);
}

function removeTree(path: string) {
  py.globals.set("_path", path);
  py.runPython("import shutil; shutil.rmtree(_path, ignore_errors=True)");
}

/** Fresh /repos from the page's bundle; the user's data replaces the bundled data of its repos. */
function prepare(files: UserFile[] | null) {
  removeTree("/repos");
  for (const [repo, { files: bundled }] of Object.entries(specs.repos)) {
    for (const [path, text] of Object.entries(bundled)) write(`/repos/${repo}/${path}`, text);
  }
  if (!files) return;
  for (const repo of new Set(files.map((f) => f.repo))) {
    for (const dir of DATA_DIRS) removeTree(`/repos/${repo}/${dir}`);
  }
  for (const file of files) write(`/repos/${file.repo}/${file.path}`, file.text);
}

function toJs<T>(code: string): T {
  const proxy = py.runPython(code);
  const value = proxy.toJs({ dict_converter: Object.fromEntries });
  proxy.destroy();
  return value as T;
}

function run(repos: RepoName[], files: UserFile[] | null) {
  prepare(files);
  py.globals.set("_repos", py.toPy(repos));
  const checks = toJs<Record<string, unknown>[]>("runner.plan(_repos)");
  post({ type: "plan", checks: checks.map(({ id, repo, title }) => ({ id, repo, title }) as never) });
  for (const check of checks) {
    py.globals.set("_check", py.toPy(check));
    post({ type: "result", result: toJs("runner.run_check(_check)") });
  }
  post({ type: "done" });
}

/** Runs the checks with these ids (e.g. MasterData-as-Code/example_customer) on the prepared data. */
function runChecks(ids: string[]): CheckResult[] {
  const repos = [...new Set(ids.map((id) => id.split("/")[0]))];
  py.globals.set("_repos", py.toPy(repos));
  const results: CheckResult[] = [];
  for (const check of toJs<Record<string, unknown>[]>("runner.plan(_repos)")) {
    if (!ids.includes(String(check.id))) continue;
    py.globals.set("_check", py.toPy(check));
    results.push(toJs("runner.run_check(_check)"));
  }
  return results;
}

/** Compile every building; `validate` also runs Topology's validate.py for these customer folders. */
function compile(files: UserFile[] | null, validate: string[] = []) {
  prepare(files);
  const buildings = JSON.parse(py.runPython("runner.compile_buildings()"));
  const checks = validate.length ? runChecks(validate.map((c) => `Topology-as-Code/${c}`)) : undefined;
  post({ type: "topology", buildings, checks });
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    if (message.type === "init") await init(message.base);
    else if (message.type === "compile") compile(message.files, message.validate);
    else if (message.type === "validate") {
      prepare(message.files);
      post({ type: "validated", checks: runChecks(message.checks) });
    }
    else run(message.repos, message.files);
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
