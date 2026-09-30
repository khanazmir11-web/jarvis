#!/usr/bin/env python3
"""Draw the JARVIS app icons (web/icon-192.png, web/icon-512.png) with the standard library only."""
import math
import struct
import zlib
from pathlib import Path

BG, CYAN, CORE = (2, 7, 13), (39, 211, 255), (230, 251, 255)


def pixel(x, y, s):
    c = s / 2
    d = math.hypot(x - c, y - c) / s * 512
    ang = math.atan2(y - c, x - c)
    if d < 30:
        return CORE
    if d < 62:
        return CYAN
    if 125 < d < 131:
        return CYAN
    if 165 < d < 175 and (math.degrees(ang) % 30) < 21:
        return CYAN
    hexr = 110 / math.cos(((ang + math.pi / 6) % (math.pi / 3)) - math.pi / 6)
    if abs(d - hexr) < 5 and d < 130:
        return CYAN
    return BG


def png(size, path):
    rows = b"".join(b"\x00" + bytes(v for x in range(size) for v in pixel(x + .5, y + .5, size))
                    for y in range(size))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


if __name__ == "__main__":
    web = Path(__file__).resolve().parent / "web"
    for s in (192, 512):
        png(s, web / f"icon-{s}.png")
    print("icons written")
