# Store the Library on the server, not in the browser

The Library is served by a small local Node server: Book files live in a folder on disk, and metadata and Reading positions live in a SQLite file. We rejected browser-only storage (IndexedDB) because the app will be reached from a phone over Tailscale, and per-browser storage would give each device its own separate Library and Reading position. The cost is that the app is no longer a pure static page: it needs a running process.
