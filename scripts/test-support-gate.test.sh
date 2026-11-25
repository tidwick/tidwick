#!/usr/bin/env bash
# Proves test-support-gate.sh: a copy of the tree passes, and the same copy with a production file that imports
# test-support, or one that imports systemScope, fails and names the file.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$repo/src" "$work/"
if ! "$repo/scripts/test-support-gate.sh" "$work" > "$work/clean.log"; then
  cat "$work/clean.log"
  echo "FAIL lint-test-support-gate self-test: the unmutated tree fails; fix the hits above first"
  exit 1
fi
for line in "import { seed } from '../db/test-support';" "import { systemScope } from '../db/scope';"; do
  printf '%s\n' "$line" > "$work/src/lib/leak.ts"
  if "$repo/scripts/test-support-gate.sh" "$work" > "$work/mutant.log"; then
    echo "FAIL lint-test-support-gate self-test: \"$line\" in src/lib/ passed; the scan in scripts/test-support-gate.sh is not matching"
    exit 1
  fi
  if ! grep -q 'src/lib/leak.ts' "$work/mutant.log"; then
    echo "FAIL lint-test-support-gate self-test: the failure did not name the mutated file; make the scan print file paths"
    exit 1
  fi
done
echo "PASS lint-test-support-gate self-test"
