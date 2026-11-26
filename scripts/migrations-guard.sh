#!/usr/bin/env bash
# Before the first release tag a migration may still change; from the first tag on, a migration that exists at the
# newest release tag (v<number>..., annotated) never changes. Run from the repository root. A file that is new since
# the tag passes; a modified, deleted or renamed one fails, in the working tree or in a commit. Renames are checked as
# a delete plus an add (--no-renames), so moving a shipped file cannot slip through. CI needs the tags: see ci.yml.
set -euo pipefail
tag="$(git describe --abbrev=0 --match 'v[0-9]*' HEAD 2> /dev/null || true)"
if [ -z "$tag" ]; then
  echo "PASS migrations (pre-release: no tag yet)"
  exit 0
fi
changed="$(git diff --no-renames --name-status --diff-filter=MDT "$tag" -- migrations/)" || { echo "FAIL migrations: cannot compare with $tag; run git fetch --tags origin"; exit 1; }
[ -z "$changed" ] || { echo "FAIL migrations: a migration shipped in $tag changed; restore it and add a new migration instead:"; echo "$changed"; exit 1; }
echo "PASS migrations (nothing shipped in $tag changed)"
