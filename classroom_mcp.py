"""Read-only Google Classroom connector for JARVIS, as a tiny MCP server (Python standard library only).

It reuses youtube_mcp.py's sign-in and MCP plumbing and the same Google Cloud OAuth client file
(%USERPROFILE%\\.jarvis\\youtube_client.json), with its own read-only Classroom permissions and its
own saved sign-in (classroom_token.json). It can see your classes, work and announcements, never
hand anything in, post or change anything.

  python classroom_mcp.py login    sign in once in your browser
  python classroom_mcp.py test     list your classes, to check it works
  python classroom_mcp.py          run as an MCP server (Claude Code starts it this way)
"""
import datetime
import json
import os
import sys

import youtube_mcp as g

g.NAME = "classroom"
g.TOKEN = g.DIR / "classroom_token.json"
g.API = os.environ.get("CLASSROOM_API_BASE", "https://classroom.googleapis.com/v1")
g.SCOPE = " ".join("https://www.googleapis.com/auth/" + s for s in (
    "classroom.courses.readonly", "classroom.coursework.me.readonly", "classroom.announcements.readonly"))


def active_courses(limit=20):
    return g.api("courses", studentId="me", courseStates="ACTIVE", pageSize=limit).get("courses", [])


def pick_courses(args):
    cid = str(args.get("course_id") or "").strip()
    return [{"id": cid, "name": cid}] if cid else active_courses()


def due_of(work):
    d, t = work.get("dueDate"), work.get("dueTime", {})
    if not d:
        return None
    return datetime.datetime(d["year"], d["month"], d["day"], t.get("hours", 23), t.get("minutes", 59),
                             tzinfo=datetime.timezone.utc)


def list_courses(_):
    return [{"name": c.get("name"), "section": c.get("section"), "course_id": c["id"], "url": c.get("alternateLink")}
            for c in active_courses()]


def list_coursework(args):
    """Most recently posted or updated work in your classes."""
    out = []
    for c in pick_courses(args):
        for w in g.api(f"courses/{c['id']}/courseWork", orderBy="updateTime desc",
                       pageSize=g.clamp(args.get("per_course"), 1, 20, 5)).get("courseWork", []):
            due = due_of(w)
            out.append({"course": c.get("name"), "title": w.get("title"), "type": w.get("workType"),
                        "due": due.isoformat() if due else None, "updated": w.get("updateTime"),
                        "description": (w.get("description") or "")[:400], "url": w.get("alternateLink")})
    out.sort(key=lambda w: w.get("updated") or "", reverse=True)
    return out[:g.clamp(args.get("limit"), 1, 60, 20)]


def list_upcoming_work(args):
    """Work due in the next N days that you haven't handed in yet."""
    days = g.clamp(args.get("days"), 1, 60, 14)
    now = datetime.datetime.now(datetime.timezone.utc)
    out = []
    for c in active_courses():
        subs = g.api(f"courses/{c['id']}/courseWork/-/studentSubmissions", userId="me", pageSize=100)
        done = {s["courseWorkId"] for s in subs.get("studentSubmissions", []) if s.get("state") in ("TURNED_IN", "RETURNED")}
        for w in g.api(f"courses/{c['id']}/courseWork", orderBy="dueDate asc", pageSize=50).get("courseWork", []):
            due = due_of(w)
            if due and now <= due <= now + datetime.timedelta(days=days) and w["id"] not in done:
                out.append({"course": c.get("name"), "title": w.get("title"), "due": due.isoformat(), "url": w.get("alternateLink")})
    return sorted(out, key=lambda w: w["due"])


def list_announcements(args):
    out = []
    for c in pick_courses(args):
        for a in g.api(f"courses/{c['id']}/announcements", orderBy="updateTime desc",
                       pageSize=g.clamp(args.get("per_course"), 1, 20, 3)).get("announcements", []):
            out.append({"course": c.get("name"), "text": (a.get("text") or "")[:500], "posted": a.get("updateTime"),
                        "url": a.get("alternateLink")})
    out.sort(key=lambda a: a.get("posted") or "", reverse=True)
    return out[:g.clamp(args.get("limit"), 1, 40, 15)]


NUM, STR = {"type": "integer"}, {"type": "string"}
g.TOOLS = {
    "list_courses": (list_courses, "Your active Google Classroom classes.", {}),
    "list_upcoming_work": (list_upcoming_work, "Assignments due in the next N days (default 14) that you haven't handed in.",
                           {"days": NUM}),
    "list_coursework": (list_coursework, "Latest posted or updated work, across all classes or one course_id.",
                        {"course_id": STR, "per_course": NUM, "limit": NUM}),
    "list_announcements": (list_announcements, "Latest teacher announcements, across all classes or one course_id.",
                           {"course_id": STR, "per_course": NUM, "limit": NUM}),
}

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "serve"
    try:
        if cmd == "login":
            g.login()
        elif cmd == "test":
            print(json.dumps(list_courses({}), indent=1, ensure_ascii=False))
        else:
            g.serve()
    except RuntimeError as e:
        print(e, file=sys.stderr)
        sys.exit(1)
