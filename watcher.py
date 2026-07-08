#!/usr/bin/env python3
"""
DayBrain native window watcher for macOS.
Uses CGWindowListCopyWindowInfo (public Quartz API) — ZERO permissions required.
Outputs JSON lines to stdout for consumption by the DayBrain Node.js process.

Install: pip3 install pyobjc-framework-Quartz
"""

import sys
import time
import json
import os

def main():
    try:
        from Quartz import (
            CGWindowListCopyWindowInfo,
            kCGWindowListOptionOnScreenOnly,
            kCGNullWindowID,
        )
        from AppKit import NSWorkspace
    except ImportError:
        print(
            json.dumps(
                {
                    "error": "pyobjc_missing",
                    "message": "Run: pip3 install pyobjc-framework-Quartz",
                }
            ),
            flush=True,
        )
        sys.exit(0)

    print(
        json.dumps(
            {
                "status": "started",
                "backend": "CGWindow",
                "permissions": "none_required",
            }
        ),
        flush=True,
    )

    current_app = None
    current_title = None
    current_start = time.time()
    last_emit = 0
    emit_interval = 30

    while True:
        try:
            result = get_active_window(NSWorkspace, CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly, kCGNullWindowID)
        except Exception as e:
            print(json.dumps({"error": str(e)}), flush=True)
            time.sleep(5)
            continue

        if "error" in result:
            print(json.dumps(result), flush=True)
            time.sleep(5)
            continue

        new_app = result.get("app", "")
        new_title = result.get("title", "")

        changed = new_app != current_app or (new_title and new_title != current_title)

        if changed and current_app:
            duration = time.time() - current_start
            if duration >= 2:
                print(
                    json.dumps(
                        {
                            "app": current_app,
                            "title": current_title or current_app,
                            "duration": round(duration, 1),
                            "started": time.strftime(
                                "%Y-%m-%dT%H:%M:%S.000Z",
                                time.gmtime(current_start),
                            ),
                        }
                    ),
                    flush=True,
                )

        if changed:
            current_app = new_app
            current_title = new_title
            current_start = time.time()
            last_emit = time.time()
        elif current_app and current_title and (time.time() - last_emit) >= emit_interval:
            duration = time.time() - current_start
            print(
                json.dumps(
                    {
                        "app": current_app,
                        "title": current_title,
                        "duration": round(duration, 1),
                        "started": time.strftime(
                            "%Y-%m-%dT%H:%M:%S.000Z",
                            time.gmtime(current_start),
                        ),
                        "ongoing": True,
                    }
                ),
                flush=True,
            )
            last_emit = time.time()

        time.sleep(1)


def get_active_window(NSWorkspace, CGWindowListCopyWindowInfo, kCGOnScreen, kCGNull):
    app = NSWorkspace.sharedWorkspace().frontmostApplication()
    pid = app.processIdentifier()
    name = app.localizedName() or ""
    windows = CGWindowListCopyWindowInfo(kCGOnScreen, kCGNull)

    title = ""
    url = ""

    for w in windows:
        if w.get("kCGWindowOwnerPID") != pid:
            continue
        layer = w.get("kCGWindowLayer", 99)
        if layer != 0:
            continue
        t = w.get("kCGWindowName", "")
        if t:
            title = t
            break

    return {"app": name, "title": title, "url": url}


if __name__ == "__main__":
    main()
