#!/usr/bin/env bash
# Publish the books data folder as the single commit of the `books` branch. The previous commit is kept
# locally (shallow checkout), so only new files travel; old segments stop being referenced.
set -euo pipefail
cd "$1"
if [ ! -d .git ]; then git init -q -b books; fi
git config user.name "qasida-books"
git config user.email "actions@users.noreply.github.com"
git checkout -q --orphan "publish-$(date +%s%N)"
git add -A
git commit -qm "books $(date -u +%F-%H%M)"
git push -qf "$PUSH_URL" HEAD:"${BOOKS_BRANCH:-books}"
echo "published books data"
