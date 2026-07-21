#!/usr/bin/env bash
# Bumps package.json versions across the monorepo, commits, and tags a release.
# Usage: scripts/release.sh 1.1.0
#        scripts/release.sh 2.0.0-beta.1
set -euo pipefail

version="${1:-}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$ ]]; then
	echo "Usage: scripts/release.sh <version>  (e.g. 1.1.0 or 2.0.0-beta, no 'v' prefix)" >&2
	exit 1
fi
tag="v${version}"

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
	echo "Working tree not clean. Commit or stash first." >&2
	exit 1
fi

if git rev-parse "$tag" >/dev/null 2>&1; then
	echo "Tag $tag already exists." >&2
	exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "master" ]]; then
	echo "Warning: on branch '$branch', not 'master'." >&2
fi

files=(package.json web/package.json shared/contract/package.json)
for f in "${files[@]}"; do
	sed -i '' -E 's/^(\t"version": ")[^"]*(",)$/\1'"${version}"'\2/' "$f"
done

npm install --package-lock-only >/dev/null

git add "${files[@]}" package-lock.json
git commit -m "chore: bump version to ${version}"
git tag -a "$tag" -m "$tag"

cat <<EOF

Bumped to ${version} and created tag ${tag} locally. Push both to trigger the release:

  git push origin ${branch}
  git push origin ${tag}
EOF
