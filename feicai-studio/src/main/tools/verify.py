"""F04 serial acceptance commands; run through this directory's Makefile."""
import subprocess

commands = [
    ["npm", "run", "typecheck", "--", "--force"],
    ["npm", "run", "lint"],
    ["node_modules/.bin/prettier", "--check", "src/shared/tool-contracts.ts", "src/shared/tool-contracts.test.ts", "src/main/tools/*.ts", "docs/tool-contracts.md"],
    ["node_modules/.bin/vitest", "run", "src/shared/tool-contracts.test.ts", "src/main/tools/tool-service.test.ts", "src/main/security/access-control.test.ts"],
    ["git", "diff", "--check"],
]
for command in commands:
    print("F04_VERIFY:", " ".join(command), flush=True)
    subprocess.run(command, check=True)
