#!/usr/bin/env bash
# Download/vendor Node 22 arm64 + CPython aarch64 + Scrapling worker deps.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="${ROOT}/dist/macos/vendor"
NODE_VERSION="${NODE_VERSION:-22.14.0}"
ARCH="${ARCH:-arm64}"
# python-build-standalone release (override with PBS_TAG / PBS_VERSION if needed)
PBS_TAG="${PBS_TAG:-20261009}"
PBS_VERSION="${PBS_VERSION:-3.12.15}"

mkdir -p "${DIST}/node" "${DIST}/python"

echo "==> Vendoring Node ${NODE_VERSION} darwin-${ARCH}"
NODE_TGZ="node-v${NODE_VERSION}-darwin-${ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TGZ}"
TMP="$(mktemp -d)"
curl -fsSL "${NODE_URL}" -o "${TMP}/${NODE_TGZ}"
tar -xzf "${TMP}/${NODE_TGZ}" -C "${TMP}"
rsync -a --delete "${TMP}/node-v${NODE_VERSION}-darwin-${ARCH}/" "${DIST}/node/"
rm -rf "${TMP}"
echo "    Node at ${DIST}/node/bin/node"

echo "==> Vendoring CPython ${PBS_VERSION} aarch64-apple-darwin (python-build-standalone ${PBS_TAG})"
PY_TGZ="cpython-${PBS_VERSION}+${PBS_TAG}-aarch64-apple-darwin-install_only.tar.gz"
PY_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${PY_TGZ}"
TMP="$(mktemp -d)"
curl -fsSL "${PY_URL}" -o "${TMP}/${PY_TGZ}"
tar -xzf "${TMP}/${PY_TGZ}" -C "${TMP}"
# install_only tarball extracts to "python/"
if [[ -d "${TMP}/python" ]]; then
  rsync -a --delete "${TMP}/python/" "${DIST}/python/"
else
  # fallback: single top-level dir
  top="$(find "${TMP}" -mindepth 1 -maxdepth 1 -type d | head -1)"
  rsync -a --delete "${top}/" "${DIST}/python/"
fi
rm -rf "${TMP}"

PYBIN="${DIST}/python/bin/python3"
if [[ ! -x "${PYBIN}" ]]; then
  echo "ERROR: expected ${PYBIN} after extract" >&2
  ls -la "${DIST}/python" >&2 || true
  exit 1
fi
echo "    Python at ${PYBIN} ($("${PYBIN}" -V))"

echo "==> Installing Scrapling worker requirements into vendored CPython"
"${PYBIN}" -m ensurepip --upgrade 2>/dev/null || true
"${PYBIN}" -m pip install --upgrade pip
"${PYBIN}" -m pip install -r "${ROOT}/services/scrapling-worker/requirements.txt"

echo "==> Verifying scrapling import"
"${PYBIN}" -c "import scrapling, fastapi, uvicorn; print('scrapling_ok', getattr(scrapling, '__version__', 'unknown'))"

# Keep a short note for humans inspecting the vendor tree
cat > "${DIST}/python/VENDOR_NOTE.md" <<EOF
# Vendored CPython (python-build-standalone)

- Release: ${PBS_TAG}
- Build: cpython-${PBS_VERSION}+${PBS_TAG}-aarch64-apple-darwin-install_only
- Scrapling + worker requirements installed into this interpreter's site-packages
- Worker sources are copied separately by assemble-app.sh into Resources/scrapling-worker
EOF

echo "==> Done. Run assemble-app.sh next."
