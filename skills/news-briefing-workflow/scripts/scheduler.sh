#!/bin/sh
set -eu
NEWS_SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
# Dagu state stays with the workflow; no global scheduler config is overwritten.
mkdir -p "$NEWS_SKILL_DIR/.runtime/dagu/dags"
cp "$NEWS_SKILL_DIR/dagu/morning.yaml" "$NEWS_SKILL_DIR/.runtime/dagu/dags/morning.yaml"
# Copied YAML needs an absolute working directory.
NEWS_SKILL_DIR="$NEWS_SKILL_DIR" python3 - <<'PY'
import os,pathlib
r=pathlib.Path(os.environ['NEWS_SKILL_DIR']);p=r/'.runtime/dagu/dags/morning.yaml'
p.write_text(p.read_text().replace('working_dir: ..','working_dir: '+str(r)))
PY
exec dagu scheduler --dagu-home "$NEWS_SKILL_DIR/.runtime/dagu"
