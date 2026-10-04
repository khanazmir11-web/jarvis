"""Read-only YouTube connector for JARVIS, as a tiny MCP server (Python standard library only).

It uses YOUR Google Cloud OAuth client with the youtube.readonly scope, so it can look but never
post, like, comment, subscribe or delete. The client file and the saved sign-in live outside the
repo, in %USERPROFILE%\\.jarvis (or $JARVIS_SECRETS), and are never printed.

  python youtube_mcp.py login    sign in once in your browser
  python youtube_mcp.py test     show your channel, to check it works
  python youtube_mcp.py          run as an MCP server (Claude Code starts it this way)
"""
import base64
import hashlib
import http.server
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

DIR = Path(os.environ.get("JARVIS_SECRETS") or Path.home() / ".jarvis")
CLIENT = DIR / "youtube_client.json"
TOKEN = DIR / "youtube_token.json"
SCOPE = "https://www.googleapis.com/auth/youtube.readonly"   # space-separated if more than one
NAME = "youtube"   # used in messages and the MCP server name; classroom_mcp.py reuses this file with its own values
API = os.environ.get("YOUTUBE_API_BASE", "https://www.googleapis.com/youtube/v3")
_access = {"token": None, "until": 0}


def client():
    if not CLIENT.exists():
        raise RuntimeError(f"No OAuth client file. Download it from Google Cloud and save it as {CLIENT}")
    data = json.loads(CLIENT.read_text(encoding="utf-8"))
    return data.get("installed") or data.get("web") or data


