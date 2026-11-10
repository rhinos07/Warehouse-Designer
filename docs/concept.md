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

Phase 5 status: the "Aufträge" tab shows each OrderOrchestration order type as diagrams, and the data tab edits its rules.

| Topic | Decision / implementation |
|---|---|
| Diagrams | **Flow:** order → split rules → workflow triggers; split rules → completion rules → follow-up action (`spawn_order` with target and "supersedes the order", or `reallocate_remainder`). **Status machine:** statuses and transitions, with terminal statuses marked. The order type's imports are found by file name, as `validate.py` does. |
| Editing | Through the phase 4 forms: split rules, workflow triggers, completion rules, statuses and transitions as lists; `shortage_policy` and `fields` as single objects. "+ Split-Regel", "+ Trigger" and "+ Abschlussregel" open a new entry, and a diagram node opens its rule. Catalog suggestions also follow references into another repo's catalog (e.g. a trigger's `Topology-as-Code's elements/process_types.yaml`). |
| Feedback | After every change OrderOrchestration's `validate.py` checks the customer; rules named in findings are marked in the diagram. |
| Simulation | Not built with WMS-POC, by decision of 2026-11-07: WMS-POC is a private repository, so the public page would publish its code, and the build would need a token for it. On 2026-11-09 the page got a small simulation of its own instead (see "Material flow" below). |

Findings in project language (open point from phase 1, done 2026-11-08):

| Topic | Decision / implementation |
|---|---|
| Approach | The tools stay unchanged and keep reporting in English; the page translates their findings (`src/findings.ts`). The path becomes a location (Topologie · example_customer · PA11 · Halle 3 · Lagerstruktur), the entity the subject (Tor DOOR_01), and patterns turn the message into a German sentence. Field names and values stay as they are, quoted, so they can still be found in the files. The original line stays available under "Original". |
| Coverage | `scripts/collect-findings.py` damages the example data on purpose: one kind of damage per file (unknown references, missing or unexpected fields, wrong types, negative numbers, duplicate ids). It records what each repo's `validate.py` and Warehouse-as-Code's `check_sites.py` report. That gave 3,074 findings of 698 kinds, kept in `tests/findings-corpus.json`. The unit test requires every kind to be translated and no English phrasing to remain. Rules that compare two fields (e.g. minimum shelf life at receipt longer than the whole shelf life) cannot be produced this way; they are tested with lines taken from the tools' source. |
| New findings | A finding no pattern knows is shown with its original text and a readable location. When a spec repo adds a check, re-run the script and add a pattern for each new kind the unit test lists. |

Language switch (2026-11-08): the page is available in German and English ("DE | EN" at the top; the first visit follows the browser language, the choice is stored in the browser).

- **Texts:** all texts are in `src/i18n.tsx`, in two tables with the same keys (248 texts). The unit test checks:
  - both tables have the same keys and placeholders;
  - no German letters appear in the English texts;
  - every key the code uses exists.
- **Findings:** in German they are translated (see above). In English they keep the tools' own wording, which is English already, with location and subject in English.
- **Switching** applies at once and keeps unsaved edits. Entries in the change log keep the language they were made in.

AutomationML export (prototype, 2026-11-09). This follows the comparison in Warehouse-as-Code's `docs/standards-crosswalk.md`, idea 5: AutomationML as a bridge to plant engineering, export side only.

