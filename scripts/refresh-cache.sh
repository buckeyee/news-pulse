#!/bin/bash
# Refresh Perplexity Discover cache and push to GitHub.
# Runs from launchd every 10 minutes or can be run manually.
cd "/Users/eleanor.donovan/Projects/news-pulse" || exit 1

python3 scripts/update_discover.py 2>&1

# Only push if the cache actually changed
if ! git diff --quiet perplexity_cache.json 2>/dev/null; then
    git add perplexity_cache.json
    git commit -m "Update Discover cache [$(date -u '+%Y-%m-%d %H:%M UTC')]"
    git pull --rebase origin main 2>/dev/null
    git push origin main 2>/dev/null
fi