def post_form(url, fields):
    req = urllib.request.Request(url, data=urllib.parse.urlencode(fields).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Google sign-in error {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from None


def login():
    """Installed-app sign-in: browser -> Google -> back to a one-shot page on 127.0.0.1, with PKCE."""
    c = client()
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    got = {}

    class Back(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] != state:
                self.send_response(400); self.end_headers(); return
            got.update({k: v[0] for k, v in q.items()})
            self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers()
            self.wfile.write(f"<h2>JARVIS: {NAME} connected (read-only). You can close this tab.</h2>".encode())

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Back)
    redirect = f"http://127.0.0.1:{srv.server_port}"
    url = c.get("auth_uri", "https://accounts.google.com/o/oauth2/auth") + "?" + urllib.parse.urlencode({
        "client_id": c["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256"})
    print(f"Opening your browser to sign in to {NAME} (read-only)...")
    print("If it doesn't open, paste this address into your browser:\n" + url)
    webbrowser.open(url)
    while "code" not in got and "error" not in got:
        srv.handle_request()
    if "error" in got:
        raise RuntimeError("Sign-in cancelled: " + got["error"])
    tok = post_form(c.get("token_uri", "https://oauth2.googleapis.com/token"), {
        "code": got["code"], "client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
        "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier})
    granted = tok.get("scope", SCOPE).split()
    if any(sc not in granted for sc in SCOPE.split()):
        raise RuntimeError(f"Google didn't grant all the {NAME} read access. Run login again and tick every box.")
    DIR.mkdir(parents=True, exist_ok=True)
    TOKEN.write_text(json.dumps({"refresh_token": tok["refresh_token"]}), encoding="utf-8")
    try:
        os.chmod(TOKEN, 0o600)
    except OSError:
        pass
    print(f"Done. Sign-in saved in {TOKEN} (keep it private; delete it to disconnect).")


def access_token():
    if _access["token"] and time.time() < _access["until"] - 60:
        return _access["token"]
    if not TOKEN.exists():
        raise RuntimeError(f"{NAME} isn't signed in yet. Run its connect-{NAME.lower()}.bat (or: python {NAME.lower()}_mcp.py login)")
    c = client()
    tok = post_form(c.get("token_uri", "https://oauth2.googleapis.com/token"), {
        "client_id": c["client_id"], "client_secret": c.get("client_secret", ""),
        "refresh_token": json.loads(TOKEN.read_text(encoding="utf-8"))["refresh_token"], "grant_type": "refresh_token"})
    _access.update(token=tok["access_token"], until=time.time() + int(tok.get("expires_in", 3600)))
    return _access["token"]


def api(path, **params):
    url = f"{API}/{path}?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + access_token()})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{NAME} API error {e.code}: {e.read().decode('utf-8', 'replace')[:300]}") from None


def clamp(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def video_brief(item, vid=None):
    s = item.get("snippet", {})
    vid = vid or s.get("resourceId", {}).get("videoId") or item.get("id")
    return {"title": s.get("title"), "channel": s.get("channelTitle") or s.get("videoOwnerChannelTitle"),
            "published": s.get("publishedAt"), "url": f"https://www.youtube.com/watch?v={vid}" if vid else None}


# ---------------------------------------------------------------- tools (all read-only)
def get_my_channel(_):
    items = api("channels", part="snippet,statistics", mine="true").get("items", [])
    if not items:
        return {"note": "This Google account has no YouTube channel."}
    c = items[0]
    return {"name": c["snippet"]["title"], "url": f"https://www.youtube.com/channel/{c['id']}", **c.get("statistics", {})}


def list_subscriptions(args):
    data = api("subscriptions", part="snippet", mine="true", order="alphabetical",
               maxResults=clamp(args.get("max_results"), 1, 50, 25))
    return [{"channel": i["snippet"]["title"], "channel_id": i["snippet"]["resourceId"]["channelId"]} for i in data.get("items", [])]


def list_latest_videos(args):
    """Latest videos from the channels you subscribe to (most relevant subscriptions first)."""
    subs = api("subscriptions", part="snippet", mine="true", order="relevance",
               maxResults=clamp(args.get("max_channels"), 1, 50, 15)).get("items", [])
    ids = [s["snippet"]["resourceId"]["channelId"] for s in subs]
    if not ids:
        return []
    chans = api("channels", part="contentDetails", id=",".join(ids)).get("items", [])
    per = clamp(args.get("per_channel"), 1, 5, 2)
    out = []
    for ch in chans:
        uploads = ch.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
        if uploads:
            out += [video_brief(i) for i in api("playlistItems", part="snippet", playlistId=uploads, maxResults=per).get("items", [])]
    out.sort(key=lambda v: v.get("published") or "", reverse=True)
    return out[:clamp(args.get("limit"), 1, 50, 20)]


def list_my_playlists(args):
    data = api("playlists", part="snippet,contentDetails", mine="true", maxResults=clamp(args.get("max_results"), 1, 50, 25))
    return [{"title": p["snippet"]["title"], "videos": p["contentDetails"]["itemCount"],
             "url": f"https://www.youtube.com/playlist?list={p['id']}"} for p in data.get("items", [])]


def search_videos(args):
    q = str(args.get("query", "")).strip()[:200]
    if not q:
        raise RuntimeError("query is required")
    data = api("search", part="snippet", type="video", q=q, maxResults=clamp(args.get("max_results"), 1, 25, 10))
    return [video_brief(i, i["id"].get("videoId")) for i in data.get("items", [])]


def get_video(args):
    vid = str(args.get("video_id", "")).strip()
    if "v=" in vid:
        vid = urllib.parse.parse_qs(urllib.parse.urlparse(vid).query).get("v", [""])[0]
    items = api("videos", part="snippet,statistics,contentDetails", id=vid[:20]).get("items", [])
    if not items:
        return {"note": "No video with that id."}
    v = items[0]
    return {**video_brief(v, v["id"]), "duration": v["contentDetails"].get("duration"),
            "description": v["snippet"].get("description", "")[:1500], **v.get("statistics", {})}


NUM = {"type": "integer"}
TOOLS = {
    "get_my_channel": (get_my_channel, "Your YouTube channel name, subscriber, view and video counts.", {}),
    "list_subscriptions": (list_subscriptions, "Channels you subscribe to.", {"max_results": NUM}),
    "list_latest_videos": (list_latest_videos, "Newest videos from channels you subscribe to, newest first.",
                        {"max_channels": NUM, "per_channel": NUM, "limit": NUM}),
    "list_my_playlists": (list_my_playlists, "Your playlists with video counts.", {"max_results": NUM}),
    "search_videos": (search_videos, "Search YouTube for videos.", {"query": {"type": "string"}, "max_results": NUM}),
    "get_video": (get_video, "Details and stats for one video (id or watch URL).", {"video_id": {"type": "string"}}),
}


# ---------------------------------------------------------------- MCP over stdio (JSON-RPC, one message per line)
def handle(msg):
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None  # notification
    if method == "initialize":
        result = {"protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
                  "capabilities": {"tools": {}}, "serverInfo": {"name": "jarvis-" + NAME.lower(), "version": "1.0"}}
    elif method == "tools/list":
        result = {"tools": [{"name": n, "description": d + " Read-only.", "annotations": {"readOnlyHint": True},
                             "inputSchema": {"type": "object", "properties": p}} for n, (_, d, p) in TOOLS.items()]}
    elif method == "tools/call":
        name = msg.get("params", {}).get("name")
        args = msg.get("params", {}).get("arguments") or {}
        if name not in TOOLS:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": f"unknown tool {name}"}}
        try:
            text, err = json.dumps(TOOLS[name][0](args), ensure_ascii=False, indent=1), False
        except Exception as e:  # report the problem to Claude instead of crashing the server
            text, err = f"Error: {e}", True
        result = {"content": [{"type": "text", "text": text}], "isError": err}
    elif method == "ping":
        result = {}
    else:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}}
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def serve():
    # Windows defaults to an 8-bit console code page; video titles are full of emoji
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            reply = handle(json.loads(line))
        except ValueError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        if reply is not None:
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    try:
        if cmd == "login":
            login()
        elif cmd == "test":
            print(json.dumps(get_my_channel({}), indent=1))
        else:
            serve()
    except RuntimeError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
