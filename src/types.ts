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

/** The page's own schemas/ and elements/ files, by repo and path: what forms and suggestions are built from. */
export type Catalog = Record<string, Record<string, string>>;

export interface UserFile {
  repo: RepoName;
  path: string; // inside the repo, e.g. customers/x/company.yaml
  text: string;
  source?: string; // path inside the opened folder, for writing back
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

/** A compiled entity as Topology's compile.py emits it; only id is guaranteed. */
export type Entity = { id: string } & Record<string, unknown>;

export interface Building {
  path: string;
  ok: boolean;
  error?: string;
  customer?: string;
  facility?: string;
  building?: string;
  name?: string;
  entities?: Record<string, Entity[]>;
  point_counts?: Record<string, number>;
  /** Imported files the editor changes, by file name (storage.yaml, wcs.yaml, lanes.yaml, movement_rules.yaml). */
  sources?: Record<string, string>;
}

export type ToWorker =
  | { type: "init"; base: string }
  | { type: "run"; repos: RepoName[]; files: UserFile[] | null }
  | { type: "compile"; files: UserFile[] | null; validate?: string[] }
  | { type: "validate"; files: UserFile[]; checks: string[] };

export type FromWorker =
  | { type: "status"; text: string }
  | { type: "ready"; specs: SpecsInfo; generatedAt: string; examples: UserFile[]; catalog: Catalog }
  | { type: "validated"; checks: CheckResult[] }
  | { type: "plan"; checks: CheckInfo[] }
  | { type: "result"; result: CheckResult }
  | { type: "done" }
  | { type: "topology"; buildings: Building[]; checks?: CheckResult[] }
  | { type: "error"; message: string };
