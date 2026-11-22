#!/bin/sh
# Render every SVG in docs/art/src/ to PNG with headless Chrome. No network, system fonts only.
# Usage (from the repo root): sh docs/art/render.sh [name ...]   e.g. sh docs/art/render.sh icon
set -e
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
# name:width:height:output (output is relative to docs/art/)
JOBS="
icon:512:512:../../app/assets/icon.png
hero-dark:1600:900:../../app/assets/hero-dark.png
hero-light:1600:900:../../app/assets/hero-light.png
hero-detail-dark:2400:576:../../app/assets/hero-detail-dark.png
hero-detail-light:2400:576:../../app/assets/hero-detail-light.png
devpost-thumbnail:1500:1000:devpost-thumbnail.png
cover:1920:1080:cover-1920x1080.png
social:1200:630:social-1200x630.png
"
BANNER=$(python3 pixel-banner.py)
for job in $JOBS; do
  name=${job%%:*}; rest=${job#*:}; w=${rest%%:*}; rest=${rest#*:}; h=${rest%%:*}; out=${rest#*:}
  if [ $# -gt 0 ] && ! echo " $* " | grep -q " $name "; then continue; fi
  # d="BANNER" in a source is filled with the pixel banner path from pixel-banner.py.
  tmp="$PWD/src/.$name.render.svg"
  sed "s|d=\"BANNER\"|d=\"$BANNER\"|" "src/$name.svg" > "$tmp"
  # --no-sandbox: only local, hand-written SVGs are opened; some shells refuse Chrome's sandbox.
  "$CHROME" --headless --no-sandbox --disable-gpu --user-data-dir="${TMPDIR:-/tmp}/gy-art-chrome" \
    --hide-scrollbars --no-first-run --no-default-browser-check \
    --default-background-color=00000000 --force-device-scale-factor=1 \
    --window-size="$w,$h" --screenshot="$PWD/$out" "file://$tmp" 2>/dev/null
  rm -f "$tmp"
  echo "$out ${w}x${h}"
done
