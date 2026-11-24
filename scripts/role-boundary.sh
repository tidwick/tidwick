#!/usr/bin/env bash
# Role names sit next to paths only in src/routes.ts, and grants are read only in src/db/ (P15, ADR 0004):
# fails on a quoted role literal anywhere else under src/. Takes the tree to scan as an optional argument.
set -uo pipefail
cd "${1:-$(dirname "$0")/..}"
hits=$(grep -rn -E "['\"\`](accounting_admin|admin)['\"\`]" --include='*.ts' --include='*.tsx' --include='*.astro' src \
  | grep -v -e '^src/routes\.ts:' -e '^src/db/')
if [ -n "$hits" ]; then
  echo "FAIL lint-role-boundary: a role name outside src/routes.ts and src/db/; add a row to src/routes.ts or use GRANTS from src/db/roles.ts:"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS lint-role-boundary"
