#!/bin/bash
# Baut die Ein-Datei-Version für den Mac: dist/arion-stimme-einrichten.command
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
python3 -I - <<'PY'
s = open("setup.sh", encoding="utf-8").read()
p = open("proxy.py", encoding="utf-8").read().rstrip("\n")
assert "\nPROXY\n" not in "\n" + p + "\n"
open("dist/arion-stimme-einrichten.command", "w", encoding="utf-8").write(s.replace("__PROXY_PY__", p))
PY
chmod +x dist/arion-stimme-einrichten.command
bash -n dist/arion-stimme-einrichten.command
echo "dist/arion-stimme-einrichten.command"
