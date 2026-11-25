#!/usr/bin/env bash
# The import direction: the data, auth, backup and pure-library layers never reach the edge. Fails on an
# `astro:` or `cloudflare:` import, or an import of an edge directory (actions, middleware, pages, components,
# layouts, mcp, worker), from non-test source under src/db, src/auth, src/backup and src/lib. The specifier is found
# wherever it sits, so multi-line static imports, re-exports and dynamic imports are caught.
# Takes the tree to scan as an optional argument, so import-gate.test.sh can scan a mutated copy.
set -euo pipefail
cd "${1:-$(dirname "$0")/..}"
dirs=()
for d in src/db src/auth src/backup src/lib; do [ -d "$d" ] && dirs+=("$d"); done
# The two imports that bind the Workers runtime on purpose: the environment reader and the mail sender.
hits=$(find "${dirs[@]}" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.astro' -o -name '*.js' -o -name '*.mjs' \) \
  ! -name '*.test.ts' -print0 | xargs -0 perl -0777 -ne '
  BEGIN { $edge = qr{^(?:astro|cloudflare):|/(?:actions|middleware|pages|components|layouts|mcp|worker)(?:/|$)};
          %allow = ("src/lib/env.ts" => "cloudflare:workers", "src/lib/mail.ts" => "cloudflare:email"); }
  while (/(?:\bfrom|\bimport)\s*\(?\s*([\x27"])([^\x27"\n]+)\1/g) {
    my $spec = $2; my $end = pos();
    next unless $spec =~ $edge;
    next if ($allow{$ARGV} // "") eq $spec;
    my $line = 1 + (substr($_, 0, $end) =~ tr/\n//);
    print "$ARGV:$line:$spec\n";
  }')
if [ -n "$hits" ]; then
  echo "FAIL lint-import-gate: the data and library layers import the edge; move the edge code into src/middleware/ or src/actions/ (or allowlist it in scripts/import-gate.sh):"
  echo "$hits" | head -20
  exit 1
fi
echo "PASS lint-import-gate"
