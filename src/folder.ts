import { t } from "./i18n";
import { DATA_DIRS, REPOS, type RepoName, type UserFile } from "./types";

export interface ScannedFile {
  path: string; // relative to the opened folder
  text: string;
}

export interface Scan {
  rootName: string;
  files: ScannedFile[];
  /** The opened folder, if the browser can write to it (File System Access API). */
  handle?: DirectoryHandle;
}

const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "__pycache__", "dist"]);
const TEXT_FILE = /\.(ya?ml|json)$/i;
const MAX_FILES = 5000;

// Chromium's File System Access API; not in TypeScript's DOM lib yet.
type Permission = "granted" | "denied" | "prompt";
interface DirectoryHandle {
  kind: "directory";
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
  getDirectoryHandle(name: string): Promise<DirectoryHandle>;
  getFileHandle(name: string): Promise<FileHandle>;
  queryPermission(options: { mode: "readwrite" }): Promise<Permission>;
  requestPermission(options: { mode: "readwrite" }): Promise<Permission>;
}
interface FileHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(text: string): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandle> };

export const canPickDirectory = () => typeof (window as PickerWindow).showDirectoryPicker === "function";

export async function pickDirectory(): Promise<Scan> {
  const root = await (window as PickerWindow).showDirectoryPicker!({ mode: "read" });
  const files: ScannedFile[] = [];
  async function walk(dir: DirectoryHandle, prefix: string) {
    for await (const entry of dir.values()) {
      if (files.length >= MAX_FILES) throw new Error(t("folder.tooMany", { max: MAX_FILES }));
      if (entry.kind === "directory") {
        if (!SKIP_DIRS.has(entry.name)) await walk(entry, `${prefix}${entry.name}/`);
      } else if (TEXT_FILE.test(entry.name)) {
        files.push({ path: `${prefix}${entry.name}`, text: await (await entry.getFile()).text() });
      }
    }
  }
  await walk(root, "");
  return { rootName: root.name, files, handle: root };
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
    if (repo && isData(path)) out.push({ repo, path, text: file.text, source: file.path });
  }
  return out;
}

async function fileHandle(root: DirectoryHandle, path: string): Promise<FileHandle> {
  const parts = path.split("/");
  let dir = root;
  for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
  return dir.getFileHandle(parts[parts.length - 1]);
}

/**
 * Writes files back into the opened folder. Refuses, writing nothing, if any
 * of them changed on disk since the folder was read (`expected`).
 */
export async function writeFiles(root: DirectoryHandle, files: { path: string; text: string; expected: string }[]): Promise<void> {
  if ((await root.queryPermission({ mode: "readwrite" })) !== "granted" && (await root.requestPermission({ mode: "readwrite" })) !== "granted") {
    throw new Error(t("folder.noWrite"));
  }
  const changed: string[] = [];
  for (const file of files) {
    if ((await (await (await fileHandle(root, file.path)).getFile()).text()) !== file.expected) changed.push(file.path);
  }
  if (changed.length) {
    throw new Error(t("folder.changedOutside", { files: changed.join(", ") }));
  }
  for (const file of files) {
    const writable = await (await fileHandle(root, file.path)).createWritable();
    await writable.write(file.text);
    await writable.close();
  }
}
