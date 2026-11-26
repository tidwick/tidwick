#!/usr/bin/env bash
# Proves migrations-guard.sh in a scratch repository: with no tag an edit passes; with an annotated tag an edit, a
# delete and a rename of a tagged migration fail and a new migration passes; a lightweight tag does not count; the
# newest tag reachable from HEAD is the base.
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/migrations-guard.sh"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.test GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.test
unset GITHUB_ACTIONS
fail() { echo "FAIL migrations-guard self-test: $1; fix scripts/migrations-guard.sh"; [ ! -f out.txt ] || cat out.txt; exit 1; }
passes() { "$script" > out.txt 2>&1 || fail "$1 must pass"; }
refuses() { ! "$script" > out.txt 2>&1 || fail "$1 must fail"; grep -q '^FAIL migrations' out.txt || fail "$1 printed no FAIL line"; return 0; }
fresh() { # a repository with 0001 committed, and no tag
  rm -rf repo out.txt
  git init -q repo
  cd repo
  mkdir migrations
  echo 'CREATE TABLE a (id TEXT);' > migrations/0001_init.sql
  git add migrations
  git commit -q -m init
}
back() { cd "$work"; }

fresh
passes 'a clean tree with no tag'
echo '-- edit' >> migrations/0001_init.sql
passes 'an edit of 0001 with no tag'
grep -q 'PASS migrations (pre-release: no tag yet)' out.txt || fail 'the pre-release line is missing'
git commit -q -am edit
git tag light
passes 'a lightweight tag is not a release'
back

fresh
git tag -a v0.1.0 -m v0.1.0
passes 'a tagged tree, nothing changed'
echo '-- edit' >> migrations/0001_init.sql
refuses 'an edit of a tagged migration in the working tree'
grep -q 'migrations/0001_init.sql' out.txt || fail 'the failure does not name the file'
git commit -q -am edit
refuses 'an edit of a tagged migration, committed'
git reset -q --hard v0.1.0
echo 'CREATE TABLE b (id TEXT);' > migrations/0002_b.sql
git add migrations
passes 'a new migration after the tag'
git commit -q -m add
passes 'a new migration after the tag, committed'
echo '-- edit' >> migrations/0002_b.sql
passes 'an edit of a migration added after the tag'
git checkout -q -- migrations
git rm -q migrations/0001_init.sql
refuses 'a delete of a tagged migration'
git reset -q --hard HEAD
git mv migrations/0001_init.sql migrations/0001_renamed.sql
refuses 'a rename of a tagged migration'
git reset -q --hard HEAD
back

fresh
git tag -a v0.1.0 -m v0.1.0
echo 'CREATE TABLE c (id TEXT);' > migrations/0002_c.sql
git add migrations
git commit -q -m next
git tag -a v0.2.0 -m v0.2.0
echo '-- edit' >> migrations/0002_c.sql
refuses 'an edit of a migration shipped in the newer tag'
git checkout -q -- migrations
git checkout -q -b side v0.1.0
echo '-- edit' >> migrations/0001_init.sql
refuses 'an edit on a branch whose newest ancestor tag is v0.1.0'
back
fresh
git tag -a v0.1.0 -m v0.1.0
echo '-- more' >> migrations/0001_init.sql
git commit -q -am more
cd "$work"
git clone -q --depth 1 "file://$work/repo" shallow
cd shallow
refuses 'a shallow clone, which cannot show the tags'
grep -q 'shallow' out.txt || fail 'the shallow failure does not say why'
back

fresh
GITHUB_ACTIONS=true refuses 'CI with no release tag visible'
back
echo 'PASS migrations-guard self-test'
