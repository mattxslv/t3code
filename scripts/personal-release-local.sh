#!/usr/bin/env bash
# Builds the Linux AppImage on this machine and publishes it as a personal release,
# so the in-app updater works without GitHub Actions minutes.
# Usage: scripts/personal-release-local.sh [--skip-install]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
sha=$(git rev-parse HEAD)

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty; commit or stash first." >&2
  exit 1
fi
git fetch --quiet origin personal/release
if [[ "$sha" != "$(git rev-parse origin/personal/release)" ]]; then
  echo "HEAD is not pushed to origin/personal/release; push first." >&2
  exit 1
fi

git fetch --quiet --no-tags https://github.com/pingdotgg/t3code.git 'refs/tags/v*:refs/tags/v*'
base=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' --exclude '*-*' HEAD)
IFS=. read -r major minor patch <<<"${base#v}"
first=$((patch * 100))
last=$(gh release list --repo "$repo" --limit 200 --json tagName -q '.[].tagName' \
  | sed -n "s/^personal-v${major}\.${minor}\.\([0-9]*\)$/\1/p" \
  | awk -v lo="$first" -v hi="$((first + 99))" '$1 >= lo && $1 <= hi' | sort -n | tail -1)
build=$(( ${last:-$((first - 1))} + 1 ))
version="${major}.${minor}.${build}"
echo "Building $version from $base at ${sha:0:12}"

if [[ "${1:-}" != "--skip-install" ]]; then
  npx --yes vp install
fi

rm -rf release
T3CODE_DESKTOP_UPDATE_REPOSITORY="$repo" node scripts/build-desktop-artifact.ts \
  --platform linux --target AppImage --arch x64 --build-version "$version"

gh release create "personal-v$version" release/*.AppImage release/latest-linux.yml \
  --repo "$repo" \
  --target "$sha" \
  --title "T3 Code Personal $version" \
  --notes "Personal build based on official T3 Code $base (${sha:0:12}), built locally." \
  --latest
echo "Published personal-v$version"
