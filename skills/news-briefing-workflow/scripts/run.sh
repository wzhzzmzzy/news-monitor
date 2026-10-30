#!/bin/sh
set -eu
NEWS_SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Run in the user's login shell so existing exported credentials reach the child.
exec "${NEWS_LOGIN_SHELL:-fish}" -lc 'set -gx KOALA_API_TOKEN $KOALA_API_TOKEN; exec "$argv[1]" "$argv[2]" $argv[3..-1]' -- "${NEWS_NODE:-node}" "$NEWS_SKILL_DIR/scripts/workflow.mjs" "$@"
