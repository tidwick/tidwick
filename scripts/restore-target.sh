#!/usr/bin/env bash
# Prints the restore target if it is a named directory under .wrangler/, which the restore recipe wipes first;
# refuses anything else, including a `..`, `.` or empty segment that would reach .wrangler/ itself or beyond.
set -euo pipefail
target="${1:-}"
target="${target%/}"
refuse() {
  echo "FAIL restore: the target '$target' must be a named directory under .wrangler/ with no '..', '.' or empty segment, since it is wiped first; pass one such as .wrangler/restore" >&2
  exit 1
}
case "/$target/" in */../* | */./* | *//*) refuse ;; esac
case "$target" in .wrangler/?*) ;; *) refuse ;; esac
printf '%s\n' "$target"
