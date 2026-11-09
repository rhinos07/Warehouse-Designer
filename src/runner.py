"""Runs the spec repos' own validators inside Pyodide.

Pyodide cannot start processes, so `subprocess.run([sys.executable, script, ...])`
(how Warehouse-as-Code's site check calls Topology's and MasterData's compile.py)
is replaced by running the script in this interpreter. The validators themselves
run unchanged.
"""

import contextlib
import io
import os
import runpy
import subprocess
import sys
import time

ROOT = "/repos"
SPEC_REPOS = ["Topology-as-Code", "Allocation-as-Code", "OrderOrchestration-as-Code", "MasterData-as-Code"]
SITE_REPO = "Warehouse-as-Code"


def run_script(script, argv, cwd=None):
    """Run `python script argv...` in-process; returns (exit_code, output)."""
    script = os.path.abspath(script)
    saved_argv, saved_path, saved_cwd = sys.argv, list(sys.path), os.getcwd()
    saved_modules = set(sys.modules)
    buf = io.StringIO()
    code = 0
    try:
        sys.argv = [script, *argv]
        sys.path.insert(0, os.path.dirname(script))
        if cwd:
            os.chdir(cwd)
        with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
            try:
                runpy.run_path(script, run_name="__main__")
            except SystemExit as exit_:
                code = exit_.code if isinstance(exit_.code, int) else (0 if exit_.code is None else 1)
            except Exception as error:  # a crashing validator is a finding, not a page error
                print(f"❌ 1 error(s):\n  - {type(error).__name__}: {error}")
                code = 1
    finally:
        sys.argv, sys.path[:] = saved_argv, saved_path
        os.chdir(saved_cwd)
        # Every repo has a tools/compile.py and tools/validate.py: drop what the
        # script imported so the next script gets its own repo's module.
        for name in set(sys.modules) - saved_modules:
            del sys.modules[name]
    return code, buf.getvalue()


def _subprocess_run(cmd, cwd=None, text=False, **_):
    if not cmd or cmd[0] != sys.executable:
        raise OSError(f"cannot run {cmd!r} in the browser")
    code, out = run_script(cmd[1], list(cmd[2:]), cwd=cwd)
    return subprocess.CompletedProcess(cmd, code, stdout=out if text else out.encode(), stderr="" if text else b"")


subprocess.run = _subprocess_run


def plan(repos):
    """The checks the repos' own CI runs, for the given repos' data."""
    checks = []
    for repo in SPEC_REPOS:
        if repo not in repos:
            continue
        base = f"{ROOT}/{repo}"
        customers = f"{base}/customers"
        for customer in sorted(os.listdir(customers)) if os.path.isdir(customers) else []:
            if os.path.exists(f"{customers}/{customer}/company.yaml"):
                checks.append({
                    "id": f"{repo}/{customer}", "repo": repo, "title": customer,
                    "script": f"{base}/tools/validate.py",
                    "argv": [f"customers/{customer}/company.yaml"], "cwd": base,
                })
        examples = f"{base}/examples"
        if os.path.exists(f"{base}/tools/validate_examples.py") and os.path.isdir(examples):
            for example in sorted(os.listdir(examples)):
                if os.path.isdir(f"{examples}/{example}"):
                    checks.append({
                        "id": f"{repo}/examples/{example}", "repo": repo, "title": f"Beispiel {example}",
                        "script": f"{base}/tools/validate_examples.py",
                        "argv": [f"examples/{example}"], "cwd": base,
                    })
    if SITE_REPO in repos and os.path.isdir(f"{ROOT}/{SITE_REPO}/sites"):
        checks.append({
            "id": f"{SITE_REPO}/sites", "repo": SITE_REPO, "title": "Standorte (repo-übergreifend)",
            "script": f"{ROOT}/{SITE_REPO}/tools/check_sites.py",
            "argv": ["--repos-dir", ROOT], "cwd": f"{ROOT}/{SITE_REPO}",
        })
    return checks


