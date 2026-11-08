"""Collects real findings of the repos' own tools, for tests/findings-corpus.json.

Breaks the example data on purpose - one kind of damage per file at a
time - and records every finding the repo's validate.py and Warehouse-as-
Code's check_sites.py report that the intact data does not. The page's
translator (src/findings.ts) is tested against this corpus, so a new kind
of finding in a spec repo shows up as an untranslated line.

Usage: python3 scripts/collect-findings.py SPECS_DIR WORK_DIR OUT.json REPO
  SPECS_DIR holds the five spec repos side by side; run once per REPO
  (in parallel if you like), then merge with --merge OUT.json IN.json...
"""
import copy
import glob
import json
import os
import re
import shutil
import subprocess
import sys

import yaml

REPOS = ["Topology-as-Code", "Allocation-as-Code", "OrderOrchestration-as-Code", "MasterData-as-Code", "Warehouse-as-Code"]
KINDS = ["unknown", "drop", "extra", "type", "negative", "dupid"]


def copy_repos(specs, work):
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    for name in REPOS:
        source = next(p for p in glob.glob(f"{specs}/*") if os.path.basename(p).lower() == name.lower())
        shutil.copytree(source, f"{work}/{name}", ignore=shutil.ignore_patterns(".git", "__pycache__", ".venv", "node_modules"))


def run(work, repo):
    base = f"{work}/{repo}"
    if repo == "Warehouse-as-Code":
        commands = [[sys.executable, "tools/check_sites.py", "--repos-dir", work]]
    else:
        commands = [[sys.executable, "tools/validate.py", c] for c in sorted(glob.glob("customers/*/company.yaml", root_dir=base))]
    output = []
    for command in commands:
        done = subprocess.run(command, cwd=base, capture_output=True, text=True, timeout=300)
        output.append(done.stdout + done.stderr)
    return [line.strip()[2:].replace(f"{work}/", "") for line in "\n".join(output).splitlines() if line.strip().startswith("- ")]


def damage(value, kind, depth=0):
    """One kind of damage, applied throughout a file's data."""
    if isinstance(value, dict):
        keys = list(value)
        out = {}
        for i, key in enumerate(keys):
            if kind == "drop" and depth == 1 and i == len(keys) - 1 and key != "id":
                continue  # the last field of each entry
            out[key] = value[key] if key == "id" else damage(value[key], kind, depth + 1)
        if kind == "extra" and depth == 1:
            out["zz_unexpected"] = 1
        return out
    if isinstance(value, list):
        return [damage(v, kind, depth + 1) for v in value]
    if isinstance(value, str) and kind == "unknown":
        return "ZZ_UNKNOWN"
    if isinstance(value, bool):
        return "maybe" if kind == "type" else value
    if isinstance(value, (int, float)) and kind == "negative":
        return -5
    return value


def collect(specs, work, out, repo):
    copy_repos(specs, work)
    checked = [repo] if repo == "Warehouse-as-Code" else [repo, "Warehouse-as-Code"]
    baseline = {r: set(run(work, r)) for r in checked}
    found = set()
    files = sorted(glob.glob(f"{work}/{repo}/customers/**/*.yaml", recursive=True) + glob.glob(f"{work}/{repo}/sites/**/*.yaml", recursive=True))
    for path in files:
        original = open(path, encoding="utf-8").read()
        data = yaml.safe_load(original)
        if not isinstance(data, dict):
            continue
        for kind in KINDS:
            broken = {}
            for key, value in data.items():
                if kind == "dupid" and isinstance(value, list) and value and isinstance(value[0], dict):
                    broken[key] = value + [copy.deepcopy(value[0])]
                else:
                    broken[key] = damage(value, kind) if isinstance(value, (dict, list)) else value
            if broken == data:
                continue
            with open(path, "w", encoding="utf-8") as file:
                yaml.safe_dump(broken, file, sort_keys=False)
            for r in checked:
                found.update(line for line in run(work, r) if line not in baseline[r])
            with open(path, "w", encoding="utf-8") as file:
                file.write(original)
        print(f"{path[len(work) + 1:]}: {len(found)}", file=sys.stderr)
    json.dump(sorted(found), open(out, "w", encoding="utf-8"), indent=0, ensure_ascii=False)


def merge(out, inputs):
    """One example per kind of finding: lines that differ only in quoted values and numbers count as one."""
    lines = set()
    for path in inputs:
        lines.update(line if isinstance(line, str) else line[1] for line in json.load(open(path, encoding="utf-8")))
    kept = {}
    for line in sorted(lines):
        kept.setdefault(re.sub(r"\d+", "N", re.sub(r"'[^']*'", "'", line)), line)
    json.dump(sorted(kept.values()), open(out, "w", encoding="utf-8"), indent=0, ensure_ascii=False)
    print(f"{len(lines)} findings, {len(kept)} kinds -> {out}")


if __name__ == "__main__":
    if sys.argv[1] == "--merge":
        merge(sys.argv[2], sys.argv[3:])
    else:
        collect(*sys.argv[1:5])
