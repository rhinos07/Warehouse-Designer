# Warehouse-as-Code Designer UI: Concept and Status

Status: draft, 2026-11-07. Not yet confirmed. Open questions are listed at the end.

## 1. Goal

Make the Warehouse-as-Code specifications easier to access. A graphical tool shows the as-code definitions and lets users edit them. The tool must make the definitions understandable without knowledge of YAML or JSON Schema.

Related repository family (GitHub account rhinos07): Topology-as-Code, OrderOrchestration-as-Code, MasterData-as-Code, Allocation-as-Code, WMS-POC (private).

## 2. Decisions so far

| Topic | Decision |
|---|---|
| First users | Internal project staff and project managers. No customers. |
| Consequence | No tenant separation, no customer rights, no branding. |
| Storage | Definitions are JSON files on SharePoint or in directories. They are not in a Git repository. *(Revised, see section 6: YAML, as in the repos.)* |
| Delivery | Web application that runs without a server. It can be hosted on GitHub. |

## 3. Technical notes

### 3.1 File access
- The browser uses the File System Access API to open directories and write files. No server is needed.
- This API works only in Chromium browsers (Edge, Chrome). Firefox and Safari do not support it, as far as known. To verify.
- Use one storage interface with exchangeable adapters (ports and adapters).

### 3.2 SharePoint
- First step: sync the SharePoint library with OneDrive. It then appears as a normal local folder. One directory adapter is enough. The SharePoint version history stays active.
- Later option: direct access through Microsoft Graph API with MSAL sign-in in the browser. This needs an app registration in the Entra tenant. An administrator may have to approve it. Postponed.

### 3.3 Hosting
- GitHub Pages is public for normal accounts. Private pages need GitHub Enterprise Cloud, as far as known. To verify.
- The application contains no warehouse data. The data stays in the files. Code and schemas are visible if the page is public.
- Alternative: host the same static files on an internal web server or start them from a network drive.

### 3.4 Missing Git features
Without Git, three functions must be replaced:
1. **Versioning:** use the SharePoint version history. For network drives, use snapshots on save or a change log file.
2. **Parallel work:** no real locks are possible without a server. On save, the application checks if the file changed since loading. If yes, it warns. The user can discard the change or save a copy.
3. **Review separation (structure vs. strategies):** use folder permissions. Only defined groups can write to the structure folder.

### 3.5 Validation logic in the browser
- The existing Python tools `validate.py` and `compile.py` cannot run directly in the browser.
- Options: rebuild the logic in TypeScript, or run Python in the browser with Pyodide.
- Form generation from JSON Schema is possible with libraries such as react-jsonschema-form. Canvas editors can use React Flow.

## 4. Planned phases (draft)

1. **Viewer with validation.** Load JSON files, validate against the schemas, resolve all cross-references (String IDs). Show errors in project language, not as schema errors. This covers backlog item C1 (cross-repo reference integrity).
2. **Topology: read.** Graphical view of buildings, areas, handover points and lanes. The view is usable in project meetings.
3. **Topology: edit.** Draw and connect elements. The tool assigns immutable IDs. Users change only display names.
4. **Forms from JSON Schema** for item master data and allocation (search zones, selection strategy, priority rules).
5. **Workflow designer** for OrderOrchestration (split rules, triggers, completion rules). Optional simulation with the WMS-POC.

The order of phases 2 to 4 may change after the first user feedback.

## 5. Open questions

- Do all colleagues use Edge or Chrome?
- Should the application run the WMS-POC (simulation) later, or only display and edit?
- Is public hosting of code and schemas acceptable, or is an internal host needed?
- Which tools do project managers use today (Excel, PowerPoint, a project tool) that must be connected?
- TypeScript rebuild of the validation logic or Pyodide?

## 6. Decisions and findings, 2026-11-07

| Topic | Decision / finding |
|---|---|
| Repository | Own repository `rhinos07/Warehouse-Designer`. Warehouse-as-Code stays a map without an application. |
| File format | **YAML, as in the repos** - not JSON. The same files as today, in a Git checkout or a OneDrive-synced SharePoint folder. Many files carry comments with the reasons for a rule; editing (phase 3 onwards) must keep them, e.g. with the `yaml` library's document API. |
| Validation | **Pyodide**, answering the last open question. The repos' validators run **unchanged** in the browser; only `subprocess.run` is replaced by an in-process call (`src/runner.py`). Measured in headless Chromium: all 12 checks of the five repos' example data, including the cross-repo site check with R1-R12, in about 10 s. |
| Pyodide hosting | Self-hosted on the page (about 15 MB), not loaded from a CDN - company networks often block CDNs. |
| Browsers | Reading works in every browser (folder upload field as fallback). Only writing needs the File System Access API, i.e. Edge or Chrome. This narrows the first open question to phases 3 onwards. |
| Public hosting | Mostly settled: the spec repos with their code and schemas are public already, and the page sends no data anywhere. Remaining question: is it acceptable that the page's address is public? |

