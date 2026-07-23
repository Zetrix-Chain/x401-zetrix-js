#!/usr/bin/env bash
# publish-all.sh — Build and publish the x401 npm packages to registry.npmjs.org
#
# Packages: x401-zetrix-server, x401-zetrix-client (both public, independent — no
# workspace deps between them, so publish order does not matter).
#
# Usage:
#   export NPM_TOKEN="npm_xxxxxxxx..."
#   bash scripts/publish-all.sh
#
# Optional:
#   bash scripts/publish-all.sh --dry-run            # simulate without uploading
#   bash scripts/publish-all.sh --package server     # server | client only

set -euo pipefail

DRY_RUN=0
PACKAGE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=1 ; shift ;;
    --package) PACKAGE="$2" ; shift 2 ;;
    *) echo "Unknown flag: $1" ; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo ""
  echo "ERROR: NPM_TOKEN is not set. Set it before running:"
  echo "  export NPM_TOKEN=\"npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\""
  echo ""
  echo "Get a token at: https://www.npmjs.com -> Account -> Access Tokens (Automation)"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Build (each package's prepublishOnly also runs build + coverage on publish)
# ---------------------------------------------------------------------------
echo ""
echo "==> Building all packages..."
pnpm build

# ---------------------------------------------------------------------------
# Publish helper
# ---------------------------------------------------------------------------
publish_pkg() {
  local name="$1"
  local dir="$2"
  echo ""
  echo "==> Publishing $name..."
  pushd "$REPO_ROOT/$dir" > /dev/null

  ARGS=(publish --access public --no-git-checks)
  [[ $DRY_RUN -eq 1 ]] && ARGS+=(--dry-run)

  pnpm "${ARGS[@]}"
  echo "  => $name OK"
  popd > /dev/null
}

DRY_LABEL=$([[ $DRY_RUN -eq 1 ]] && echo " (DRY RUN)" || echo "")
echo ""
echo "========================================"
echo "  x401-zetrix-js publish${DRY_LABEL}"
echo "========================================"

case "$PACKAGE" in
  server) publish_pkg 'x401-zetrix-server' 'packages/server' ;;
  client) publish_pkg 'x401-zetrix-client' 'packages/client' ;;
  "")
    publish_pkg 'x401-zetrix-client' 'packages/client'
    publish_pkg 'x401-zetrix-server' 'packages/server'
    ;;
  *) echo "Unknown package: $PACKAGE (use server | client)" ; exit 1 ;;
esac

echo ""
echo "==> Done${DRY_LABEL}"