| Topic | Decision / implementation |
|---|---|
| Source | The compiled building, the same compiler output the diagram uses, not the authored YAML. This follows ADR-0001's layering: the compiled contract (L2) is exported, and the authored files stay untouched. The worker now also passes the building's sections, lanes, conveyors and every storage point. |
| Format | One CAEX 3.0 file per hall. AutomationML's base libraries are copied into the file, as the AutomationML Editor does for a new file. They come from `Empty.aml` in AutomationML e.V.'s AMLEngine2.1 repository (MIT licence). |
| Roles | The project defines its own role class library (`WarehouseAsCodeRoleClassLib`), and each role derives from a base role (Resource, ResourceStructure, Group). The extended and DMI libraries (Site, Area, Storage, StorageUnit, Transport, ...) were not used. Their exact class paths could not be checked against IEC 62714, and a wrong path would break the file in AutomationML tools. Instead, each role's description names the role it corresponds to. |
| Connections | Each physical connection (connection, lane, conveyor) is an element with one port per end. The port's direction is seen from the connection: In, Out or InOut. Each end is joined to the place's `Transport` port by an InternalLink. Transport mode, duration and capacity become attributes. A conveyor with more than two ends also lists its paths, because the ports alone do not say which ends are joined. This is crosswalk idea 6, "ports instead of node-to-node edges", in the export only. The authored model is unchanged. |
| Templates | Equipment types, workstation templates and lane templates become system unit classes. Elements refer to them through `RefBaseSystemUnitPath`. Attributes are filled from Topology's `elements/` catalogs where the id is found there. This is crosswalk idea 7: role, template and instance kept apart. |
| Activity areas | Groups whose members are mirror objects (`RefBaseSystemUnitPath` = the master's ID) of the storage types and sections they take bins from. |
| Ids | AutomationML wants unique ids, usually random GUIDs. Here they are UUIDs (version 8) derived from the building and the as-code id. The same data gives the same file, so two exports can be compared, which counters the crosswalk's objection that AutomationML files diff poorly. |
| Not exported | Movement rules (no place for rules in AutomationML), the aisle, bay and shelf level, and geometry. The authored data has no coordinates for storage types, doors or work centers, so a COLLADA geometry would have to be invented. |
| Checks | The unit test exports a small hall and checks escaping, stable ids, nesting, link ends and skipped references. The browser test exports hall 3 after edits in the editor. It checks with the browser's XML parser that every link, role, template and mirror reference resolves. The three example halls' exports were also validated against the official `CAEX_ClassModel_V.3.0.xsd`. That check was manual: the XSD is not part of the repository, so CI does not run it. |
| Open | Opening the file in the AutomationML Editor has not been tried. The role mapping should be checked against IEC 62714-2 and the "Modelling of Material Handling" recommendation. Import (a layout planner's AutomationML file as the skeleton of a new building) is not built. Hall 3 gives a file of about 3 MB, almost all of it storage points. |
| Without storage points | Checkbox "ohne Lagerplätze" (added 2026-11-09). Storage points are left out, except those a connection ends at, so no link loses an end. Each storage type gets a `storage_point_count` attribute instead, and the file name ends in `_without_storage_points`. Hall 3 goes from about 3 MB to about 65 KB. Both variants of all three example halls validate against the CAEX 3.0 XSD. |

AutomationML import (prototype, 2026-11-09). This is the other direction of crosswalk idea 5: a layout planner's AutomationML file as the skeleton of a new Topology building.

| Topic | Decision / implementation |
|---|---|
| Reading | `src/xml.ts`: a small XML reader instead of the browser's DOMParser, so the import also runs in the Node unit tests. `src/amlImport.ts` reads every InstanceHierarchy: InternalElements with role, system unit class, attributes and ports, mirror objects, and InternalLinks. A link side may be written `ID:port` or as an interface ID. |
| Kinds | Proposed from the role. This page's own roles map one to one. Standard roles map where the crosswalk rates the fit good or partial: Storage → storage type, StorageUnit → storage point, Gate → door, Conveyor/Transport → connection, Site/Area/Enterprise → facility/building/company. WorkCenter is not mapped, because it is a false friend. Everything else is proposed as "not taken over". The preview lets the user change each proposal. Storage points are counted, not listed. |
| Fields | An attribute becomes a YAML field only where the schema of that list has a field of that name. The schema decides, not a hand-written mapping, so a schema change in Topology-as-Code applies to the import without code changes. Values are typed back (`xs:int`, `xs:boolean`, a measure with unit → `{value, unit}`, nested and list attributes). Missing required fields get a default and a note. Fields in the schema's order. |
| What the compiler adds | The import undoes what `compile.py` derived. Connections derived from a shared controller (`controller_internal`) are skipped. A work center's capacity taken from its template stays with the template. Route positions of storage points are dropped, because they come from the storage type's routing. A system unit class becomes `template`, `workstation_template` or the equipment `type`. Mirror objects become an activity area's `bins_from`. |
| Connections | A connection element with two ends becomes a `connections` entry. Ports In/Out give `one_way`; otherwise it is `bidirectional`. With more than two ends, or `source_type: lane`, it becomes a lane. Conveyor segments and the main conveyor come back as such. A link straight between two places (no connection element) becomes a two-way walking connection, with a note. |
| Ids | Names that break the schema's id rules become ids: upper case for storage types, doors, work centers and activity areas, with umlauts transliterated (`Förderer 1` → `FOERDERER_1`). Duplicates get a number. Each rename is noted. |
| Skeleton rules | A storage type without storage points gets one place for the whole area, as the AutoStore grid has, because the schema requires points or a generator. A door's staging section cannot be guessed: it stays empty, and validate.py reports it. |
| New files | Until now the page only changed files it had read. Edits may now create files: they are listed as new, compiled and validated like the rest, and saved into the opened folder; the folder writer creates directories and refuses if the file exists by then. A file is saved only where the folder holds its repo; otherwise the page asks to download it. Edits made together (an import's files and the facility.yaml line) are one entry in the change log and undone together. |
| Checked | Round trip of this page's export, with storage points: AS01 and LP01 come back as halls that pass validate.py and compile to the same places, connections and activity areas (movement rules aside, as they are not exported). Hall 3 comes back with one finding: a channel storage type needs a `storage_point_generator`, which a list of points cannot replace. An export without storage points comes back with sections that have no members, which validate.py reports. The browser test imports the AS01 export as `hall_2`, validates it, and saves it into a (scripted) folder. It then imports a hand-written planner file (`tests/fixtures/layout-planner.aml`) and undoes it. |
| Open | Generators (racks, channels) are not reconstructed from points. Movement rules are not in AutomationML. Geometry (COLLADA) is not read. Only tried with files written by this page and by hand, not with a real planning tool's export. |

Material flow (prototype, 2026-11-09). This is the option "a small simulation of the page's own" from phase 5. The goal is to see how material can flow through a hall, not to calculate its capacity. It has two stages, both in the tab "Materialfluss".

| Topic | Decision / implementation |
|---|---|
| Stage 1: reachability | `src/flow.ts`. For each inbound or returns door and each storage type, and for each storage type and each outbound door: the quickest path over the compiled `can_edge`s (Dijkstra on travel time), and the verdict of the movement rules. Also listed: storage types without any connection, and doors whose `staging_section` has no connection to the door. |
| Reading the rules | A move is checked from start to target, not at each node on the way. A matching rule with `allowed: false` forbids the move. A storage type with `movement_policy: explicit_only` needs an allowed rule that names it on its side of the move. A missing side or `*` is not enough. Everything else is allowed. `exclude_to`/`exclude_from` are respected. Sections and activity areas narrow a rule to part of a storage type; the simulation works per storage type, so they show as a note only. This is our reading of Topology-as-Code's intent, not a rule its validator states. |
| Stage 2: simulation | `src/simulation.ts`, a discrete-event simulation in TypeScript, without Pyodide. A flow is start, optional stop ("über"), target and load units per hour. Arrivals are exponential, from a seeded random generator, so a run can be repeated. A flow runs only if each leg has a path and, with the rule check on, is allowed. |
| Capacities | Work center: one load unit at a time, 3600 / `throughput_capacity` s each (the throughput unit is read as load units). Reporting point: `capacity` at a time, 10 s each. Conveyor segment: `capacity` load units on it at a time. Main conveyor: at most `capacity_units_per_hour` entries per hour, shared by all its links. Storage type: as many load units as storage points. A flow into it reserves a place before the load unit starts. A flow out of it needs stock. The initial fill is set in percent. |
| Assumptions | Without `expected_duration`, the travel time is a default per transport mode (conveyor 30 s, lane 90 s, forklift 120 s, tugger 180 s, AMR 90 s, walking 60 s, internal 20 s). The page marks such paths. Vehicles, staff and travel inside a storage type are not modeled. |
| Display | The topology layout with straight edges, so the dots follow the lines. Edges a flow uses are drawn solid, the others pale. Nodes show their stock or how busy they are, and a badge with the queue. The resource that is busiest at 85 % or more is marked red as the bottleneck. Results per flow: created, done, throughput per hour, mean lead time. |
| Hall 3 findings | With the rule check on, only the manual areas FIX and STAGING take part in a flow. HBR is `explicit_only`, and no rule names a move into or out of it from a door or the packing station. Six storage types have no connection at all. DOOR_03 names `STAGING.SEC_STAGING_RETURNS` as its staging section, but no connection leads there. With the rule check off and 150 load units per hour in and out of HBR, the main conveyor (200 per hour, shared) is the bottleneck. |
| Tests | `tests/unit.ts` checks the routing, the rule reading and the simulation on a small hall built by hand: the same seed gives the same result, a work center at 90 per hour with a capacity of 60 becomes the bottleneck, and an empty or full storage type stops its flow. `tests/e2e.mjs` checks hall 3's reachability and an 8 h run in the browser. |
| Open | Stage 3: take the target from Allocation-as-Code's putaway rules and the source from its search strategy, instead of choosing them by hand. Create moves from OrderOrchestration's orders and split rules. Limit vehicles and staff. |

Hall plan (prototype, stage 1, 2026-11-10). The flow diagram shows what is connected, but not where things are. The hall plan shows the physical places of a hall in top view. It has two stages.

| Topic | Decision / implementation |
|---|---|
| What the data has | The inner structure of the storage types: bays with aisle and bay number, shelves with their level, channels, and a `size` for most storage points. The schema also has a `position` (x, y, z) for a storage point; in hall 3 one of 1210 points uses it. Missing: a position or footprint for storage types, doors, work centers and reporting points, and the hall's dimensions. |
| Stage 1: schematic plan | `src/floorplan.ts` builds the plan from the compiled building, `src/HallPlan.tsx` draws it in the topology tab ("Flussdiagramm / Hallenplan"). A storage type is a block. With bays it shows one row per aisle number and one cell per bay; the cell's width is the places side by side times the place width, its depth the place depth (times the channel depth). Without bays it shows one cell per place. Scale: 26 px per metre; smaller cells are enlarged to 14 px. |
| Calculated and assumed | The blocks are packed into rows, work centers and reporting points below them, doors in the lower wall. This arrangement is calculated, not real, and the page says so above the plan. Assumed: 1.6 m between rack rows (the data has no aisle width) and 1.2 × 0.8 m for a place without `size`. An aisle number is drawn as one rack row; whether racks stand on both sides of an aisle is not in the data. |
| Marks | Fill color by `storage_condition` (ambient, chilled, frozen, other, none). Orange frame for places with `hazmat_classes`. Hatching for a bay or place with a blocked storage point. Dashed border for an assumed size. Findings mark a block as in the flow diagram. |
| Details | A bay opens a side view: its levels from top to bottom, each place, alternative layouts (`layout_variant`) on separate lines, a channel as one box with its depth, a blocked place in red. A block or door opens the same details as in the flow diagram. Editing stays in the flow diagram. |
| Data | The compile step now also passes `bay` and `shelf` to the page (`src/runner.py`). |
| Hall 3 findings | COLD_ZONE_B, FIX and HAZMAT_A have `access_model: rack`, but no bays and shelves in the compiled data, so their levels cannot be shown. 125 places have no `size` (HBR_FLEX, STAGING and AUTOSTORE_A). |
| Stage 2 | Built on 2026-11-10, see "Hall plan, stage 2" below. |
| Tests | `tests/unit.ts` checks a rack and a block storage type built by hand: rows, bays, footprints, marks, no overlap, the door in the wall. `tests/e2e.mjs` checks hall 3 (48 bays of HBR, the chilled and hazardous places, the bay with the blocked place and its side view) and the AutoStore hall. |

Hall plan, stage 2 (2026-11-10): real positions.

| Topic | Decision / implementation |
|---|---|
| Where the layout is kept | In Topology-as-Code's schema, by decision of 2026-11-10: the layout is desired structure, and other tools can use it. New optional fields (Topology-as-Code #33): `warehouse.layout` (width, depth), `storage_type.footprint` (position, width, depth) and `position` on doors, work centers and reporting points. One corner of the layout is the reference point. `validate.py` checks that everything lies inside the layout, that footprints do not overlap and that a storage point's position lies inside its storage type's footprint. |
| Drawing | `floorPlan` draws a "real" plan as soon as a building states a layout, a footprint or a position. The hall takes the layout's size; without one, the frame encloses what is placed. A storage type is drawn at its footprint, with its rows and bays spread over it (so not to scale there). A door, work center or reporting point is centered on its position. The reference point is the upper left corner, x to the right, y downwards. Elements without a place wait in a frame to the right of the hall. A building with no layout field keeps the calculated arrangement of stage 1. |
| Editing | In the hall plan with "Bearbeiten" (`src/editor.ts`). Dragging writes a storage type's `footprint` or an element's `position`, snapped to a 0.5 m grid; a stated height (`z`) is kept. "Lage übernehmen" writes the plan as drawn: the hall's size and a place for every element without one, as one entry in the change log, undone together. "Größe setzen" writes `warehouse.layout`. Width and depth of a footprint are edited in the element's form, which is built from the schema and so got the new fields without code. The edits are field-level splices as everywhere else: only the changed lines differ. |
| Feedback | After every edit the building is recompiled and checked with `validate.py`, as in the flow diagram. The four layout findings have German sentences in `src/findings.ts`. |
| Example data | Hall 3 of `example_customer` states a complete layout (60 × 50 m, example values). The other two halls state none and show the calculated arrangement until a layout is adopted. |
| Tests | `tests/unit.ts`: a hall with layout (hall size, a block at its footprint, bays spread over it, a door on its position, a waiting block), the layout edits on the example files (grid, changed lines, one change per file) and the findings. `tests/e2e.mjs`: hall 3 stands as its data says; in LP01 the layout is adopted and passes `validate.py`, a storage type is dragged, and a hall that is too small fails with a German finding. |
| Open | No rotation, no floors above each other, no shapes other than rectangles: Topology-as-Code does not model them. The course of lanes and conveyors is not in the data; connections stay straight lines. |

Material flow on the hall plan (2026-11-10). The material flow tab has the same switch as the topology tab: "Flussdiagramm / Hallenplan". A hall that states its layout opens on the hall plan; the user's choice wins after that.

| Topic | Decision / implementation |
|---|---|
| One simulation, two views | The simulation does not know the view. Switching keeps its state. |
| Drawing | `FloorPlanCanvas` (`src/HallPlan.tsx`) takes marks for blocks and spots, a look for each connection and an overlay. The material flow passes: stock or utilization as an area's second line, the queue as a badge, the bottleneck in red, a marked path, pale lines for connections no flow uses, and the load units as dots. |
| Path of a load unit | Along the plan's straight line of its connection, from edge to edge of the two areas. The real course of lanes and conveyors is not in the data. Travel time is as before (`expected_duration` or the default per transport mode); the distance in the plan does not change it. |
| Open | Travel times from distances in the layout, once lanes and conveyors have a course. |

Resizing a footprint in the hall plan (2026-11-10). With "Bearbeiten", every block has handles on its corners and edges (React Flow's `NodeResizer`). Dropping a handle writes the storage type's `footprint` (position, width and depth) on the 0.5 m grid, through the same edit as a move (`placeStorageType`), so it is checked by `validate.py` and undone the same way. The smallest footprint is 1 × 1 m. Resizing a block without a footprint places it. While a handle is dragged, the bays keep their old layout; they are spread over the new footprint after the recompile.

Floor plan image behind the hall plan (2026-11-10).

| Topic | Decision / implementation |
|---|---|
| Use | Place the areas on a drawing of the hall: load the image, set its scale, then drag and resize the blocks on it. |
| Calibration | Three numbers: the width the image shows in metres (the scale; the height follows from the image's proportions), and x and y of its upper left corner from the reference point (may be negative). A new image gets the hall's width. An opacity slider. No rotation. |
| Where it is kept | In the browser only: `localStorage`, one entry per hall (`plan-background:<dataset id>`), image as data URL. It is not written to the repo's files. This follows the page's rule that files do not leave the browser, and needs no schema change. The price: a colleague does not get the image with the repo, and a large image may not fit the browser's storage. Then the page says so and keeps it until the reload. |
| Drawing | `FloorPlanCanvas` takes the background as one more input and draws it as a node below the hall (`src/HallPlan.tsx`). With a background, blocks are half transparent and the hall has no fill. The material flow tab reads the same entry and shows the image too. Controls and storage: `src/planBackground.tsx`. |
| Tests | `tests/e2e.mjs` loads `tests/fixtures/floor-plan.svg` (a drawn 60 × 50 m hall): the image covers hall 3 exactly, width and x change scale and place, it survives a reload, another hall does not show it, and removing it clears the storage. |
| Open | Keeping the image with the data needs a field in Topology-as-Code (e.g. a file reference with scale and offset on `warehouse.layout`) and a place for the file in the repo. Setting the scale by clicking two points of known distance. |
