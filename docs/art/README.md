# Art

Original art for Graveyard BBS: hand-written SVG in `src/`, rendered to PNG by headless Chrome.
No external fonts, images or network: text uses the system monospace (Menlo) and Apple Color
Emoji; the "GRAVEYARD BBS" banner is drawn as pixel blocks by `pixel-banner.py`.
No third-party logos. "Built with Kiro" appears as plain words only.

Re-render everything (from the repo root):

```bash
sh docs/art/render.sh            # or name some: sh docs/art/render.sh icon cover
```

`render.sh` fills `d="BANNER"` in each source with the path from `pixel-banner.py`, then runs
Chrome with `--headless --screenshot --window-size=W,H`. Check sizes with
`sips -g pixelWidth -g pixelHeight <file>`.

| File | Size | Source | Use |
|---|---|---|---|
| `app/assets/icon.png` | 512x512 | `src/icon.svg` | Kiro Crew app icon (tombstone CRT with the orange cursor) |
| `app/assets/hero-dark.png` | 1600x900 | `src/hero-dark.svg` | App Store card, dark theme (`heroImageDark`) |
| `app/assets/hero-light.png` | 1600x900 | `src/hero-light.svg` | App Store card, light theme (`heroImage`) |
| `app/assets/hero-detail-dark.png` | 2400x576 | `src/hero-detail-dark.svg` | App detail page banner, dark (`heroImageDetailDark`) |
| `app/assets/hero-detail-light.png` | 2400x576 | `src/hero-detail-light.svg` | App detail page banner, light (`heroImageDetail`) |
| `docs/art/devpost-thumbnail.png` | 1500x1000 | `src/devpost-thumbnail.svg` | Devpost project thumbnail (3:2) |
| `docs/art/cover-1920x1080.png` | 1920x1080 | `src/cover.svg` | Devpost gallery image and video opening frame |
| `docs/art/social-1200x630.png` | 1200x630 | `src/social.svg` | Social Blitz post card |

Every PNG is under 1 MB.
