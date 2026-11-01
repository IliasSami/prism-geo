#!/usr/bin/env bash
# PrismGEO one-line install for macOS and Linux:
#   curl -fsSL https://raw.githubusercontent.com/IliasSami/prism-geo/main/install.sh | bash
# Clones (or updates) PrismGEO into ./prism-geo (or $PRISMGEO_DIR) and runs `pnpm bootstrap`.
set -euo pipefail

REPO="${PRISMGEO_REPO:-https://github.com/IliasSami/prism-geo.git}"
DIR="${PRISMGEO_DIR:-prism-geo}"

need() { command -v "$1" >/dev/null 2>&1; }
die() { printf '\n✖ %s\n' "$1" >&2; exit 1; }

need git || die "git is required. macOS: run 'xcode-select --install'. Linux: install git with your package manager."
need node || die "Node.js 22.13 or later is required. Install the LTS from https://nodejs.org (or 'brew install node'), then run this again."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node.js $(node -v) is too old: PrismGEO needs 22.13 or later (https://nodejs.org)."

if [ -d "$DIR/.git" ]; then
  printf '▸ Updating %s\n' "$DIR"
  git -C "$DIR" pull --ff-only
else
  printf '▸ Downloading PrismGEO into %s\n' "$DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"
node scripts/setup.mjs
printf '\nNext: cd %s && pnpm start   (no pnpm? use: npx pnpm@10.34.9 start)\n' "$DIR"
