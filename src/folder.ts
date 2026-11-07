import { DATA_DIRS, REPOS, type RepoName, type UserFile } from "./types";

export interface ScannedFile {
  path: string; // relative to the opened folder
  text: string;
}

export interface Scan {
  rootName: string;
  files: ScannedFile[];
}

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", "dist"]);
const TEXT_FILE = /\.(ya?ml|json)$/i;
const MAX_FILES = 5000;

// Chromium's File System Access API; not in TypeScript's DOM lib yet.
interface DirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
}
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
}
type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle> };

export const canPickDirectory = () => typeof (window as PickerWindow).showDirectoryPicker === "function";

export async function pickDirectory(): Promise<Scan> {
  const root = await (window as PickerWindow).showDirectoryPicker!({ mode: "read" });
  const files: ScannedFile[] = [];
  async function walk(dir: DirectoryHandle, prefix: string) {
    for await (const entry of dir.values()) {
      if (files.length >= MAX_FILES) throw new Error(`Mehr als ${MAX_FILES} Dateien – bitte einen kleineren Ordner wählen.`);
      if (entry.kind === "directory") {
        if (!SKIP_DIRS.has(entry.name)) await walk(entry, `${prefix}${entry.name}/`);
      } else if (TEXT_FILE.test(entry.name)) {
        files.push({ path: `${prefix}${entry.name}`, text: await (await entry.getFile()).text() });
      }
    }
  }
  await walk(root, "");
  return { rootName: root.name, files };
}

/** Fallback for browsers without the File System Access API (read-only). */
export async function scanFileList(list: FileList): Promise<Scan> {
  const all = Array.from(list);
  const rootName = all[0]?.webkitRelativePath.split("/")[0] ?? "";
  const files: ScannedFile[] = [];
  for (const file of all) {
    const parts = file.webkitRelativePath.split("/").slice(1);
    if (parts.some((p) => SKIP_DIRS.has(p)) || !TEXT_FILE.test(file.name)) continue;
    files.push({ path: parts.join("/"), text: await file.text() });
  }
  return { rootName, files };
}

const repoNamed = (name: string) => REPOS.find((r) => r.toLowerCase() === name.toLowerCase());
const isData = (path: string) => DATA_DIRS.some((d) => path.startsWith(`${d}/`));

export type Layout =
  | { kind: "workspace"; repos: RepoName[] } // folder holds several repos side by side
  | { kind: "repo"; repo: RepoName } // folder is one repo
  | { kind: "unknown" }; // repo-shaped data, but which repo?

export function detectLayout(scan: Scan): Layout {
  const top = new Set(scan.files.map((f) => f.path.split("/")[0]));
  const repos = REPOS.filter((r) => [...top].some((t) => t.toLowerCase() === r.toLowerCase()));
  if (repos.length) return { kind: "workspace", repos };
  const own = repoNamed(scan.rootName);
  return own ? { kind: "repo", repo: own } : { kind: "unknown" };
}

/** The user's data files, assigned to repos; `chosen` resolves an unknown layout. */
export function assign(scan: Scan, layout: Layout, chosen?: RepoName): UserFile[] {
  const out: UserFile[] = [];
  for (const file of scan.files) {
    let repo: RepoName | undefined;
    let path = file.path;
    if (layout.kind === "workspace") {
      const [head, ...rest] = file.path.split("/");
      repo = repoNamed(head);
      path = rest.join("/");
    } else {
      repo = layout.kind === "repo" ? layout.repo : chosen;
    }
    if (repo && isData(path)) out.push({ repo, path, text: file.text });
  }
  return out;
}
