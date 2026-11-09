#!/usr/bin/env bash
# Publish the books data folder as the single (parentless) commit of the `books` branch. The previous commit
# stays known locally (shallow checkout), so only new files travel; segments merged away stop being referenced.
set -euo pipefail
cd "$1"
[ -d .git ] || git init -q
git config user.name "qasida-books"
git config user.email "actions@users.noreply.github.com"
git add -A
commit=$(git commit-tree "$(git write-tree)" -m "books $(date -u +%F-%H%M)")
git push -qf "$PUSH_URL" "$commit:refs/heads/${BOOKS_BRANCH:-books}"
echo "published books data $commit"
