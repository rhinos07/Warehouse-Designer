export const REPOS = [
  "Topology-as-Code",
  "Allocation-as-Code",
  "OrderOrchestration-as-Code",
  "MasterData-as-Code",
  "Warehouse-as-Code",
] as const;
export type RepoName = (typeof REPOS)[number];

/** Folders a user's data may supply; tools, schemas and catalogs always come from the page. */
export const DATA_DIRS = ["customers", "sites", "examples"];

export interface UserFile {
  repo: RepoName;
  path: string;
  text: string;
}

export interface CheckInfo {
  id: string;
  repo: RepoName;
  title: string;
}

export interface CheckResult extends CheckInfo {
  ok: boolean;
  errors: string[];
  warnings: string[];
  output: string;
  ms: number;
}

export type SpecsInfo = Record<string, { commit: string | null; files: number }>;

export type ToWorker =
  | { type: "init"; base: string }
  | { type: "run"; repos: RepoName[]; files: UserFile[] | null };

export type FromWorker =
  | { type: "status"; text: string }
  | { type: "ready"; specs: SpecsInfo; generatedAt: string }
  | { type: "plan"; checks: CheckInfo[] }
  | { type: "result"; result: CheckResult }
  | { type: "done" }
  | { type: "error"; message: string };
