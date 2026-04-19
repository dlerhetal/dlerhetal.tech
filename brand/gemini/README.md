# dlerhetal.tech brand kit — Gemini track

Gemini-authored visual identity, run through the production pipeline. The mark, render direction, and palette decisions are Gemini's; the SVG vectorization, raster exports, favicons, social cards, and tokens are mechanical conversions of that source.

**Source:** `brand/reference/VisualIdentityGuide.jpg`
**View the brand book in a browser:** `/brand/gemini/index.html` (or https://dlerhetal.tech/brand/gemini/ once deployed).

> Sibling kit at `/brand/claude/` is the Claude-authored alternative. Side-by-side comparison at `/brand/index.html`.

## What's here

```
brand/gemini/
  index.html              interactive brand book
  tokens.json             design tokens (machine-readable)
  brand.css               CSS custom properties (drop-in)
  build.py                regenerates raster + composite assets from sources
  extract.py              pulls Gemini's marks out of VisualIdentityGuide.jpg
  README.md               this file

  logo/
    logo-primary.svg      navy mark on stone (vectorized from Gemini's 2D mark)
    logo-reversed.svg     stone on navy
    logo-lava.svg         lava-accent variant
    logo-mono-navy.svg    navy, transparent
    logo-mono-stone.svg   stone, transparent
    logo-wordmark.svg     mark + dlerhetal.tech wordmark
    logo-*-{512,1024,2048}.png       raster exports
    logo-wordmark-{480,960,1920}.png

    logo-3d-hero-stone-{512,1024,2048}.png        Gemini's 3D mark on its native stone bg (recommended)
    logo-3d-hero-transparent-{512,1024,2048}.png  same mark, alpha-cut (best-effort)

  favicon/
    favicon.ico                multi-size 16/32/48
    favicon-source.svg         modern SVG favicon (navy bg, stone d)
    favicon-source-light.svg   light variant (stone bg, navy d)
    favicon-{16,32,48}.png
    apple-touch-icon.png       180x180
    icon-192.png               PWA icon
    icon-512.png               PWA icon
    site.webmanifest           PWA manifest

  social/
    og-card.png                1200x630, Open Graph / Twitter card
    avatar-512.png             square avatar (GitHub etc.)

  _raw/
    extracted JPG crops + intermediate working files (kept for re-tracing)
```

## Iteration status

This is **iteration 1**. Open issues:

- 2D `d` mark: traced from a low-res JPG. Bowl proportions and ascender position are approximate; expect to refine.
- Transparent 3D hero: best-effort alpha cut from the JPG. Stone-bg version is the clean fallback.

## Palette

Identical to the Claude track — the brand colors are shared, only the mark execution differs.

| Token | Hex | Role |
|---|---|---|
| navy | `#1A3C6E` | primary — nav, headings, mark |
| lava | `#CF2A27` | accent — links, live status |
| stone | `#E6E9EE` | base page background |
| olive | `#556B2F` | section labels, rules |
| surface | `#F2F4F7` | cards, panels |

## Using the Gemini track in a page

```html
<link rel="stylesheet" href="/brand/gemini/brand.css">
<link rel="icon" type="image/svg+xml" href="/brand/gemini/favicon/favicon-source.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/gemini/favicon/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/brand/gemini/favicon/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/brand/gemini/favicon/apple-touch-icon.png">
<link rel="manifest" href="/brand/gemini/favicon/site.webmanifest">
<meta name="theme-color" content="#1A3C6E">
<meta property="og:image" content="https://dlerhetal.tech/brand/gemini/social/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
```

## Regenerating

```
cd brand/gemini
python extract.py    # only after editing crop boxes
python build.py      # PNGs, ICO, social, 3D hero composites
```

Requires Python 3 with `cairosvg`, `Pillow`, `numpy`, `scipy`.

## Credits

Identity direction, 3D render, mark concept: **Gemini** (`brand/reference/VisualIdentityGuide.jpg`).
SVG vectorization, raster pipeline, favicons, social cards, build/extract scripts: Claude Code.
