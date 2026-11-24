#!/usr/bin/env bash
# Proves role-boundary.sh: a copy of src/ passes, and the same copy with a role literal in a page fails and names it.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$repo/src" "$work/"
if ! "$repo/scripts/role-boundary.sh" "$work" > "$work/clean.log"; then
  cat "$work/clean.log"
  echo "FAIL lint-role-boundary self-test: the unmutated tree fails; fix the hits above first"
  exit 1
fi
printf "export const canApprove = (roles: string[]) => roles.includes('accounting_admin');\n" > "$work/src/lib/leak.ts"
if "$repo/scripts/role-boundary.sh" "$work" > "$work/mutant.log" || ! grep -q 'src/lib/leak.ts' "$work/mutant.log"; then
  echo "FAIL lint-role-boundary self-test: a role literal in src/lib/ was not named; fix the pattern in scripts/role-boundary.sh"
  exit 1
fi
echo "PASS lint-role-boundary self-test"
