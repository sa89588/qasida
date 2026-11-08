#!/usr/bin/env bash
# Publish the data folder as the single commit of the `data` branch.
set -euo pipefail
rm -rf /tmp/pub && cp -r data /tmp/pub && rm -rf /tmp/pub/.git && cd /tmp/pub
git init -q -b data
git config user.name "qasida-catalog"
git config user.email "actions@users.noreply.github.com"
git add -A && git commit -qm "catalog $(date -u +%F-%H%M)"
git push -qf "$PUSH_URL" data
