"""Servidor HTTP (somente biblioteca padrão) + thread que avança a simulação.

GET  /api/map  /api/state  /api/route?src=&dst=  /api/autocomplete?prefix=
     /api/resident?id=  /api/residents?lo=&hi=  /api/benchmark?quick=1
POST /api/emergency {node, severity}  /api/close {u,v}  /api/open {u,v}
     /api/undo  /api/redo  /api/pause {paused}
"""

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

WEB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
MIME = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json"}


class Ticker(threading.Thread):
    def __init__(self, city, lock, interval):
        super().__init__(daemon=True)
        self.city, self.lock, self.interval = city, lock, interval
        self.paused = False
        self._halt = threading.Event()

    def run(self):
        while not self._halt.is_set():
            if not self.paused:
                with self.lock:
                    self.city.tick()
            self._halt.wait(self.interval)

    def stop(self):
        self._halt.set()


def _int(q, name):
    try:
        return int(q[name][0])
    except (KeyError, ValueError, IndexError):
        raise ValueError("parâmetro inteiro inválido: %s" % name)


def make_handler(city, lock, ticker):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ATLAS/1.0"

        def log_message(self, *args):  # silencioso
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else json.dumps(body).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _static(self, path):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            full = os.path.realpath(os.path.join(WEB_DIR, rel))
            if not full.startswith(os.path.realpath(WEB_DIR) + os.sep) or not os.path.isfile(full):
                return self._send(404, {"error": "não encontrado"})
            with open(full, "rb") as f:
                self._send(200, f.read(), MIME.get(os.path.splitext(full)[1], "application/octet-stream"))

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            try:
                if u.path == "/api/map":
                    with lock:
                        return self._send(200, city.map_json())
                if u.path == "/api/state":
                    with lock:
                        s = city.state_json()
                    s["paused"] = ticker.paused if ticker else False
                    return self._send(200, s)
                if u.path == "/api/route":
                    with lock:
                        return self._send(200, city.route_query(_int(q, "src"), _int(q, "dst")))
                if u.path == "/api/autocomplete":
                    with lock:
                        return self._send(200, city.autocomplete(q.get("prefix", [""])[0]))
                if u.path == "/api/resident":
                    with lock:
                        return self._send(200, city.lookup_resident(_int(q, "id")))
                if u.path == "/api/residents":
                    with lock:
                        return self._send(200, city.residents_range(_int(q, "lo"), _int(q, "hi")))
                if u.path == "/api/benchmark":
                    from benchmarks import run_benchmarks
                    quick = q.get("quick", ["1"])[0] != "0"
                    sizes = [500, 1000, 2000, 4000] if quick else [1000, 4000, 16000, 64000]
                    return self._send(200, run_benchmarks(sizes))
                if u.path.startswith("/api/"):
                    return self._send(404, {"error": "rota desconhecida"})
                return self._static(u.path)
            except ValueError as e:
                self._send(400, {"error": str(e)})

        def do_POST(self):
            u = urlparse(self.path)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(n) or b"{}") if n else {}
                if not isinstance(body, dict):
                    raise ValueError("corpo deve ser um objeto JSON")
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"error": "JSON inválido"})
            try:
                with lock:
                    if u.path == "/api/emergency":
                        eid = city.add_emergency(int(body["node"]), int(body.get("severity", 3)))
                        return self._send(200, {"ok": True, "id": eid})
                    if u.path == "/api/close":
                        return self._send(200, {"ok": city.close_road(int(body["u"]), int(body["v"]))})
                    if u.path == "/api/open":
                        return self._send(200, {"ok": city.open_road(int(body["u"]), int(body["v"]))})
                    if u.path == "/api/undo":
                        return self._send(200, {"ok": city.undo()})
                    if u.path == "/api/redo":
                        return self._send(200, {"ok": city.redo()})
                if u.path == "/api/pause":
                    if ticker:
                        ticker.paused = bool(body.get("paused", not ticker.paused))
                    return self._send(200, {"paused": ticker.paused if ticker else False})
                return self._send(404, {"error": "rota desconhecida"})
            except (KeyError, TypeError, ValueError) as e:
                self._send(400, {"error": "requisição inválida: %s" % e})

    return Handler


def make_server(city, host="127.0.0.1", port=8000, tick_interval=0.3, autostart=True):
    lock = threading.RLock()
    ticker = Ticker(city, lock, tick_interval)
    httpd = ThreadingHTTPServer((host, port), make_handler(city, lock, ticker))
    httpd.daemon_threads = True
    if autostart:
        ticker.start()
    return httpd, ticker, lock