Still open from section 3.4: when definitions live outside Git, the CI checks and pull request review of the repos do not apply to them. The page runs the same checks on demand, but versioning and review separation still need the replacements described there.

Phase 1 status: validation with the repos' own tools works (findings list per check). Still open in phase 1: showing errors in project language instead of the validators' technical messages.

Phase 2 status: the "Topologie" tab draws each building as a flow diagram. The page compiles every `warehouse.yaml` with Topology's own `tools/compile.py`. It then draws storage types, doors, work centers and reporting points (the handover points) as nodes, and the physical connections ("kann": conveyor, lane, forklift, walking, controller-internal) as edges. The layout is computed automatically with dagre.

- **Movement rules** ("darf") can be shown on top, with forbidden rules in red. Rules whose start or target is a wildcard, area or section cannot be drawn as a line; they are listed below the diagram.
- **Node details:** clicking a node shows its attributes, its storage-point count, its connections and its rules.
- **Check findings:** after "Prüfung starten", nodes named in Topology findings are marked red.
- **Why a flow diagram and not a floor plan:** the data has no coordinates for storage types, doors or work centers; only generated storage points have a position.
- **Not shown yet:** activity areas and the aisle/bay level inside a storage type.

Phase 3 status: the topology can be edited in the diagram (checkbox "Bearbeiten").

| Topic | Decision / implementation |
|---|---|
| Scope | Add doors, work centers and reporting points. Draw explicit connections (`lanes.yaml` `connections`). Delete connections, lanes and conveyor segments. Delete doors, work centers and reporting points once no connection, lane, conveyor or movement rule of the building refers to them. |
| Ids | Assigned by the tool and never changed afterwards. Elements get the next number above the highest in use (`DOOR_04`, `WC_PACKING_01`, `RP_01`), so the id of a removed element is never reused: with `removal_policy: deactivate` the WMS still knows it. Connections are named after their ends (`MAN_DOOR_04_TO_STAGING`). |
| Names | The schemas have no display name for doors, work centers or reporting points; work centers and reporting points take the free-text `description`. A display-name field would be a schema change in Topology-as-Code. |
| YAML | Text splices instead of rewriting the file: only the changed list item differs. A round trip through a YAML library would reformat inline maps, lists and aligned comments; the splice keeps them. `tests/unit.ts` removes each of the 82 list items in the example files and checks that everything else stays the same. |
| Feedback | After every edit the page recompiles the building and runs Topology's `validate.py` for the customer, in about a second. Findings show above the diagram and as red nodes. Every edit can be undone. |
| Saving | Unsaved edits are listed with a diff per file. "In Ordner speichern" writes into the opened folder (Edge, Chrome). It writes nothing if any of the files changed on disk since the folder was read. Without a writable folder, the changed files can be downloaded. |
| Cross-repo references | A door or work center used by Allocation or OrderOrchestration is caught by "Prüfung starten" (Warehouse-as-Code's site check), not by the per-edit validation, which covers Topology only. |

Not editable yet: attributes of existing elements, storage types (sections, rack templates, generators), lanes and the main conveyor (only deletable), movement rules, controllers. Next candidates: an attribute form generated from the JSON Schemas (phase 4) and movement rules.

Phase 4 status: the "Daten" tab edits list entries through forms generated from the repos' JSON Schemas.

| Topic | Decision / implementation |
|---|---|
| Scope | One generic editor instead of one form per file type. Covered: MasterData (items, packaging, sourcing, lifecycle), Allocation (search, putaway, fixed-bin and area rules) and every Topology element list. The file/key/schema pairs are the ones each repo's `tools/validate.py` uses (`src/lists.ts`). OrderOrchestration stays for phase 5. |
| Forms | Built from the schema at run time (`src/schema.ts`, `src/SchemaForm.tsx`): `$ref` across schema files, `allOf` merged, enums as selects, nested objects and lists with add, remove and reorder. Optional fields appear once added. A description naming a catalog (`References an id in elements/x.yaml`) turns into suggestions from that catalog. `oneOf`/`anyOf` and free maps are edited as YAML text. |
| Files | Field-level splices: only changed values, added and removed fields or list entries differ. A removed field takes the comment lines directly above it along. `tests/unit.ts` changes every text field of all 194 list entries in the example data and checks the result is exactly the new values, on the same lines. |
| Ids | Entered when an entry is created (item numbers and rule ids are business keys), checked against the schema's pattern and the list, and fixed afterwards. Lists without ids (packaging, fixed bins) are addressed by position. |
| Feedback | After every change the edited customers are validated with each repo's `validate.py`; the result shows above the form and marks entries named in findings. Cross-repo references still need "Prüfung starten". |
