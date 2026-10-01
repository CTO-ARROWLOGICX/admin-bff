#!/usr/bin/env bash
# Re-vendor @zafabit/service-kit into vendor/service-kit from the canonical repo.
#   ./scripts/vendor-service-kit.sh [git-ref]        (default: latest tag)
set -euo pipefail
REF="${1:-}"
REPO="git@github.com:CTO-ARROWLOGICX/zafabit-service-kit.git"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/service-kit"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone --quiet "$REPO" "$TMP"
if [ -z "$REF" ]; then REF="$(git -C "$TMP" describe --tags --abbrev=0 2>/dev/null || echo main)"; fi
git -C "$TMP" checkout --quiet "$REF"

mkdir -p "$DEST"
rsync -a --delete --exclude node_modules --exclude test --exclude jest.config.js \
  --exclude .git --exclude README.md "$TMP/src" "$TMP/package.json" "$DEST/"
cat > "$DEST/VENDORED.md" <<EOF
# Vendored copy of @zafabit/service-kit — do not edit here.
Source: https://github.com/CTO-ARROWLOGICX/zafabit-service-kit
Re-sync: ./scripts/vendor-service-kit.sh
Ref: $REF
EOF
echo "vendored @zafabit/service-kit @ $REF -> vendor/service-kit"
echo "next: npm ci && npm test && git commit -am 'chore: bump service-kit to $REF'"
