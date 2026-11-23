#!/usr/bin/env bash
# Roda toda a suíte: 117 testes Python + testes JS (estruturas e paridade com o Python).
# Python 3.9+ e Node 18+; nenhuma dependência externa.
set -e
cd "$(dirname "$0")"
PY=""
for c in python3 python; do "$c" -c "import sys" >/dev/null 2>&1 && { PY=$c; break; }; done
[ -n "$PY" ] || { echo "Python 3 não encontrado"; exit 1; }
"$PY" -m unittest discover -s tests -t . -v
"$PY" tests_js/gen_fixtures.py        # regrava as saídas de referência do Python
node --test tests_js/
