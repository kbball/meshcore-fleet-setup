#!/usr/bin/env python3
"""Serve this folder on http://localhost:8080 and open it in the browser. Needs only Python 3, no internet.

Web Serial only works on a secure origin; http://localhost counts as one (opening index.html as a file does not
load the firmware manifest).
"""
import functools
import http.server
import os
import sys
import threading
import webbrowser

PORT = int(os.environ.get("PORT", "8080"))
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".zip": "application/zip", ".json": "application/json"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    handler = functools.partial(Handler, directory=ROOT)
    try:
        server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError as e:
        sys.exit(f"cannot listen on port {PORT}: {e} (set PORT=... to use another)")
    url = f"http://localhost:{PORT}/"
    print(f"Fleet setup running at {url}  (Ctrl+C to stop). Use Chrome or Edge.")
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
