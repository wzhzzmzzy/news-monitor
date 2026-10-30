#!/bin/sh
set -eu
NEWS_SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Install into the resident Dagu home used by the always-on scheduler (dagu start-all).
DAGU_HOME=${DAGU_HOME:-$HOME/.config/dagu}
DAG_FILE="$DAGU_HOME/dags/news-briefing-morning.yaml"

case "${1:-install}" in
  install) ;;
  remove)
    rm -f "$DAG_FILE"
    echo "removed $DAG_FILE (the resident scheduler drops the schedule on its next reload)"
    exit 0
    ;;
  *) echo "usage: $0 [install|remove]" >&2; exit 2 ;;
esac

mkdir -p "$DAGU_HOME/dags"
NEWS_SKILL_DIR="$NEWS_SKILL_DIR" DAG_FILE="$DAG_FILE" python3 - <<'PY'
import glob, os, pathlib, shutil, subprocess, sys

root = pathlib.Path(os.environ['NEWS_SKILL_DIR'])
source = root / 'dagu/morning.yaml'
dest = pathlib.Path(os.environ['DAG_FILE'])

# The DAG file lives outside the Skill, so every relative path must be absolute.
text = source.read_text()
needle = 'working_dir: ..'
if text.count(needle) != 1:
    sys.exit(f'{source}: expected exactly one "{needle}" line')
text = text.replace(needle, 'working_dir: ' + str(root))

def node22():
    home = pathlib.Path.home()
    found = []
    for pattern in ('Library/Application Support/fnm/node-versions/v22.*/installation/bin/node',
                    '.local/share/fnm/node-versions/v22.*/installation/bin/node'):
        for candidate in glob.glob(str(home / pattern)):
            version = candidate.split('/node-versions/v')[1].split('/')[0].split('.')
            found.append((tuple(int(x) for x in version), candidate))
    for _, candidate in sorted(found, reverse=True):
        if subprocess.run([candidate, '-v'], capture_output=True, text=True).returncode == 0:
            return candidate
    return None

fish = (os.environ.get('NEWS_LOGIN_SHELL') or shutil.which('fish')
        or next((p for p in ('/opt/homebrew/bin/fish', '/usr/local/bin/fish') if os.access(p, os.X_OK)), None))
if not fish:
    sys.exit('fish not found; install it or export NEWS_LOGIN_SHELL=/abs/path/to/fish')

# The scheduler runs outside the interactive shell: its PATH carries neither fish
# nor fnm, so pin both absolute paths used by run.sh instead of relying on PATH.
node = node22()
if node:
    runtime = '  NEWS_NODE: "%s"\n  NEWS_LOGIN_SHELL: "%s"\n' % (node, fish)
else:
    runtime = '  NEWS_LOGIN_SHELL: "%s"\n' % fish
    print('warning: no Node 22 found under fnm; run.sh will use the login shell node', file=sys.stderr)
text = text.replace('shell: /bin/sh\n', 'shell: /bin/sh\nenv:\n' + runtime, 1)

dest.write_text(text)
print('wrote', dest)
print('NEWS_NODE =', node or 'login shell node')
print('NEWS_LOGIN_SHELL =', fish)
PY

if command -v dagu >/dev/null; then
  dagu validate "$DAG_FILE"
  dagu --dagu-home "$DAGU_HOME" ls -n news-briefing
else
  echo "dagu not found in PATH; skipped validation and schedule check" >&2
fi
