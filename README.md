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

## Status: phase 1, read-only validation

- **Open a folder** with YAML definitions and check it with the repos' own
  validators: each repo's `tools/validate.py` per customer,
  OrderOrchestration's `tools/validate_examples.py`, and, if the folder has
  site manifests, Warehouse-as-Code's cross-repo `tools/check_sites.py`
  (ids across repos and consistency rules R1-R12).
- **Check the repos' example data** without a folder, e.g. in a meeting.
- Files never leave the browser.

A folder can be a single repo checkout (or a synced SharePoint/OneDrive copy
of one), or a directory holding several repos side by side. Only the data
folders `customers/`, `sites/` and `examples/` are read from it; tools,
schemas and catalogs (`elements/`) always come from the page's build.

Opening a folder uses the File System Access API in Edge and Chrome; other
browsers fall back to a folder upload field, which is enough for reading.
Writing files (later phases) will need Edge or Chrome.

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
npm run dev                    # or: npm run build && npm run test:e2e
```

`PYODIDE_DIR=<dir>` makes `npm run bundle` take the wheels from a local
directory instead of the Pyodide CDN.

## GitHub Pages setup

Once, in the repository settings: **Settings → Pages → Build and deployment →
Source: GitHub Actions**.
