#!/usr/bin/env bash
# Proves restore-target.sh: from a throwaway directory, named directories under .wrangler/ pass and every path
# that reaches .wrangler/ itself or outside it is refused. It only checks paths; nothing is deleted.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
for ok in .wrangler/restore .wrangler/drill/restore .wrangler/restore/; do
  if ! "$repo/scripts/restore-target.sh" "$ok" > /dev/null 2>&1; then
    echo "FAIL restore-target self-test: '$ok' was refused; fix the pattern in scripts/restore-target.sh"
    exit 1
  fi
done
for bad in .wrangler/../.. .wrangler/a/../../.. .wrangler/.. .wrangler/. .wrangler/ .wrangler .wrangler//x ../.wrangler/x /tmp/x '' 'x/.wrangler/y'; do
  if "$repo/scripts/restore-target.sh" "$bad" > /dev/null 2>&1; then
    echo "FAIL restore-target self-test: '$bad' was accepted and would be wiped; fix the checks in scripts/restore-target.sh"
    exit 1
  fi
done
echo "PASS restore-target self-test"
