#!/usr/bin/env python3
"""Regenerate static/files/betterMDshare/index.json from the files on disk.

The app (md/index.html) rewrites this manifest itself in every commit it
makes, so you only need this after adding, removing, or renaming notes by
hand (or when first setting things up).

    python scripts/mdshare_manifest.py
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "static", "files", "betterMDshare"))
MANIFEST = os.path.join(ROOT, "index.json")
EXCLUDE = {"index.json", "vault.json"}  # app files that live beside the notes


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def mtime(path):
    """Last commit time for the file, falling back to the filesystem."""
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", path],
            capture_output=True, text=True, cwd=ROOT, check=False,
        ).stdout.strip()
        if out:
            return iso(datetime.fromisoformat(out))
    except (OSError, ValueError):
        pass
    return iso(datetime.fromtimestamp(os.path.getmtime(path), timezone.utc))


def walk(directory, top=False):
    children = []
    for name in sorted(os.listdir(directory), key=str.lower):
        if name.startswith("."):
            continue  # dotfiles (a folder's .keep) stay out of the listing
        if top and name in EXCLUDE:
            continue
        path = os.path.join(directory, name)
        if os.path.isdir(path):
            children.append({"name": name, "type": "dir", "children": walk(path)})
        else:
            children.append({
                "name": name,
                "type": "file",
                "size": os.path.getsize(path),
                "mtime": mtime(path),
            })
    return children


def main():
    if not os.path.isdir(ROOT):
        sys.exit(f"missing folder: {ROOT}")
    manifest = {
        "generated": iso(datetime.now(timezone.utc)),
        "root": {"name": "~", "type": "dir", "children": walk(ROOT, top=True)},
    }
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    files = sum(1 for _ in iter_files(manifest["root"]))
    print(f"wrote {os.path.relpath(MANIFEST, os.getcwd())} ({files} files)")


def iter_files(node):
    for child in node.get("children", []):
        if child["type"] == "dir":
            yield from iter_files(child)
        else:
            yield child


if __name__ == "__main__":
    main()
