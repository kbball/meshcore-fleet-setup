#!/usr/bin/env bash
# Tests which versions prune-previews.sh would delete, using made-up package versions.
#   scripts/prune-previews.test.sh
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=prune-previews.sh
. ./prune-previews.sh
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
now=1791590400   # 2026-10-10 00:00:00 UTC
failures=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1"; echo "  expected: $2"; echo "  actual:   $3"; failures=$((failures + 1)); fi
}
v() { # v <id> <digest> <created> <tags...>   (a version as the GitHub API returns it)
  local id=$1 digest=$2 created=$3; shift 3
  local tags; tags=$(printf '%s\n' "$@" | jq -R . | jq -s .)
  [ $# -eq 0 ] && tags='[]'
  jq -n --argjson id "$id" --arg d "$digest" --arg c "$created" --argjson t "$tags" '{id: $id, name: $d, created_at: $c, metadata: {container: {tags: $t}}}'
}
old=2026-10-01T00:00:00Z; recent=2026-10-09T22:00:00Z
{
  v 1 sha256:rel $old latest sha-aaa1111 0.2.0                 # a release
  v 2 sha256:p6 $old pr-6 0.2.0-pr6.bbb2222                    # PR 6 (open), its newest push
  v 3 sha256:p6old $old 0.2.0-pr6.ccc3333                      # PR 6 (open), an older push
  v 4 sha256:p5 $old pr-5 0.2.0-pr5.ddd4444                    # PR 5 (closed)
  v 5 sha256:p5old $old 0.2.0-pr5.eee5555                      # PR 5 (closed), an older push
  v 6 sha256:mixed $old pr-7 latest                            # mixed tags: never touched
  v 7 sha256:c1 $old                                           # a piece of the release (referenced)
  v 8 sha256:c2 $old                                           # a piece of PR 6's image (referenced)
  v 9 sha256:c3 $old                                           # a piece only PR 5's image used
  v 10 sha256:c4 $recent                                       # unreferenced but new: a push may be under way
  v 11 sha256:c5 $old                                          # unreferenced and old
  v 12 sha256:rc $old 0.2.1-rc.1                               # not a preview tag
  v 13 sha256:bad $old pr-x                                    # malformed
  v 14 sha256:p7 $old 0.2.0-pr7.fff6666                        # PR 7 (closed)
  v 15 sha256:two $old pr-8 pr-9                               # tags of two PRs: ambiguous, left alone
} | jq -s . > "$tmp/versions.json"

# 1. Which previews go: those of closed PRs, and the older pushes of an open one.
got=$(select_previews "$tmp/versions.json" "6" | cut -f1 | tr '\n' ' ')
check "previews: closed PRs and superseded pushes go" "3 4 5 14 " "$got"
reasons=$(select_previews "$tmp/versions.json" "6" | cut -f1,2 | tr '\t' ':' | tr '\n' ';')
check "previews: the reasons" "3:superseded by a newer push to PR #6;4:PR #5 is not open;5:PR #5 is not open;14:PR #7 is not open;" "$reasons"

# 2. With nothing open, PR 6's previews go too, but the release and the odd ones never do.
got=$(select_previews "$tmp/versions.json" "" | cut -f1 | tr '\n' ' ')
check "previews: with no open PRs every preview goes, and nothing else" "2 3 4 5 14 " "$got"
got=$(select_previews "$tmp/versions.json" "5 6 7" | cut -f1 | tr '\n' ' ')
check "previews: an open PR keeps its newest push, but not its older ones" "3 5 14 " "$got"

# 3. Pieces that no remaining image refers to, once they are old enough.
printf 'sha256:c1\nsha256:c2\n' > "$tmp/referenced.txt"
printf '3\n4\n5\n14\n' > "$tmp/gone.txt"
got=$(select_orphans "$tmp/versions.json" "$tmp/referenced.txt" "$tmp/gone.txt" "$now" | cut -f1 | tr '\n' ' ')
check "orphans: old and unreferenced go; referenced and recent stay" "9 11 " "$got"
got=$(ORPHAN_MIN_AGE_HOURS=1 select_orphans "$tmp/versions.json" "$tmp/referenced.txt" "$tmp/gone.txt" "$now" | cut -f1 | tr '\n' ' ')
check "orphans: a shorter age limit also takes the recent one" "9 10 11 " "$got"
: > "$tmp/referenced.txt"
got=$(select_orphans "$tmp/versions.json" "$tmp/referenced.txt" "$tmp/gone.txt" "$now" | cut -f1 | tr '\n' ' ')
check "orphans: tagged versions are never orphans, whatever is referenced" "7 8 9 11 " "$got"

# 4. An empty package.
echo '[]' > "$tmp/empty.json"
check "previews: an empty package" "" "$(select_previews "$tmp/empty.json" "6")"
check "orphans: an empty package" "" "$(select_orphans "$tmp/empty.json" "$tmp/referenced.txt" "$tmp/gone.txt" "$now")"


# 5. The whole script, with stand-ins for gh and docker: what it asks for and what it deletes.
bin=$tmp/bin; mkdir "$bin"
cat > "$bin/gh" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  "api /users/kbball --jq .type") echo User ;;
  "api --paginate /users/kbball/packages/container/meshcore-fleet-setup/versions?per_page=100 --jq .[]") [ -z "${LISTFAIL:-}" ] || exit 1; jq -c '.[]' "$FIXTURE" ;;
  "pr list --repo kbball/meshcore-fleet-setup --state open --limit 500 --json number --jq .[].number") printf '%s\n' $OPEN_PRS ;;
  "api --method DELETE /users/kbball/packages/container/meshcore-fleet-setup/versions/"*) last=${!#}; echo "${last##*/}" >> "$DELETED" ;;
  *) echo "unexpected gh call: $*" >&2; exit 2 ;;
