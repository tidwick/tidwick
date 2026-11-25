#!/usr/bin/env bash
# Proves migration-manifest.sh: a copy of the tree passes, a copy with one byte appended to an existing migration
# fails and names it, and a copy with a new migration plus its appended line passes.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir "$work/scripts" "$work/a" "$work/b"
cp -R "$repo/migrations" "$work/a/"
cp "$repo/scripts/migrations.sha256" "$work/scripts/"
cp -R "$work/scripts" "$work/a/"
if ! "$repo/scripts/migration-manifest.sh" "$work/a" > "$work/clean.log"; then
  cat "$work/clean.log"
  echo "FAIL migration-manifest self-test: the unmutated tree fails; fix the lines above first"
  exit 1
fi
first="$(ls "$work/a/migrations" | head -1)"
echo "-- edited" >> "$work/a/migrations/$first"
if "$repo/scripts/migration-manifest.sh" "$work/a" > "$work/mutant.log"; then
  echo "FAIL migration-manifest self-test: an edited migration passed; the comparison in scripts/migration-manifest.sh is not running"
  exit 1
fi
if ! grep -q "$first" "$work/mutant.log"; then
  echo "FAIL migration-manifest self-test: the failure did not name the edited migration; make the check print file names"
  exit 1
fi
cp -R "$repo/migrations" "$work/b/"
cp -R "$work/scripts" "$work/b/"
echo "SELECT 1;" > "$work/b/migrations/9999_probe.sql"
if "$repo/scripts/migration-manifest.sh" "$work/b" > "$work/unlisted.log"; then
  echo "FAIL migration-manifest self-test: a migration with no manifest line passed; the unlisted check is not running"
  exit 1
fi
(cd "$work/b/migrations" && shasum -a 256 9999_probe.sql) >> "$work/b/scripts/migrations.sha256"
if ! "$repo/scripts/migration-manifest.sh" "$work/b" > "$work/append.log"; then
  cat "$work/append.log"
  echo "FAIL migration-manifest self-test: a new migration with its appended line failed; appending must pass"
  exit 1
fi
echo "PASS migration-manifest self-test"
