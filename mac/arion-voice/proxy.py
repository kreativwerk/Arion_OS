#!/usr/bin/env python3
"""
ARION-Stimme: Torwächter vor VoiceStudio auf dem Büro-Mac.

Tailscale Funnel leitet Anfragen aus dem Internet an diesen Proxy
(127.0.0.1:3901). Er lässt nur zwei Wege durch – Sprechen und Zuhören –
und nur mit dem geheimen Token aus Arion OS (Header X-Arion-Token).
Alles andere (Verwaltung, Stimmen-Klonen, Einstellungen von VoiceStudio)
bleibt von außen unerreichbar.

VoiceStudio selbst hört nur lokal auf 127.0.0.1:3900.
Nur Python-Standardbibliothek, keine Installation nötig.
"""

import hmac
import http.client
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("ARION_PROXY_PORT", "3901"))
UPSTREAM_HOST = "127.0.0.1"
UPSTREAM_PORT = int(os.environ.get("VOICESTUDIO_PORT", "3900"))
MAX_BODY = 10 * 1024 * 1024  # 10 MB, Arion OS schickt höchstens 8 MB
ALLOWED = {("POST", "/v1/audio/speech"), ("POST", "/v1/audio/transcriptions")}
TOKEN_FILE = os.path.expanduser("~/Library/Application Support/ArionVoice/token")


def load_token() -> str:
    try:
        with open(TOKEN_FILE, encoding="utf-8") as f:
            token = f.read().strip()
    except OSError:
        token = ""
    if len(token) < 32:
        sys.exit(f"Token fehlt oder ist zu kurz: {TOKEN_FILE}")
    return token


TOKEN = load_token()


class Handler(BaseHTTPRequestHandler):
    server_version = "ArionVoice"
    protocol_version = "HTTP/1.1"
    sys_version = ""

    def log_message(self, fmt, *args):  # nur Weg und Status, nie Inhalte oder Header
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def _deny(self, code: int, text: str):
        body = text.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        sent = self.headers.get("X-Arion-Token", "")
        return bool(sent) and hmac.compare_digest(sent.encode(), TOKEN.encode())

    def _handle(self):
        self.close_connection = True
        path = self.path.split("?", 1)[0]
        if self.command == "GET" and path == "/health":
            return self._deny(200, "ok")
        if not self._authorized():
            return self._deny(401, "unauthorized")
        if (self.command, path) not in ALLOWED:
            return self._deny(404, "not found")
        if self.headers.get("Transfer-Encoding"):
            return self._deny(411, "length required")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._deny(400, "bad length")
        if length <= 0 or length > MAX_BODY:
            return self._deny(413, "too large")
        body = self.rfile.read(length)

        headers = {"Content-Type": self.headers.get("Content-Type", "application/octet-stream"), "Content-Length": str(length)}
        conn = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=120)
        try:
            conn.request(self.command, path, body=body, headers=headers)
            resp = conn.getresponse()
        except OSError:
            conn.close()
            return self._deny(502, "VoiceStudio nicht erreichbar")
        try:
            self.send_response(resp.status)
            for key in ("Content-Type",):
                val = resp.getheader(key)
                if val:
                    self.send_header(key, val)
            self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            while True:
                chunk = resp.read(16384)
                if not chunk:
                    break
                self.wfile.write(b"%x\r\n%s\r\n" % (len(chunk), chunk))
            self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            conn.close()

    do_GET = _handle
    do_POST = _handle

    def do_PUT(self):
        self._deny(405, "method not allowed")

    do_DELETE = do_PUT
    do_PATCH = do_PUT


if __name__ == "__main__":
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    sys.stderr.write(f"ARION-Stimme: {LISTEN_HOST}:{LISTEN_PORT} -> VoiceStudio {UPSTREAM_HOST}:{UPSTREAM_PORT}\n")
    srv.serve_forever()
