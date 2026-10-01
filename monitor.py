#!/usr/bin/env python3
"""One monitoring pass by hand: `python monitor.py [minutes]`.

JARVIS already does this by itself every hour while it is open (set JARVIS_WATCH_MINUTES=0 to turn
that off). It never acts: findings go to logs/alerts.jsonl and show up in the HUD.
"""
import sys

import server

if __name__ == "__main__":
    print(server.watch_pass(int(sys.argv[1]) if len(sys.argv) > 1 else 60))
