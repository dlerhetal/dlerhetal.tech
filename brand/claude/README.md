# dlerhetal.tech brand kit

Everything the site needs to look like itself: mark, palette, type, favicons, social cards, tokens.

**View the brand book in a browser:** open `/brand/claude/index.html` (or https://dlerhetal.tech/brand/claude/ once deployed).

## What's here

```
brand/
  index.html              interactive brand book (view this first)
  tokens.json             design tokens (machine-readable)
  brand.css               CSS custom properties (drop-in)
  build.py                regenerates all raster assets from SVG sources
  README.md               this file

  logo/
    logo-primary.svg      navy mark on stone  (primary)
    logo-reversed.svg     stone mark on navy  (dark backgrounds)
    logo-lava.svg         lava-accent ring + navy d  (hero only)
    logo-mono-navy.svg    navy, transparent
    logo-mono-stone.svg   stone, transparent
    logo-wordmark.svg     mark + "dlerhetal.tech" wordmark
    logo-*-{512,1024,2048}.png   raster exports
    logo-wordmark-{480,960,1920}.png

  favicon/
    favicon.ico           multi-size 16/32/48 (for legacy browsers)
    favicon-source.svg    modern SVG favicon (navy bg, stone d)
    favicon-source-light.svg   light variant (stone bg, navy d)
    favicon-{16,32,48}.png
    apple-touch-icon.png  180x180
    icon-192.png          PWA icon
    icon-512.png          PWA icon
    site.webmanifest      PWA manifest

  social/
    og-card.png           1200x630, Open Graph / Twitter card
    avatar-512.png        square avatar (GitHub, etc.)

  reference/
    VisualIdentityGuide.jpg   original Gemini-generated identity guide
```

## Palette

| Token | Hex | Role |
|---|---|---|
| navy | `#1A3C6E` | primary — nav, headings, mark |
| lava | `#CF2A27` | accent — links, live status |
| stone | `#E6E9EE` | base page background |
| olive | `#556B2F` | section labels, rules |
| surface | `#F2F4F7` | cards, panels |
| navy-dark | `#0F2748` | navy hover |
| lava-dark | `#A11F1C` | lava hover |
| text | `#14213D` | body copy |
| muted | `#5B6777` | captions, metadata |

Full tokens (typography, spacing, radii) in `tokens.json`. CSS ready-to-use in `brand.css`.

## Using the brand in a page

```html
<link rel="stylesheet" href="/brand/claude/brand.css">
<link rel="icon" type="image/svg+xml" href="/brand/claude/favicon/favicon-source.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/brand/claude/favicon/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/brand/claude/favicon/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/brand/claude/favicon/apple-touch-icon.png">
<link rel="manifest" href="/brand/claude/favicon/site.webmanifest">
<meta name="theme-color" content="#1A3C6E">
<meta property="og:image" content="https://dlerhetal.tech/brand/claude/social/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
```

After `brand.css` is loaded, CSS variables are available:

```css
.card {
  background: var(--surface);
  border-left: 4px solid var(--navy);
  color: var(--text);
}
.card a { color: var(--lava); }
.card .label { color: var(--olive); letter-spacing: var(--tracking-label); }
```

## Regenerating rasters

All PNGs, ICOs, and social cards are derived from the source SVGs. To regenerate after editing an SVG:

```
cd brand
python build.py
```

Requires Python 3 with `cairosvg` and `Pillow` installed (`pip install cairosvg pillow`). The Cairo DLL ships with `cairocffi` on Windows, no system install needed.

## Logo geometry

The mark is built from three primitives on a 128 viewBox:

- Outer ring: `circle(64,64,r=54)` stroke 10
- Inner bowl: `circle(52,74,r=22)` stroke 10
- Ascender: `line(74,30)→(74,74)` stroke 10 round cap

Ascender's bottom sits exactly on the right edge of the bowl circle (tangent point), so the two shapes join cleanly to read as a lowercase `d`.

Favicon variant uses a softer 12px-radius rounded-square navy background with the same geometry at smaller stroke weight — readable at 16px.

## Voice

Working shop. Hands-on, snarky, direct. Not pastel, not magazine, not corporate. Lava sparingly, olive for the "working site" feel, navy to anchor, stone to breathe.

## Credits

Primary 3D render and identity direction: Gemini (see `reference/VisualIdentityGuide.jpg`).  
Vector marks, tokens, favicons, social cards, build system: Claude Code.
