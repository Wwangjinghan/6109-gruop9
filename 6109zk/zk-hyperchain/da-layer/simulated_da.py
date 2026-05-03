"""
Simulated Modular DA Layer
Mimics an external DA provider (Avail / Celestia style) for local dev.

Endpoints:
    POST /submit  { "data": "<hex>" }  → { "blob_id": "<sha256-hex>" }
    GET  /get/<blob_id>               → { "data": "<hex>" }
    GET  /health                      → { "status": "ok" }
"""

import hashlib
import json
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 7777
MAX_BLOBS = 10_000  # evict oldest when full


class BlobStore:
    def __init__(self, maxsize: int):
        self._store: OrderedDict[str, str] = OrderedDict()
        self._maxsize = maxsize

    def put(self, blob_id: str, data: str) -> None:
        if blob_id in self._store:
            return
        if len(self._store) >= self._maxsize:
            self._store.popitem(last=False)
        self._store[blob_id] = data

    def get(self, blob_id: str) -> str | None:
        return self._store.get(blob_id)

    def __len__(self) -> int:
        return len(self._store)


STORE = BlobStore(MAX_BLOBS)


class DAHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def _json(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "blobs_stored": len(STORE)})
            return
        if self.path.startswith("/get/"):
            data = STORE.get(self.path[5:])
            if data is not None:
                self._json(200, {"blob_id": self.path[5:], "data": data})
            else:
                self._json(404, {"error": "blob not found"})
            return
        self._json(404, {"error": "unknown route"})

    def do_POST(self):
        if self.path == "/submit":
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length))
                data_hex = body.get("data", "")
                raw = bytes.fromhex(data_hex)
            except (json.JSONDecodeError, ValueError) as e:
                self._json(400, {"error": f"invalid request: {e}"})
                return
            blob_id = hashlib.sha256(raw).hexdigest()
            STORE.put(blob_id, data_hex)
            print(f"[DA] stored {blob_id[:16]}… ({len(raw)} bytes)")
            self._json(200, {"blob_id": blob_id, "commitment": blob_id})
            return
        self._json(404, {"error": "unknown route"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), DAHandler)
    print(f"[DA] Simulated Modular DA layer on http://0.0.0.0:{PORT}")
    server.serve_forever()
