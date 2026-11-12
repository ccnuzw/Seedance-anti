#!/usr/bin/env python3
"""Serial runtime acceptance; reuse dependencies and preserve shared native ABI."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

project = Path(__file__).resolve().parents[1]
node = Path('/Users/apple/Tools/node/node-v23.9.0-darwin-arm64/bin/node')
assert node.is_file(), node
os.environ['PATH'] = f'{node.parent}:/usr/bin:/bin:/usr/sbin:/sbin'
local = project / 'node_modules'
assert not local.exists() and not local.is_symlink(), 'Run with no local node_modules; dependencies are isolated by this entry point'
shared_env = os.environ.get('RUNTIME_SHARED_NODE_MODULES')
if shared_env:
    shared = Path(shared_env).resolve(strict=True)
else:
    trees = subprocess.check_output(['git', 'worktree', 'list', '--porcelain'], cwd=project, text=True)
    shared = next(Path(line[9:]) / 'feicai-studio/node_modules' for line in trees.splitlines()
                  if line.startswith('worktree ') and (Path(line[9:]) / 'feicai-studio/node_modules').is_dir())
report = Path(tempfile.mkdtemp(prefix='feicai-runtime-acceptance-', dir='/tmp'))
print(f'RUNTIME_ACCEPTANCE_REPORT={report}', flush=True)
(report / 'report.json').write_text(json.dumps({'status': 'running', 'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip(), 'node': str(node)}))
originals = {}
results = []
run_succeeded = False
native = shared / 'better-sqlite3/build/Release/better_sqlite3.node'
native_hash = hashlib.sha256(native.read_bytes()).hexdigest()
try:
    for name in ['tsconfig.node.tsbuildinfo', 'tsconfig.web.tsbuildinfo']:
        path = project / name
        originals[name] = (path.read_bytes() if path.exists() else None, path.stat() if path.exists() else None)
    local.mkdir()
    for dependency in shared.iterdir():
        if dependency.name in {'.vite', '.vite-temp', '.cache', 'better-sqlite3'}:
            continue
        (local / dependency.name).symlink_to(dependency, target_is_directory=dependency.is_dir())
    shutil.copytree(shared / 'better-sqlite3', local / 'better-sqlite3', symlinks=True)
    os.environ['RUNTIME_ACCEPTANCE_REPORT'] = str(report)
    commands = [
        ('settings-recovery', [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--no-cache',
          'src/main/io/production-commit-store.test.ts', 'src/main/services/project-service.test.ts',
          'src/main/ipc/register.test.ts', 'src/main/services/production-integration.test.ts',
          'src/main/asset/asset-manager.test.ts', 'src/main/workflow/workflow-engine.test.ts',
          'src/main/engine/art-output-merger.test.ts', 'src/main/engine/state-machine-production-retry.test.ts',
          'src/renderer/utils/refresh-settings-summary.test.ts']),
        ('batch-regression', [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--no-cache',
          'src/main/services/batch-queue-service.test.ts', 'src/main/services/batch-execution-lease.test.ts',
          'src/main/services/batch-queue-recovery.test.ts', 'src/main/ipc/batch-handlers.test.ts',
          'src/main/services/pipeline-service.test.ts']),
        ('planning-regression', [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--no-cache',
          'src/shared/plot-breakdown.test.ts', 'src/shared/project-bootstrap.test.ts',
          'src/shared/batch.test.ts', 'src/main/project/plot-breakdown-store.test.ts',
          'src/main/workflow/workflow-entry-flows.test.ts']),
        ('worker-regression', [str(node), 'node_modules/vitest/vitest.mjs', 'run', '--no-cache',
          'src/main/engine/artifact-provenance.test.ts', 'src/main/project-sync/scan.test.ts',
          'src/main/project-sync/scan-cache.test.ts', 'src/main/db/episode-sync-worker.test.ts']),
        ('typecheck', ['npm', 'run', 'typecheck', '--', '--force']),
        ('lint', ['npm', 'run', 'lint']),
        ('build', ['npm', 'run', 'build']),
        ('electron-ipc', [str(node), 'scripts/runtime-operation-acceptance.mjs']),
        ('format', [str(node), 'node_modules/prettier/bin/prettier.cjs', '--check',
          'scripts/runtime-operation-acceptance.mjs', 'docs/runtime-operation-acceptance.md',
          'src/main/services/batch-queue-service.ts', 'src/main/services/batch-queue-service.test.ts',
          'src/main/services/pipeline-service.test.ts', 'src/main/engine/art-reference.ts',
          'src/main/engine/art-output-merger.ts', 'src/main/engine/artifact-provenance.ts',
          'src/main/project-sync/scan.test.ts', 'src/shared/plot-breakdown.ts',
          'src/shared/plot-breakdown.test.ts']),
        ('diff', ['git', 'diff', '--check', 'HEAD'])
    ]
    if len(sys.argv) > 1:
        assert sys.argv[1] == 'run_checks', 'Usage: runtime-operation-acceptance.py [run_checks [check...]]'
    selected = set(sys.argv[2:])
    assert selected.issubset({name for name, _ in commands}), 'Unknown check'
    for name, command in commands:
        if selected and name not in selected:
            continue
        print(f'RUNTIME_CHECK {name}: {" ".join(command)}', flush=True)
        with (report / f'{name}.log').open('w') as log:
            child = subprocess.Popen(command, cwd=project, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            for line in child.stdout:
                print(line, end='', flush=True)
                log.write(line)
            status = child.wait()
        if name == 'electron-ipc' and status == 0:
            for phase in ['settings', 'restart']:
                evidence = json.loads((report / f'ipc-{phase}.json').read_text())
                assert evidence['checks'] and evidence['networkAttempts'] == []
        results.append({'check': name, 'exitCode': status})
        if status:
            raise RuntimeError(f'{name} failed ({status}); see {report}')
    run_succeeded = True
finally:
    for name, (data, stat) in originals.items():
        path = project / name
        if data is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(data)
            os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    if local.is_dir() and not local.is_symlink():
        shutil.rmtree(local)
    assert hashlib.sha256(native.read_bytes()).hexdigest() == native_hash, 'Shared native driver changed'
    (report / 'checks.json').write_text(json.dumps({'checks': results, 'sharedNativeUnchanged': True, 'tsbuildinfoRestored': all((project / name).read_bytes() == data if data is not None else not (project / name).exists() for name, (data, _) in originals.items())}, indent=2))
    (report / 'report.json').write_text(json.dumps({'status': 'passed' if run_succeeded else 'failed', 'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=project, text=True).strip(), 'node': str(node), 'checks': results}, indent=2))
    print(f'Evidence retained: {report}', flush=True)
