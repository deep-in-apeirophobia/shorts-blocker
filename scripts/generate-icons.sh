#!/usr/bin/env bash
set -euo pipefail

# Run from any directory. Requires ImageMagick 7.
cd "$(dirname "$0")/.."
mkdir -p icons docs
for size in 16 32 48 64 96 128 256; do
  magick icon.png -resize "${size}x${size}" "icons/icon-${size}.png"
done
magick icon.png -resize 560x560 -background '#171917' -alpha remove -alpha off \
  -gravity center -extent 1280x640 docs/social-preview.png
