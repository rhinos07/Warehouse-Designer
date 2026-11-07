/// <reference lib="webworker" />
import type { PyodideInterface } from "pyodide";
import runnerSource from "./runner.py?raw";
import { DATA_DIRS, type FromWorker, type RepoName, type ToWorker, type UserFile } from "./types";

interface Specs {
  generatedAt: string;
  repos: Record<string, { commit: string | null; files: Record<string, string> }>;
}

let py: PyodideInterface;
let specs: Specs;

const post = (message: FromWorker) => self.postMessage(message);

async function init(base: string) {
  post({ type: "status", text: "Python-Laufzeit wird geladen …" });
  const { loadPyodide } = await import(/* @vite-ignore */ `${base}pyodide/pyodide.mjs`);
  py = await loadPyodide({ indexURL: `${base}pyodide/` });
  post({ type: "status", text: "Prüfwerkzeuge werden geladen …" });
  await py.loadPackage(["pyyaml", "jsonschema"]);
  const response = await fetch(`${base}specs.json`);
  if (!response.ok) throw new Error(`specs.json: HTTP ${response.status}`);
  specs = await response.json();
  py.FS.writeFile("/runner.py", runnerSource);
  py.runPython("import sys; sys.path.insert(0, '/'); import runner");
  const info = Object.fromEntries(
    Object.entries(specs.repos).map(([name, repo]) => [name, { commit: repo.commit, files: Object.keys(repo.files).length }]),
  );
  post({ type: "ready", specs: info, generatedAt: specs.generatedAt });
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

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  try {
    if (message.type === "init") await init(message.base);
    else run(message.repos, message.files);
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
