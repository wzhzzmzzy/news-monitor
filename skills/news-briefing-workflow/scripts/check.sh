#!/bin/sh
set -eu
NEWS_SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$NEWS_SKILL_DIR/../.."
node --test skills/news-briefing-workflow/tests/adapters.test.mjs
for NEWS_SCRIPT in skills/news-briefing-workflow/scripts/*.mjs; do node --check "$NEWS_SCRIPT"; done
dagu validate skills/news-briefing-workflow/dagu/morning.yaml
dagu validate skills/news-briefing-workflow/dagu/preview.yaml
