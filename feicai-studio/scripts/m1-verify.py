#!/usr/bin/env python3
"""Serial M1 verification with existing dependencies and disposable local caches.

Set M1_SHARED_NODE_MODULES to an existing dependency directory. This creates only
local symlinks, never installs/rebuilds dependencies or changes the shared tree.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
shared = Path(os.environ["M1_SHARED_NODE_MODULES"]).resolve(strict=True)
local = root / "node_modules"
# Keep the system toolchain deterministic, while allowing callers to provide
# a known Node distribution when the shell PATH does not expose node/npm.
node_bin = os.environ.get("M1_NODE_BIN")
system_path = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if node_bin:
    node_dir = str(Path(node_bin).resolve().parent)
    os.environ["PATH"] = f"{node_dir}:{system_path}"
else:
    os.environ["PATH"] = system_path
created = not local.exists() and not local.is_symlink()
backup = tempfile.TemporaryDirectory(prefix="feicai-m1-tsbuildinfo-")
originals = {}
try:
    for name in ["tsconfig.node.tsbuildinfo", "tsconfig.web.tsbuildinfo"]:
        path = root / name
        originals[name] = path.exists()
        if path.exists():
            shutil.copy2(path, Path(backup.name) / name)
    if created:
        local.mkdir()
        for dependency in shared.iterdir():
            if dependency.name not in {".vite", ".vite-temp", ".cache"}:
                (local / dependency.name).symlink_to(dependency, target_is_directory=dependency.is_dir())
    elif local.is_symlink():
        raise RuntimeError("Use a local node_modules directory to isolate verification caches")
    commands = [sys.argv[1:]] if len(sys.argv) > 1 else [
        ["npm", "run", "lint"],
        ["npm", "run", "format:check"],
        ["npm", "run", "typecheck", "--", "--force"],
        ["npm", "test"],
        ["npm", "run", "test:coverage"],
        ["npm", "run", "build"],
        ["node", "scripts/m1-dom-smoke.mjs"],
        ["node", "scripts/electron-migration-smoke.mjs"],
    ]
    for command in commands:
        print("M1_VERIFY:", " ".join(command), flush=True)
        result = subprocess.run(command, cwd=root)
        if result.returncode:
            sys.exit(result.returncode)
finally:
    for name, existed in originals.items():
        path = root / name
        if existed:
            shutil.copy2(Path(backup.name) / name, path)
        elif path.exists():
            path.unlink()
    if created and local.is_dir() and not local.is_symlink():
        shutil.rmtree(local)
    backup.cleanup()
