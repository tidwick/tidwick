#!/usr/bin/env bash
# Every SQL statement lives under src/db/ (P11): fails on `.prepare(` in any source file outside it.
# Takes the tree to scan as an optional argument, so sql-boundary.test.sh can scan a mutated copy.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
dirs=$(for d in src test scripts e2e; do [ -d "$d" ] && echo "$d"; done)
# shellcheck disable=SC2086
hits=$(grep -rn -F '.prepare(' --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.js' --include='*.mjs' $dirs | grep -v '^src/db/')
if [ -n "$hits" ]; then
  echo "FAIL lint-sql-boundary: SQL outside src/db/; move the statement into a src/db/ module beside its row type:"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS lint-sql-boundary"
