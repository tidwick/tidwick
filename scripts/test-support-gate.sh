#!/usr/bin/env bash
# Test support and the system scope never ship: fails on a `test-support` or `systemScope` mention in non-test
# source under src/ outside the files that define them (src/db/test-support*.ts, src/db/scope.ts).
# Takes the tree to scan as an optional argument, so test-support-gate.test.sh can scan a mutated copy.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
hits=$(grep -rnE 'test-support|systemScope' --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.js' --include='*.mjs' \
  --exclude='*.test.*' --exclude='test-support*.ts' --exclude='scope.ts' src)
if [ -n "$hits" ]; then
  echo "FAIL lint-test-support-gate: production source reaches test support or systemScope; keep it in a *.test.ts file or src/db/test-support*.ts:"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS lint-test-support-gate"
