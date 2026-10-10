#!/usr/bin/env bash
# Removes preview images from GHCR once they are no use:
#   - the previews of pull requests that are no longer open,
#   - older previews of a pull request that is open (only its newest, pr-<number>, is kept),
#   - the per-platform pieces of multi-arch images that no image refers to any more
#     (only when old enough that no push can still be in progress).
# Releases (latest, sha-<commit>, 1.2.3) are never touched: a version is only a candidate if
# EVERY tag on it is a preview tag (pr-<number> or <version>-pr<number>.<commit>).
#
#   scripts/prune-previews.sh [--dry-run]
#
# Needs GH_TOKEN (packages: write, pull-requests: read), GITHUB_REPOSITORY, gh, jq, and a
# docker login to ghcr.io. ORPHAN_MIN_AGE_HOURS (default 6) is how old an unreferenced piece must be. PRUNE_MAX (default 40) stops a run that would delete more than that
# many versions, in case something is wrong with the selection.
set -euo pipefail

max_deletions=${PRUNE_MAX:-40}

# select_previews <versions.json> "<open pr numbers>": prints "id<TAB>reason<TAB>tags" for each
# preview version to delete.
select_previews() {
  jq -r --arg open "$2" '
    def prnum:
      if test("^pr-[0-9]+$") then sub("^pr-"; "") | tonumber
      elif test("-pr[0-9]+\\.[0-9a-f]{7}$") then capture("-pr(?<n>[0-9]+)\\.[0-9a-f]{7}$").n | tonumber
      else null end;
    ($open | split(" ") | map(select(length > 0) | tonumber)) as $open
    | map({id, tags: (.metadata.container.tags // [])})
    | map(select((.tags | length) > 0 and all(.tags[]; prnum != null)))
    | map(. + {prs: (.tags | map(prnum) | unique)})
    | map(select((.prs | length) == 1) | . + {pr: .prs[0]})
    | map(. as $v | $v + {open: (($open | index($v.pr)) != null)})
    | map(select((.open | not) or (. as $v | ($v.tags | index("pr-\($v.pr)")) == null)))
    | .[]
    | [.id, (if .open then "superseded by a newer push to PR #\(.pr)" else "PR #\(.pr) is not open" end), (.tags | join(","))]
    | @tsv' "$1"
}

# select_orphans <versions.json> <referenced-digests-file> <ids-already-deleted-file> <now-epoch>
select_orphans() {
  jq -r --rawfile ref "$2" --rawfile gone "$3" --argjson now "$4" --argjson age "$((${ORPHAN_MIN_AGE_HOURS:-6} * 3600))" '
    ($ref | split("\n") | map(select(length > 0))) as $referenced
    | ($gone | split("\n") | map(select(length > 0) | tonumber)) as $gone
    | map({id, digest: .name, created: (.created_at | fromdateiso8601), tags: (.metadata.container.tags // [])})
    | map(select(. as $v | ($v.tags | length) == 0 and (($referenced | index($v.digest)) == null) and (($gone | index($v.id)) == null) and ($now - $v.created) > $age))
    | .[]
    | [.id, "no image refers to it and it is older than \($age / 3600) hours", .digest]
    | @tsv' "$1"
}

main() {
  local dry=false
  [ "${1:-}" = "--dry-run" ] && dry=true
  local repo=${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required} owner name image kind base tmp
  owner=${repo%%/*}; name=${repo##*/}
  image=ghcr.io/$(printf '%s' "$repo" | tr '[:upper:]' '[:lower:]')
  kind=$(gh api "/users/$owner" --jq .type)
  if [ "$kind" = Organization ]; then base=/orgs/$owner/packages/container/$name; else base=/users/$owner/packages/container/$name; fi
  tmp=$(mktemp -d); trap 'rm -rf "'"$tmp"'"' EXIT

  if ! gh api --paginate "$base/versions?per_page=100" --jq '.[]' | jq -s '.' > "$tmp/versions.json"; then
    echo "Could not list the package's versions: nothing deleted." >&2; exit 1
  fi
  echo "$(jq length "$tmp/versions.json") versions of $image"
  local open_prs
  open_prs=$(gh pr list --repo "$repo" --state open --limit 500 --json number --jq '.[].number' | tr '\n' ' ')

  select_previews "$tmp/versions.json" "$open_prs" > "$tmp/plan.tsv"
  cut -f1 "$tmp/plan.tsv" > "$tmp/gone.txt"

  # What the images that stay still refer to: an index lists its per-platform manifests, and those
  # are the untagged versions that must be kept. Any failure here stops the run (set -e), because
  # deleting pieces of an image that is still in use would break it.
  jq -r --rawfile gone "$tmp/gone.txt" '
    ($gone | split("\n") | map(select(length > 0) | tonumber)) as $gone
    | .[] | select(. as $v | (($v.metadata.container.tags // []) | length) > 0 and (($gone | index($v.id)) == null))
    | .name' "$tmp/versions.json" > "$tmp/kept.txt"
  : > "$tmp/referenced.txt"
  local ok=true digest raw
  while IFS= read -r digest; do
    if raw=$(docker buildx imagetools inspect "$image@$digest" --raw 2>/dev/null); then
      printf '%s' "$raw" | jq -r '.manifests[]?.digest' >> "$tmp/referenced.txt"
    else
      echo "Could not read the manifest of $image@$digest." >&2; ok=false
    fi
  done < "$tmp/kept.txt"
  if $ok; then
    select_orphans "$tmp/versions.json" "$tmp/referenced.txt" "$tmp/gone.txt" "${NOW:-$(date +%s)}" >> "$tmp/plan.tsv"
  else
    echo "Skipping the cleanup of unreferenced pieces: a kept image could not be read, so deleting them might break it." >&2
  fi

  local count; count=$(wc -l < "$tmp/plan.tsv" | tr -d ' ')
  if [ "$count" -gt "$max_deletions" ]; then
    echo "Refusing to delete $count versions (the limit is $max_deletions). Check the selection, or set PRUNE_MAX." >&2
    cat "$tmp/plan.tsv" >&2; exit 1
  fi
  local verb="Deleting"; $dry && verb="Would delete"
  {
    echo "### Preview image cleanup"
    echo
    if [ "$count" -eq 0 ]; then echo "Nothing to delete."; else echo "$verb $count version(s):"; echo; fi
  } | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
  local id reason label
  while IFS=$'\t' read -r id reason label; do
    [ -n "$id" ] || continue
    echo "- $verb \`$label\` (version $id): $reason" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"
    $dry || gh api --method DELETE "$base/versions/$id" >/dev/null || echo "  could not delete version $id (already gone? or the workflow's token may need the Admin role on the package: package settings, Manage Actions access)" >&2
  done < "$tmp/plan.tsv"
}

# Run when executed; tests source this file for the functions.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