def findings(output):
    """Errors and warnings from the validators' shared output format."""
    errors, warnings, current = [], [], None
    for line in output.splitlines():
        if line.startswith("❌"):
            current = errors
        elif line.startswith("⚠"):
            current = warnings
        elif line.startswith("  - ") and current is not None:
            current.append(line[4:].replace(f"{ROOT}/", ""))
    return errors, warnings


TOPOLOGY = "Topology-as-Code"
# What the diagram draws, plus what the AutomationML export needs besides it.
DIAGRAM_KINDS = ["storage_type", "door", "work_center", "reporting_point", "activity_area",
                 "controller", "equipment", "can_edge", "movement_rule",
                 "section", "lane", "conveyor_segment", "conveyor_main", "warehouse"]


EDITABLE_FILES = ["storage.yaml", "wcs.yaml", "lanes.yaml", "movement_rules.yaml"]


def sources(base, path):
    """The building's imported files the editor changes, by file name - the
    way compile.py finds them - as paths inside the repo."""
    import posixpath

    import yaml

    try:
        with open(f"{base}/{path}", encoding="utf-8") as file:
            imports = ((yaml.safe_load(file) or {}).get("warehouse") or {}).get("imports") or []
    except (OSError, yaml.YAMLError, AttributeError):
        return {}
    found = {}
    for entry in imports:
        name = posixpath.basename(str(entry))
        if name in EDITABLE_FILES and name not in found:
            found[name] = posixpath.normpath(posixpath.join(posixpath.dirname(path), str(entry)))
    return found


def compile_buildings():
    """Every Topology building, compiled with Topology's own compile.py: the
    entities the diagram and the AutomationML export need. Storage points come
    separately as `points`: the diagram only counts them."""
    import glob
    import json

    import yaml

    base = f"{ROOT}/{TOPOLOGY}"
    target = "/tmp/compiled.yaml"
    buildings = []
    for warehouse in sorted(glob.glob(f"{base}/customers/*/facilities/*/buildings/*/warehouse.yaml")):
        path = warehouse[len(base) + 1:]
        if os.path.exists(target):
            os.remove(target)
        code, output = run_script(f"{base}/tools/compile.py", [path, "--output", target], cwd=base)
        building = {"path": path, "ok": code == 0 and os.path.exists(target), "sources": sources(base, path)}
        if not building["ok"]:
            building["error"] = output.replace(f"{ROOT}/", "")[-2000:]
        else:
            with open(target, encoding="utf-8") as file:
                data = yaml.safe_load(file) or {}
            entities = data.get("entities") or {}
            meta = data.get("target") or {}
            counts = {}
            for point in entities.get("storage_point") or []:
                counts[point.get("storage_type")] = counts.get(point.get("storage_type"), 0) + 1
            building.update(
                customer=meta.get("tenant"), facility=meta.get("facility"), building=meta.get("building"),
                name=((entities.get("warehouse") or [{}])[0]).get("name"),
                entities={kind: entities.get(kind) or [] for kind in DIAGRAM_KINDS},
                point_counts=counts,
                points=entities.get("storage_point") or [],
                dataset=(data.get("metadata") or {}).get("dataset_id"),
            )
        buildings.append(building)
    return json.dumps(buildings, default=str)


def run_check(check):
    started = time.perf_counter()
    code, output = run_script(check["script"], check["argv"], cwd=check["cwd"])
    output = output.replace(f"{ROOT}/", "")  # paths as in the repos: Topology-as-Code/customers/...
    errors, warnings = findings(output)
    if code != 0 and not errors:
        errors = [line for line in output.strip().splitlines()[-3:]] or [f"exit code {code}"]
    return {
        "id": check["id"], "repo": check["repo"], "title": check["title"],
        "ok": code == 0, "errors": errors, "warnings": warnings,
        "output": output, "ms": round((time.perf_counter() - started) * 1000),
    }
