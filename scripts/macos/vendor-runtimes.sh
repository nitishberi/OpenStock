#!/usr/bin/env bash
# Download/vendor Node 22 arm64 + document Python/Scrapling placement.
# Actual Python download may require network on Mac mini.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="${ROOT}/dist/macos/vendor"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
ARCH="${ARCH:-arm64}"

mkdir -p "${DIST}/node" "${DIST}/python"

echo "==> Vendoring Node ${NODE_VERSION} darwin-${ARCH}"
NODE_TGZ="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TGZ}"
TMP="$(mktemp -d)"
curl -fsSL "${NODE_URL}" -o "${TMP}/${NODE_TGZ}"
tar -xzf "${TMP}/${NODE_TGZ}" -C "${TMP}"
rsync -a "${TMP}/node-v${NODE_VERSION}-darwin-${ARCH}/" "${DIST}/node/"
rm -rf "${TMP}"
echo "    Node at ${DIST}/node/bin/node"

cat > "${DIST}/python/README.md" <<'EOF'
# Embed CPython arm64 here

Preferred: [python-build-standalone](https://github.com/astral-sh/python-build-standalone) cpython-3.12.*-aarch64-apple-darwin-install_only.tar.gz

Extract so that `bin/python3` exists at this directory's `bin/python3`.

Then:

```bash
./bin/python3 -m venv /tmp/scrapling-venv
/tmp/scrapling-venv/bin/pip install -r ../../../../services/scrapling-worker/requirements.txt
# Copy site-packages or the venv into Resources/scrapling-worker as documented
```

See `apps/desktop/resources/PYTHON_VENDOR.md`.
EOF

echo "==> Python stub docs written to ${DIST}/python/README.md"
echo "==> Done. Run assemble-app.sh after this."
