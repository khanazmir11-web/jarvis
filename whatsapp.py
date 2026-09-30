#!/usr/bin/env python3
"""Private WhatsApp chat with JARVIS, using the official WhatsApp Business Cloud API (Meta).

Privacy and safety:
  * Meta signs every webhook with your App Secret; unsigned or badly signed requests are dropped.
  * Only messages from JARVIS_WA_OWNER (your own number) are answered. Everyone else is ignored
    and logged, and they get no reply, so strangers can't even tell JARVIS exists.
  * Same rules as the HUD: chat is read-only, actions and learning become proposals.
    From your phone you can list them ("pending") and approve/reject by id.
  * Listens on 127.0.0.1 only; expose just this port with a tunnel (see README).
  * Secrets come from .env on your device, never from the code.

Commands from your phone:
  pending            list what's waiting for your OK
  approve <id>       approve one proposal
  reject <id>        reject one proposal
  anything else      chat with JARVIS
"""
import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import server

PORT = int(os.environ.get("JARVIS_WA_PORT", "8721"))
OWNER = re.sub(r"\D", "", os.environ.get("JARVIS_WA_OWNER", ""))
PHONE_ID = os.environ.get("JARVIS_WA_PHONE_NUMBER_ID", "")
TOKEN = os.environ.get("JARVIS_WA_TOKEN", "")
APP_SECRET = os.environ.get("JARVIS_WA_APP_SECRET", "")
VERIFY = os.environ.get("JARVIS_WA_VERIFY_TOKEN", "")
API = os.environ.get("JARVIS_WA_API", "https://graph.facebook.com/v21.0")
SEEN = deque(maxlen=500)          # WhatsApp retries webhooks; answer each message once
RECENT = deque(maxlen=20)         # simple flood limit
LOCK = threading.Lock()


def send(to, text):
    body = json.dumps({"messaging_product": "whatsapp", "to": to, "type": "text",
                       "text": {"body": text[:4000] or "(empty)"}}).encode()
    req = urllib.request.Request(f"{API}/{PHONE_ID}/messages", data=body, method="POST", headers={
        "Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as e:  # never crash the bridge on a send failure
        server.audit("whatsapp_send_error", error=str(e)[:200])


def describe(p):
    if p["kind"] == "action":
        line = f"[{p['id']}] ACTION on {p['account']}: {p['summary']}"
    else:
        line = f"[{p['id']}] LEARN: {p['title']}"
    return line + (f"\n  ⚠ {', '.join(p['flags'])}" if p["flags"] else "")


def handle(sender, text):
    text = text.strip()
    cmd = text.lower().split()
    if cmd[:1] == ["pending"]:
        items = server.pending()
        return send(sender, "\n".join(map(describe, items)) if items else "Nothing waiting. Suspiciously quiet.")
    if len(cmd) == 2 and cmd[0] in ("approve", "reject"):
        pid = re.sub(r"[^a-f0-9]", "", cmd[1])
        server.audit("whatsapp_" + cmd[0], id=pid)
        if cmd[0] == "reject":
            server.reject(pid)
            return send(sender, f"Rejected {pid}.")
        r = server.approve(pid)
        return send(sender, "⚠ " + r["error"] if "error" in r else r.get("result") or f"Saved '{r['note']}' to memory.")
    send(sender, "On it…")
    r = server.answer(text, "whatsapp")
    out = r["text"] or "(no reply)"
    if r["in_flags"]:
        out = "⚠ Your message matched: " + ", ".join(r["in_flags"]) + "\n\n" + out
    if r["flags"]:
        out += "\n\n⚠ Reply flagged: " + ", ".join(r["flags"])
    if r["proposals"]:
        out += "\n\nWaiting for your OK (reply 'approve <id>' or 'reject <id>'):\n" + \
            "\n".join(map(describe, r["proposals"]))
    send(sender, out)


class Hook(BaseHTTPRequestHandler):
    server_version = "JARVIS-WA"

    def log_message(self, *a):
        pass

    def reply(self, code, body=b""):
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # Meta's one-time webhook verification
        from urllib.parse import parse_qs, urlparse
        q = parse_qs(urlparse(self.path).query)
        if (VERIFY and q.get("hub.mode") == ["subscribe"]
                and hmac.compare_digest(q.get("hub.verify_token", [""])[0], VERIFY)):
            return self.reply(200, q.get("hub.challenge", [""])[0].encode())
        self.reply(403)

    def do_POST(self):
        raw = self.rfile.read(min(int(self.headers.get("Content-Length") or 0), 256_000))
        sig = self.headers.get("X-Hub-Signature-256", "")
        good = "sha256=" + hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
        if not APP_SECRET or not hmac.compare_digest(sig, good):
            server.audit("whatsapp_rejected", reason="bad signature", flags=["forged webhook"])
            return self.reply(401)
        self.reply(200)  # acknowledge fast; Meta retries slow webhooks
        try:
            data = json.loads(raw)
        except ValueError:
            return
        for entry in data.get("entry", []):
            for change in entry.get("changes", []):
                for msg in change.get("value", {}).get("messages", []):
                    self.route(msg)

    def route(self, msg):
        sender, mid = msg.get("from", ""), msg.get("id", "")
        with LOCK:
            if mid in SEEN:
                return
            SEEN.append(mid)
        if not OWNER or sender != OWNER:
            server.audit("whatsapp_stranger", sender=sender[-4:].rjust(len(sender), "*"),
                         flags=["message from unknown number"])
            return
        now = time.time()
        with LOCK:
            RECENT.append(now)
            flooded = len(RECENT) == RECENT.maxlen and now - RECENT[0] < 60
        if flooded:
            return send(sender, "Slow down, sir. Even I need a moment.")
        if msg.get("type") != "text":
            return send(sender, "Text only for now. Voice notes are on the to-do list.")
        threading.Thread(target=handle, args=(sender, msg["text"]["body"][:4000]), daemon=True).start()


def check_config():
    missing = [n for n, v in [("JARVIS_WA_OWNER", OWNER), ("JARVIS_WA_PHONE_NUMBER_ID", PHONE_ID),
                              ("JARVIS_WA_TOKEN", TOKEN), ("JARVIS_WA_APP_SECRET", APP_SECRET),
                              ("JARVIS_WA_VERIFY_TOKEN", VERIFY)] if not v]
    if missing:
        raise SystemExit("Missing in .env: " + ", ".join(missing) + "  (see README, WhatsApp section)")


if __name__ == "__main__":
    check_config()
    print(f"JARVIS WhatsApp bridge on http://127.0.0.1:{PORT}/  (only {OWNER[:3]}…{OWNER[-2:]} is answered)")
    ThreadingHTTPServer(("127.0.0.1", PORT), Hook).serve_forever()
