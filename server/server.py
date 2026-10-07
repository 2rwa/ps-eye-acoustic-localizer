#!/usr/bin/env python3
"""Standalone HTTP/WebSocket server for PS Eye acoustic-localizer."""
from __future__ import annotations

import argparse
import ipaddress
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

import ps_eye_stream


class Handler(SimpleHTTPRequestHandler):
    server_version = "PsEyeLocalizer/0.1"

    def local_network_request(self) -> bool:
        host = self.client_address[0].split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(host)
        except ValueError:
            return False
        return ip.is_loopback or ip.is_private or ip.is_link_local

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, value: dict, status: int = 200) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        upgrade = self.headers.get("Upgrade", "").lower() == "websocket"

        if path in {"/ps-eye/ws", "/ps-eye/a/ws"} and upgrade:
            ps_eye_stream.handle_websocket(self, "a")
            return
        if path == "/ps-eye/b/ws" and upgrade:
            ps_eye_stream.handle_websocket(self, "b")
            return
        if path == "/healthz":
            self.send_json({"ok": True, "ps_eye": ps_eye_stream.status()})
            return

        if path.startswith("/ps-eye/") and not self.local_network_request():
            self.send_error(403)
            return

        super().do_GET()


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    ap = argparse.ArgumentParser()
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--directory", default=str(root / "web"))
    args = ap.parse_args()

    directory = str(Path(args.directory).resolve())
    handler = lambda *a, **kw: Handler(*a, directory=directory, **kw)
    httpd = Server((args.bind, args.port), handler)
    print(f"PS Eye localizer serving {directory} on http://{args.bind}:{args.port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
