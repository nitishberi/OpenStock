# Vendoring CPython + Scrapling into AutoDayTrader.app

Mac mini packaging embeds a standalone CPython (arm64) and the Scrapling worker under `Contents/Resources`.

## Layout

```
AutoDayTrader.app/Contents/Resources/
  node/                 # Node 22 arm64 runtime
  app/                  # compiled Hono server + Vite dist
  python/               # standalone CPython arm64 (python.org or python-build-standalone)
    bin/python3
    lib/...
  scrapling-worker/     # copy of services/scrapling-worker + venv site-packages
    main.py
    openinsider.py
    sources.yaml
    requirements.txt
```

## Steps (run by `scripts/macos/vendor-runtimes.sh`)

1. Download Node 22 **darwin-arm64** tarball into `Resources/node`.
2. Download python-build-standalone (or python.org macOS installer extract) arm64 into `Resources/python`.
3. Create a venv with that interpreter, `pip install -r services/scrapling-worker/requirements.txt`.
4. Copy worker sources + venv `site-packages` (or the whole venv) into `Resources/scrapling-worker`.
5. Set `APP_TOKEN` / `SCRAPLING_WORKER_TOKEN` at runtime from Keychain (never bake secrets into the bundle).

## Runtime interface

The Hono host spawns:

```bash
Resources/python/bin/python3 -m uvicorn main:app --host 127.0.0.1 --port 8091
```

with cwd `Resources/scrapling-worker`, env:

- `APP_TOKEN` — shared worker token (required in production)
- `WEB_INGEST_URL` / `WEB_INSIDER_INGEST_URL` — `http://127.0.0.1:8787/api/...`

URL allowlists stay in `sources.yaml` (bundled). Worker binds localhost only.
