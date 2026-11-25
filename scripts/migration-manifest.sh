#!/usr/bin/env bash
# A migration that has shipped is never edited: scripts/migrations.sha256 holds one sha256 line per migration, and
# this fails when a listed migration changed or vanished, or when a migration has no line. Adding a migration is a
# second, deliberate edit: append its line (`cd migrations && shasum -a 256 NNNN_name.sql`).
# Takes the tree to scan as an optional argument, so migration-manifest.test.sh can scan a mutated copy.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
bad=$(
  while read -r sum name; do
    [ -f "migrations/$name" ] || { echo "$name: listed but missing"; continue; }
    [ "$(shasum -a 256 "migrations/$name" | cut -d' ' -f1)" = "$sum" ] || echo "$name: changed after it shipped"
  done < scripts/migrations.sha256
  for f in migrations/*.sql; do
    grep -q " ${f#migrations/}\$" scripts/migrations.sha256 || echo "${f#migrations/}: no line in scripts/migrations.sha256"
  done
)
if [ -n "$bad" ]; then
  echo "FAIL migration-manifest: a shipped migration must not change; add a new migration instead, and append a new migration's line to scripts/migrations.sha256:"
  echo "$bad" | head -20
  exit 1
fi
echo "PASS migration-manifest"
