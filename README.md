# Warehouse Designer

A browser tool for the as-code repo family
([`Topology-as-Code`](https://github.com/rhinos07/Topology-as-Code),
[`Allocation-as-Code`](https://github.com/rhinos07/Allocation-as-Code),
[`OrderOrchestration-as-Code`](https://github.com/rhinos07/OrderOrchestration-as-Code),
[`MasterData-as-Code`](https://github.com/rhinos07/MasterData-as-Code),
composed per site by [`Warehouse-as-Code`](https://github.com/rhinos07/Warehouse-as-Code)).
It runs without a server and is published with GitHub Pages:
**https://rhinos07.github.io/Warehouse-Designer/**

Concept, decisions and planned phases: [`docs/concept.md`](docs/concept.md).

## Status: phase 5, all planned phases built (simulation left open), plus an AutomationML export and import prototype

- **Open a folder** with YAML definitions and check it with the repos' own
  validators: each repo's `tools/validate.py` per customer,
  OrderOrchestration's `tools/validate_examples.py`, and, if the folder has
  site manifests, Warehouse-as-Code's cross-repo `tools/check_sites.py`
  (ids across repos and consistency rules R1-R12).
- **Check the repos' example data** without a folder, e.g. in a meeting.
- **See each building's topology** as a flow diagram (tab "Topologie"),
  compiled with Topology-as-Code's own `tools/compile.py`:
  - nodes are storage types, doors, work centers and reporting points;
  - edges are the physical connections ("kann"), colored by transport mode;
  - movement rules ("darf") can be shown on top;
  - clicking a node shows its data;
  - after a check, nodes named in findings are marked red.
- **Edit the topology** in the diagram ("Bearbeiten"):
  - add doors, work centers and reporting points;
  - draw connections ("kann") between nodes;
  - delete connections, lanes and conveyor segments, and delete elements
    once nothing in the building refers to them.

  The page assigns ids (e.g. `DOOR_04`), which do not change afterwards.
  After every edit the page recompiles the building and runs Topology's
  `validate.py` for that customer, so a bad edit shows at once and can be
  undone.
- **Edit master data, rules and topology attributes as forms** (tab "Daten").
  The forms are generated from the repos' own JSON Schemas:
  - MasterData: items, packaging, sourcing and lifecycle;
  - Allocation: search, putaway, fixed-bin and area rules;
  - Topology: every element list, e.g. storage types, doors and movement
    rules.

  How the forms behave:
  - Required fields are always shown; optional ones can be added.
  - Fields that reference a catalog (e.g. `elements/uom_types.yaml`) suggest
    its ids.
  - What a form cannot express (alternative shapes, free maps) is edited as
    YAML.
  - Ids are set when an entry is created and stay fixed afterwards.

  After every change the edited customers are checked with each repo's
  `validate.py`; entries with findings are marked. In the topology editor,
  "Alle Attribute bearbeiten …" opens a node's full form.
- **See and design order workflows** (tab "Aufträge"). For each
  OrderOrchestration order type there are two diagrams:
  - the flow: order → split rules → workflow triggers, and split rules →
    completion rules → follow-up action (a new order, or reallocating the
    rest);
  - the status machine, with terminal statuses marked.

  Clicking a rule shows its settings. "Bearbeiten …", "+ Split-Regel",
  "+ Trigger" and "+ Abschlussregel" open the data tab's form, where the
  rules, statuses, transitions, shortage policy and fields of an order type
  are edited. Each change is validated with OrderOrchestration's
  `validate.py`; rules with findings are marked in the diagram.
- **Findings in project language.** The tools report in English, with file
  paths and schema terms. The page shows each finding as a German sentence:
  - **where:** area, customer, site, hall and what the file holds;
  - **what:** e.g. "Artikel ITEM_003";
  - **why:** what is wrong.

  The tool's original line stays one click away. `src/findings.ts` holds
  the patterns. `tests/findings-corpus.json` holds one real finding of every
  kind the tools produce on broken example data (698 kinds, collected with
  `scripts/collect-findings.py`); the unit test requires all of them to be
  translated.
- **German or English** (switch "DE | EN" at the top). The first visit
  follows the browser's language; the choice is kept in the browser.
  - **German:** findings are German sentences, as described above.
  - **English:** findings keep the tools' own wording, with location and
    subject in English.

  All texts live in `src/i18n.tsx`, one table per language. The unit test
  checks that both tables have the same entries and placeholders.
- **AutomationML export (prototype).** "AutomationML exportieren" in the
  topology tab downloads the selected hall, as compiled at that moment and
  with unsaved edits, as a CAEX 3.0 file (`.aml`). Planning, layout and
  simulation tools that read AutomationML (IEC 62714) can open it
  (`src/automationml.ts`). What the file contains:
  - **hierarchy:** company → facility → building → storage types →
    sections → storage points;
  - **other places:** doors, work centers and reporting points;
  - **devices:** controllers and equipment;
  - **connections:** each physical connection is an element with one port
    per end, linked to a port of each place;
  - **activity areas:** groups of mirror objects;
  - **templates:** equipment types, workstation templates and lane
    templates, as system unit classes.

  The roles come from the project's own role class library, and each derives
  from an AutomationML base role. Each role's description names the standard
  role it corresponds to, following Warehouse-as-Code's
  `docs/standards-crosswalk.md`.

  What the file leaves out:
  - movement rules, because AutomationML has no place for rules;
  - the aisle, bay and shelf level.

  "ohne Lagerplätze" leaves out the individual storage points. Each storage
  type then states only how many it has (`storage_point_count`). Storage
  points a connection ends at stay in, so every link keeps both ends. Hall 3
  shrinks from about 3 MB to about 65 KB.

  Ids are derived from the data, so exporting the same data twice gives the
  same file. The example halls' exports were checked against the official
  CAEX 3.0 XSD (see [`docs/concept.md`](docs/concept.md)).
- **AutomationML import (prototype).** "AutomationML importieren …" in the
  topology tab turns an `.aml` file into a new hall (`src/amlImport.ts`).
  The file can come from a layout planner or from this page's own export.
  1. **Preview:** each element gets a proposed kind from its role. The
     roles of this page's export map one to one. Standard roles map where
     the crosswalk rates the fit good or partial: Storage, StorageUnit, Gate,
     Conveyor, Transport, Site and Area. Every proposal can be changed;
     elements without a known role are proposed as "nicht übernehmen".
  2. **Target:** choose the facility and the new hall's id.
  3. **Result:** the page writes `warehouse.yaml`,
     `structure/storage.yaml`, `wcs.yaml` and `lanes.yaml`, and adds the hall
     to the facility's `facility.yaml`. Topology's `validate.py` checks it
     right away.

  How the import fills the files:
  - **Attributes** become fields where the Topology schema of that list has
    a field of that name, in the schema's order.
  - **Missing required fields** get defaults.
  - **Free names** become schema-conform ids (`Förderer 1` → `FOERDERER_1`).
  - **Connections** come from InternalLinks. A connection element's port
    directions give one-way or two-way.

  A list under "Bitte prüfen" shows what was renamed, assumed or left out.
  The import is one entry in the change log and is undone in one step.
  Saving into the opened folder creates the new files.
- **Review and save:** unsaved edits are listed with a diff per file. New
  files are marked "neu".
  - "In Ordner speichern" writes them back into the opened folder (Edge and
    Chrome). It refuses if a file changed on disk in the meantime.
  - Elsewhere, or for the example data, the changed files can be
    downloaded instead.
- Files never leave the browser.

A folder can be a single repo checkout (or a synced SharePoint/OneDrive copy
of one), or a directory holding several repos side by side. Only the data
folders `customers/`, `sites/` and `examples/` are read from it; tools,
schemas and catalogs (`elements/`) always come from the page's build.

Opening a folder uses the File System Access API in Edge and Chrome; other
browsers fall back to a folder upload field, which is enough for reading.
Saving into the folder needs Edge or Chrome; the browser asks for write
permission on the first save.

Edits change the YAML files as text, not by rewriting them (`src/yamlEdit.ts`):
only the added or removed list item, or the changed fields of an entry, change. Comments, quoting, alignment and
blank lines stay as they are, so the saved file diffs like a hand edit and can
go through the repo's usual pull request review.

## How it works

The validators are not rewritten. The page runs the repos' Python tools in
the browser with [Pyodide](https://pyodide.org) inside a web worker
(`src/worker.ts`, `src/runner.py`). Pyodide cannot start processes, so
`runner.py` replaces `subprocess.run([sys.executable, script, ...])` - how
the site check calls Topology's and MasterData's `compile.py` - with running
the script in the same interpreter.

The build (`npm run bundle`) packs:

- `public/specs.json`: `tools/`, `schemas/`, `elements/` and the example
  data of the five spec repos, with their commits (shown in the page footer);
- `public/pyodide/`: a self-hosted Pyodide runtime (about 15 MB) with the
  wheels the validators need, checked against Pyodide's lock-file sha256.
  Self-hosting keeps the page working where a company network blocks CDNs.

CI (`.github/workflows/pages.yml`) builds against the spec repos' current
`main`, runs the browser test, and deploys `main` to Pages - also daily, so
the page follows changes in the spec repos.

## Development

```bash
npm ci
SPECS_DIR=..  npm run bundle   # directory holding the spec repos side by side
npm run dev                    # or: npm run build && npm run test:unit && npm run test:e2e
```

`PYODIDE_DIR=<dir>` makes `npm run bundle` take the wheels from a local
directory instead of the Pyodide CDN.

## GitHub Pages setup

Once, in the repository settings: **Settings → Pages → Build and deployment →
Source: GitHub Actions**.
