#!/usr/bin/env bash
# The import direction (P11): the data, auth, backup and pure-library layers never reach the edge. Fails on an
# `astro:` or `cloudflare:` import, or an import of an edge directory (actions, middleware, pages, components,
# layouts, worker), from non-test source under src/db, src/auth, src/backup and src/lib.
# Takes the tree to scan as an optional argument, so import-gate.test.sh can scan a mutated copy.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
# Files that bind the Workers runtime on purpose: the environment reader and the mail sender.
allow='^src/lib/(env|mail)\.ts:'
edge='(astro|cloudflare):|/(actions|middleware|pages|components|layouts|worker)(/|["'"'"'])'
dirs=$(for d in src/db src/auth src/backup src/lib; do [ -d "$d" ] && echo "$d"; done)
# shellcheck disable=SC2086
hits=$(grep -rnE --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.js' --include='*.mjs' \
  "^[[:space:]]*(import|export)[^/]*['\"][^'\"]*($edge)|import\(['\"][^'\"]*($edge)" $dirs \
  | grep -v -e '\.test\.ts:' | grep -Ev "$allow")
if [ -n "$hits" ]; then
  echo "FAIL lint-import-gate: the data and library layers import the edge; move the edge code into src/middleware/ or src/actions/ (or allowlist it in scripts/import-gate.sh):"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS lint-import-gate"