esac
STUB
cat > "$bin/docker" <<'STUB'
#!/usr/bin/env bash
[ "$1 $2 $3" = "buildx imagetools inspect" ] || { echo "unexpected docker call: $*" >&2; exit 2; }
case "$4" in
  *@"$BROKEN") exit 1 ;;
  *@sha256:rel) echo '{"manifests":[{"digest":"sha256:c1"}]}' ;;
  *@sha256:p6)  echo '{"manifests":[{"digest":"sha256:c2"}]}' ;;
  *) echo '{"manifests":[]}' ;;
esac
STUB
chmod +x "$bin/gh" "$bin/docker"
export FIXTURE=$tmp/versions.json DELETED=$tmp/deleted.log GITHUB_REPOSITORY=kbball/meshcore-fleet-setup NOW=$now OPEN_PRS="6" BROKEN=none
run() { : > "$DELETED"; PATH="$bin:$PATH" "$(pwd)/prune-previews.sh" "$@" > "$tmp/out.txt" 2>&1 || echo "exit $?" >> "$tmp/out.txt"; if [ -n "${SHOW:-}" ]; then cat "$tmp/out.txt" >&2; fi; sort -n "$DELETED" | tr "\n" " "; }

check "script: a real run deletes the closed and superseded previews and the pieces nothing refers to" "3 4 5 9 11 14 " "$(run)"
check "script: a dry run deletes nothing" "" "$(run --dry-run)"
check "script: and says what it would delete" "6" "$(grep -c '^- Would delete' "$tmp/out.txt")"
check "script: when an image that stays cannot be read, only the previews go" "3 4 5 14 " "$(BROKEN=sha256:rel run)"
check "script: and it says why it left the rest" "1" "$(grep -c 'Skipping the cleanup of unreferenced pieces' "$tmp/out.txt")"
check "script: it refuses a run that would delete too much, and deletes nothing" "" "$(PRUNE_MAX=3 run)"
check "script: and reports it" "1" "$(grep -c 'Refusing to delete 6 versions' "$tmp/out.txt")"
check "script: when the versions cannot be listed, nothing is deleted" "" "$(LISTFAIL=1 run)"
check "script: and it says so" "1" "$(grep -c 'Could not list the package' "$tmp/out.txt")"
check "script: with PR 6 and 5 open, only their older pushes and the rest go" "3 5 9 11 14 " "$(OPEN_PRS="6 5" run)"

if [ "$failures" -eq 0 ]; then echo "all passed"; else echo "$failures failed"; exit 1; fi
