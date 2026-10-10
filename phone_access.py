"""Open JARVIS on your phone, privately, through Tailscale. Standard library only.

How it stays private:
  * JARVIS itself still listens only on 127.0.0.1. `tailscale serve` (not funnel) passes requests from
    YOUR Tailscale devices to it over HTTPS. Nothing is opened to the internet or your Wi-Fi.
  * Any request that did not start on this PC needs a PIN first. The PIN is stored only as a salted hash
    in %USERPROFILE%\\.jarvis\\phone.json. 5 wrong PINs lock phone access for 15 minutes and raise an alert.
  * A request that came through Tailscale Funnel (the public internet) is always refused.

  python phone_access.py setup    choose a PIN and share JARVIS with your Tailscale devices
  python phone_access.py off      stop sharing and forget the PIN
"""
import getpass
import hashlib
import hmac
import json
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

DIR = Path(os.environ.get("JARVIS_SECRETS", Path.home() / ".jarvis"))
CONF = DIR / "phone.json"
PORT = int(os.environ.get("JARVIS_PORT", "8720"))
ITERATIONS = 300_000
SESSION_DAYS = 30
MAX_FAILS, LOCK_MIN = 5, 15
COOKIE = "jarvis_phone"
PROXY_HEADERS = ("x-forwarded-for", "x-forwarded-host", "tailscale-user-login", "tailscale-headers-info")


def tailscale():
    for exe in (shutil.which("tailscale"), r"C:\Program Files\Tailscale\tailscale.exe", "/usr/bin/tailscale"):
        if exe and Path(exe).exists():
            return exe
    return None


def pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), ITERATIONS).hex()


def load():
    try:
        conf = json.loads(CONF.read_text(encoding="utf-8"))
        return conf if conf.get("host") and conf.get("hash") and conf.get("salt") else None
    except (OSError, ValueError):
        return None


class Gate:
    """Decides which requests came from outside this PC and lets them in only with a PIN session."""

    def __init__(self):
        self.lock = threading.Lock()
        self.sessions = {}      # session id -> expiry time
        self.fails, self.locked_until = 0, 0

    @property
    def conf(self):
        return load()

    def host(self):
        c = self.conf
        return c["host"].lower() if c else None

    def is_remote(self, headers):
        host = (headers.get("Host") or "").split(":")[0].lower()
        return host not in ("127.0.0.1", "localhost") or any(headers.get(h) for h in PROXY_HEADERS)

    def from_funnel(self, headers):
        return bool(headers.get("Tailscale-Funnel-Request"))

    def session_ok(self, headers):
        sid = None
        for part in (headers.get("Cookie") or "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == COOKIE:
                sid = v
        with self.lock:
            exp = self.sessions.get(sid or "")
            if exp and exp > time.time():
                return True
            self.sessions.pop(sid or "", None)
        return False

    def login(self, pin):
        """Returns (cookie header or None, message)."""
        conf = self.conf
        if not conf:
            return None, "Phone access is off."
        with self.lock:
            if time.time() < self.locked_until:
                return None, f"Too many wrong PINs. Try again in {int((self.locked_until - time.time()) / 60) + 1} minutes."
            if not hmac.compare_digest(pin_hash(pin, conf["salt"]), conf["hash"]):
                self.fails += 1
                if self.fails >= MAX_FAILS:
                    self.fails, self.locked_until = 0, time.time() + LOCK_MIN * 60
                    return None, f"Wrong PIN. Phone access is locked for {LOCK_MIN} minutes."
                return None, "Wrong PIN."
            self.fails = 0
            sid = secrets.token_urlsafe(32)
            self.sessions[sid] = time.time() + SESSION_DAYS * 86400
        cookie = f"{COOKIE}={sid}; Path=/; Max-Age={SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Strict"
        return cookie, "ok"


PIN_PAGE = """<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>J.A.R.V.I.S.</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05080d;color:#e8f6ff;
font:16px system-ui,sans-serif}form{width:min(320px,86vw);text-align:center;border:1px solid #ff3b3b55;
padding:28px;border-radius:14px;background:#0b111a}h1{font-size:20px;letter-spacing:.3em;color:#ff4d4d}
input{width:100%;box-sizing:border-box;font-size:28px;letter-spacing:.4em;text-align:center;padding:12px;
border-radius:10px;border:1px solid #ff3b3b88;background:#05080d;color:#fff;margin:14px 0}
button{width:100%;padding:12px;font-size:16px;border:0;border-radius:10px;background:#ff3b3b;color:#fff}
p{color:#ff9a9a;min-height:1.2em}</style></head><body>
<form method="post" action="/phone-login"><h1>J.A.R.V.I.S.</h1><div>Enter your phone PIN</div>
<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" autofocus required>
<button>Unlock</button><p>__MSG__</p></form></body></html>"""


def pin_page(msg=""):
    safe = msg.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return PIN_PAGE.replace("__MSG__", safe).encode()


def setup():
    ts = tailscale()
    if not ts:
        raise RuntimeError("Tailscale isn't installed on this PC yet. Get it from https://tailscale.com/download/windows, "
                           "sign in, then run this again.")
    try:
        status = json.loads(subprocess.run([ts, "status", "--json"], capture_output=True, text=True, timeout=30).stdout)
        host = (status.get("Self", {}).get("DNSName") or "").rstrip(".")
    except (OSError, ValueError, subprocess.TimeoutExpired):
        host = ""
    if not host:
        raise RuntimeError("Tailscale is installed but not signed in. Open Tailscale from the taskbar, sign in, then run this again.")
    while True:
        pin = getpass.getpass("Choose a phone PIN (at least 6 digits, typing is hidden): ").strip()
        if not (pin.isdigit() and len(pin) >= 6):
            print("Use at least 6 digits, numbers only.")
            continue
        if pin in ("123456", "000000", "111111", "654321", "123123") or len(set(pin)) == 1:
            print("That PIN is too easy to guess. Pick another.")
            continue
        if getpass.getpass("Type it again: ").strip() != pin:
            print("They didn't match. Try again.")
            continue
        break
    DIR.mkdir(parents=True, exist_ok=True)
    salt = secrets.token_hex(16)
    CONF.write_text(json.dumps({"host": host, "salt": salt, "hash": pin_hash(pin, salt)}), encoding="utf-8")
    r = subprocess.run([ts, "serve", "--bg", str(PORT)], capture_output=True, text=True, timeout=120)
    out = (r.stdout + r.stderr).strip()
    if r.returncode != 0:
        raise RuntimeError("Tailscale couldn't share JARVIS:\n" + out +
                           "\nIf it mentions HTTPS, open the link it shows, press Enable, then run this again.")
    print(f"\nPhone access is on. On your phone, with Tailscale on, open:\n\n    https://{host}/\n")
    print("Restart JARVIS (close it, then .\\start.bat) so it picks this up.")


def off():
    ts = tailscale()
    if ts:
        subprocess.run([ts, "serve", "--https=443", "off"], capture_output=True, text=True, timeout=60)
    try:
        CONF.unlink()
    except OSError:
        pass
    print("Phone access is off. Restart JARVIS.")


if __name__ == "__main__":
    try:
        {"setup": setup, "off": off}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: print(__doc__))()
    except RuntimeError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
