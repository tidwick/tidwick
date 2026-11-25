#!/usr/bin/env bash
# Proves import-gate.sh: a copy of the tree passes, and the same copy with each kind of edge import added under
# src/db, src/auth, src/backup or src/lib fails and names the file.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
for d in src scripts; do [ -d "$repo/$d" ] && cp -R "$repo/$d" "$work/"; done
if ! "$repo/scripts/import-gate.sh" "$work" > "$work/clean.log"; then
  cat "$work/clean.log"
  echo "FAIL lint-import-gate self-test: the unmutated tree fails; fix the hits above first"
  exit 1
fi
probe() { # <file> <line>
  mkdir -p "$(dirname "$work/$1")"
  printf '%s\n' "$2" > "$work/$1"
  if "$repo/scripts/import-gate.sh" "$work" > "$work/mutant.log"; then
    echo "FAIL lint-import-gate self-test: \`$2\` in $1 passed; the scan in scripts/import-gate.sh is not matching"
    exit 1
  fi
  if ! grep -q "$1" "$work/mutant.log"; then
    echo "FAIL lint-import-gate self-test: the failure did not name $1; make the scan print file paths"
    exit 1
  fi
  rm "$work/$1"
}
probe src/lib/leak.ts "import { ActionError } from 'astro:actions';"
probe src/db/leak.ts "import { env } from 'cloudflare:workers';"
probe src/auth/leak.ts "import { errorPage } from '../middleware/error-responses';"
probe src/backup/leak.ts "export { forAction } from '../actions/context';"
probe src/lib/leak.ts "const page = await import('../pages/_csv');"
echo "PASS lint-import-gate self-test"
