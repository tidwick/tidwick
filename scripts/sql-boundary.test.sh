#!/usr/bin/env bash
# Proves sql-boundary.sh: a copy of the tree passes, and the same copy with one `.prepare(` added outside
# src/db/ fails and names the file.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for d in src test scripts e2e; do [ -d "$repo/$d" ] && cp -R "$repo/$d" "$work/"; done
if ! "$repo/scripts/sql-boundary.sh" "$work" > "$work/clean.log"; then
  cat "$work/clean.log"
  echo "FAIL lint-sql-boundary self-test: the unmutated tree fails; fix the hits above first"
  exit 1
fi
printf "export const leak = (db: D1Database) => db.prepare('SELECT 1');\n" > "$work/src/lib/leak.ts"
if "$repo/scripts/sql-boundary.sh" "$work" > "$work/mutant.log"; then
  echo "FAIL lint-sql-boundary self-test: a .prepare( in src/lib/ passed; the scan in scripts/sql-boundary.sh is not matching"
  exit 1
fi
if ! grep -q 'src/lib/leak.ts' "$work/mutant.log"; then
  echo "FAIL lint-sql-boundary self-test: the failure did not name the mutated file; make the scan print file paths"
  exit 1
fi
echo "PASS lint-sql-boundary self-test"
