"""Monta o site estático em dist/ a partir de web/.

  python tools/build_site.py

- dist/index.html: página com o CSS embutido e sem <!doctype>/<html>/<head>/<body>
  (formato que a hospedagem de artifacts espera; ela adiciona o esqueleto).
- dist/app.js, dist/worker.js, dist/engine/*.js: módulos ES, sem dependências.

Para hospedar em outro lugar (GitHub Pages, Netlify...), use a pasta web/ direto:
ela já é um site estático completo.
"""

import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
DIST = os.path.join(ROOT, "dist")


def main():
    html = open(os.path.join(WEB, "index.html"), encoding="utf-8").read()
    css = open(os.path.join(WEB, "style.css"), encoding="utf-8").read()
    head = html.split("<!--HEAD-START-->")[1].split("<!--HEAD-END-->")[0]
    body = html.split("<!--BODY-START-->")[1].split("<!--BODY-END-->")[0]
    head = re.sub(r"<!--CSS-->.*?<!--/CSS-->", lambda _: "<style>\n" + css + "\n</style>", head, flags=re.S)
    page = head.strip() + "\n" + body.strip() + "\n"
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, "engine"))
    with open(os.path.join(DIST, "index.html"), "w", encoding="utf-8") as f:
        f.write(page)
    for name in ("app.js", "worker.js"):
        shutil.copy(os.path.join(WEB, name), os.path.join(DIST, name))
    for name in sorted(os.listdir(os.path.join(WEB, "engine"))):
        if name.endswith(".js"):
            shutil.copy(os.path.join(WEB, "engine", name), os.path.join(DIST, "engine", name))
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(DIST) for f in fs)
    print("dist/ pronto: %d arquivos, %.0f KB" % (sum(len(fs) for _, _, fs in os.walk(DIST)), total / 1024))


if __name__ == "__main__":
    main()
