"""Graveyard BBS app backend (spec 05 design section 4).

Starts `graveyard serve` from the BBS checkout and tells the page where the web terminal is.
"""
import atexit
import hashlib
import hmac
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bin"))
import gy  # noqa: E402

APP = os.environ.get("KIROCREW_APP_NAME", "graveyard-bbs")
MAX_SKEW = 60
LAUNCH_PATHS = {"/launch", "/api/launch", f"/api/apps/{APP}/launch"}


def free_port() -> int:
    """A free local port, so a BBS someone already runs on 2626 cannot block the app."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ProxyV2:
    """Replay-proof gateway signature check (api-reference, "Replay-proof v2 signature")."""

    def __init__(self, secret: str, max_entries: int = 4096):
        self.secret = secret
        self.max_entries = max_entries
        self.seen: dict[str, float] = {}

    def verify(self, method, target, body, signature, nonce, now=None) -> bool:
        now = time.time() if now is None else now
        if not self.secret or not signature or not re.fullmatch(r"[0-9a-f]{32}", nonce or ""):
            return False
        ts, _, given = signature.partition(":")
        if not re.fullmatch(r"[0-9]{1,12}", ts) or abs(now - int(ts)) > MAX_SKEW:
            return False
        msg = f"v2:{ts}:{nonce}:{method}:{target}:{hashlib.sha256(body).hexdigest()}"
        want = hmac.new(self.secret.encode(), msg.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(given, want):
            return False
        self.seen = {n: e for n, e in self.seen.items() if e >= now}
        if nonce in self.seen or len(self.seen) >= self.max_entries:
            return False
        self.seen[nonce] = int(ts) + MAX_SKEW
        return True


class Bbs:
    """The child `graveyard serve` and what it printed."""

    def __init__(self):
        self.url = ""
        self.error = ""
        self.proc = None

    def start(self):
        try:
            cwd, argv = gy.command(["serve", "--port", str(free_port()), "--telnet-port", "0"])
        except SystemExit as e:
            self.error = str(e)
            return
        # Same session group and inherited env, so the gateway can reap it with this backend.
        self.proc = subprocess.Popen(
            argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        atexit.register(self.proc.terminate)
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        last = ""
        for line in self.proc.stdout:
            line = line.strip()
            m = re.match(r"Web terminal: (\S+)", line)
            if m:
                self.url = m.group(1)
                # Agents' MCP and the moderator read this to reach THIS BBS, not a stray one.
                gy.write_url(self.url.split("/term/")[0])
            elif line:
                last = line
                print(f"graveyard: {line}", file=sys.stderr, flush=True)
        self.url = ""
        gy.write_url("")
        self.error = f"graveyard serve stopped: {last if last else '(no output)'}"

    def launch(self) -> dict:
        return {"url": self.url, "error": self.error}


bbs = Bbs()
verifier = ProxyV2(os.environ.get("KIROCREW_PROXY_SECRET", ""))


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"status": "ok", "app": APP})
        body = b""  # GET only: the signature binds the empty body
        h = self.headers
        if not verifier.verify(
            "GET", self.path, body, h.get("X-KiroCrew-Proxy-V2"), h.get("X-KiroCrew-Proxy-Nonce")
        ):
            return self._send(401, {"error": "unsigned"})
        # Gateway builds differ in how much prefix they strip, so accept each form.
        if self.path.split("?")[0] in LAUNCH_PATHS:
            return self._send(200, bbs.launch())
        print(f"graveyard-bbs: no route for {self.path}", file=sys.stderr, flush=True)
        self._send(404, {"error": "not found", "path": self.path})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    bbs.start()
    HTTPServer(("127.0.0.1", int(os.environ.get("PORT", "9100"))), Handler).serve_forever()
