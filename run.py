#!/usr/bin/env python3
"""Inicia o ATLAS: simulação + API + front-end em http://localhost:8000"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from city import City  # noqa: E402
from city.server import make_server  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description="ATLAS - cidade movida por estruturas de dados")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--width", type=int, default=12)
    ap.add_argument("--height", type=int, default=8)
    ap.add_argument("--cars", type=int, default=120)
    ap.add_argument("--tick", type=float, default=0.3, help="segundos por tick")
    a = ap.parse_args()
    city = City(seed=a.seed, width=a.width, height=a.height, n_cars=a.cars)
    httpd, ticker, _ = make_server(city, a.host, a.port, a.tick)
    print("ATLAS rodando em http://%s:%d  (Ctrl+C para sair)" % (a.host, a.port))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        ticker.stop()
        httpd.server_close()


if __name__ == "__main__":
    main()
