"""Render Gemini brand rasters from SVG sources and extracted 3D mark.

Outputs:
  logo/logo-{primary,reversed,lava,mono-navy,mono-stone}-{512,1024,2048}.png
  logo/logo-wordmark-{480,960,1920}.png
  logo/logo-3d-hero-{512,1024,2048}.png   (from extracted Gemini 3D mark)
  favicon/favicon-{16,32,48}.png + apple-touch-icon, icon-192/512, favicon.ico
  social/og-card.png (uses Gemini's 3D hero)
  social/avatar-512.png
"""
from pathlib import Path
import io
import cairosvg
from PIL import Image, ImageDraw, ImageFont
import numpy as np

ROOT = Path(__file__).parent
RAW = ROOT / "_raw"

NAVY = "#1A3C6E"
NAVY_RGB = (26, 60, 110)
LAVA = "#CF2A27"
STONE = "#E6E9EE"
STONE_RGB = (230, 233, 238)
SURFACE = "#F2F4F7"
OLIVE = "#556B2F"
TEXT = "#14213D"
MUTED = "#5B6777"


def svg_to_png(svg_path, out_path, size):
    cairosvg.svg2png(url=str(svg_path), write_to=str(out_path),
                     output_width=size, output_height=size)
    print(f"  {out_path.relative_to(ROOT)} ({size}x{size})")


def svg_to_png_wide(svg_path, out_path, width):
    cairosvg.svg2png(url=str(svg_path), write_to=str(out_path), output_width=width)
    print(f"  {out_path.relative_to(ROOT)} (w={width})")


def build_3d_hero():
    """Take Gemini's 3D mark, produce both a stone-backgrounded version
    (clean, no artifacts) and a transparent version (best-effort cutout).

    The transparent version uses morphological cleanup to remove the
    construction-grid line that bleeds into the top of the source crop.
    """
    src = RAW / "final-3d-primary.png"
    img = Image.open(src).convert("RGB")
    # Tighter crop: skip the top 14 px which catches the grid line.
    img = img.crop((0, 14, img.size[0], img.size[1]))
    arr = np.array(img)

    out_dir = ROOT / "logo"

    # --- Stone-bg version (clean, recommended for use on stone panels) ---
    for s in (512, 1024, 2048):
        canvas = Image.new("RGB", (s, s), (205, 205, 200))
        # Fit mark
        pad = int(s * 0.05)
        target = s - 2 * pad
        scale = target / max(img.size)
        new_size = (max(1, int(img.size[0] * scale)),
                    max(1, int(img.size[1] * scale)))
        scaled = img.resize(new_size, Image.LANCZOS)
        ox = (s - new_size[0]) // 2
        oy = (s - new_size[1]) // 2
        canvas.paste(scaled, (ox, oy))
        out = out_dir / f"logo-3d-hero-stone-{s}.png"
        canvas.save(out, "PNG", optimize=True)
        print(f"  {out.relative_to(ROOT)} ({s}x{s})")

    # --- Transparent version (best-effort) ---
    diff = np.abs(arr.astype(int) - np.array([205, 205, 200])).max(axis=2)
    alpha = np.clip((diff - 14) * 255 / 14, 0, 255).astype(np.uint8)
    # Suppress thin grid-line residue: mask out any single-pixel-wide stripes
    # by morphological opening on the alpha channel
    from scipy import ndimage as ndi
    alpha_mask = alpha > 30
    cleaned = ndi.binary_opening(alpha_mask, iterations=1)
    alpha = np.where(cleaned, alpha, 0).astype(np.uint8)
    rgba_arr = np.dstack([arr, alpha])
    rgba = Image.fromarray(rgba_arr, mode="RGBA")
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)
    for s in (512, 1024, 2048):
        pad = int(s * 0.08)
        target = s - 2 * pad
        scale = target / max(rgba.size)
        new_size = (max(1, int(rgba.size[0] * scale)),
                    max(1, int(rgba.size[1] * scale)))
        scaled = rgba.resize(new_size, Image.LANCZOS)
        canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        ox = (s - new_size[0]) // 2
        oy = (s - new_size[1]) // 2
        canvas.paste(scaled, (ox, oy), scaled)
        out = out_dir / f"logo-3d-hero-transparent-{s}.png"
        canvas.save(out, "PNG", optimize=True)
        print(f"  {out.relative_to(ROOT)} ({s}x{s})  transparent")


def build_favicon_ico():
    src = ROOT / "favicon" / "favicon-source.svg"
    sizes = [16, 32, 48]
    images = []
    for s in sizes:
        png_bytes = cairosvg.svg2png(url=str(src), output_width=s, output_height=s)
        images.append(Image.open(io.BytesIO(png_bytes)).convert("RGBA"))
    ico_path = ROOT / "favicon" / "favicon.ico"
    images[0].save(ico_path, format="ICO",
                   sizes=[(s, s) for s in sizes],
                   append_images=images[1:])
    print(f"  {ico_path.relative_to(ROOT)} (16/32/48)")


def build_og_card():
    """OG card features Gemini's 3D hero on the left navy block."""
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), STONE)
    draw = ImageDraw.Draw(img)
    # Left panel uses Gemini's native stone color so the mark blends
    GEMINI_STONE = (205, 205, 200)
    draw.rectangle([(0, 0), (480, H)], fill=GEMINI_STONE)
    draw.rectangle([(0, H - 12), (W, H)], fill=LAVA)
    draw.rectangle([(480, 0), (W, 6)], fill=OLIVE)
    # Vertical separator
    draw.rectangle([(478, 0), (482, H)], fill=NAVY)

    # Gemini 3D hero, native stone background (clean, no halo)
    hero_src = ROOT / "logo" / "logo-3d-hero-stone-1024.png"
    hero = Image.open(hero_src).convert("RGB")
    hero_size = 420
    scale = hero_size / max(hero.size)
    hero = hero.resize(
        (max(1, int(hero.size[0] * scale)), max(1, int(hero.size[1] * scale))),
        Image.LANCZOS,
    )
    hx = (480 - hero.size[0]) // 2
    hy = (H - hero.size[1]) // 2
    img.paste(hero, (hx, hy))

    try:
        title_f = ImageFont.truetype("segoeuib.ttf", 70)
        sub_f = ImageFont.truetype("segoeui.ttf", 30)
        label_f = ImageFont.truetype("segoeuib.ttf", 18)
    except OSError:
        title_f = sub_f = label_f = ImageFont.load_default()

    x = 540
    draw.text((x, 140), "TOOLS \u00b7 TUTORIALS \u00b7 FIELD NOTES", font=label_f, fill=OLIVE)
    title_left = "dlerhetal"; dot = "."; title_right = "tech"
    tw_l = draw.textlength(title_left, font=title_f)
    tw_d = draw.textlength(dot, font=title_f)
    draw.text((x, 190), title_left, font=title_f, fill=NAVY)
    draw.text((x + tw_l, 190), dot, font=title_f, fill=LAVA)
    draw.text((x + tw_l + tw_d, 190), title_right, font=title_f, fill=NAVY)
    draw.text(
        (x, 300),
        "Tools I'm building for small trade shops,\nand field notes on what breaks along the way.",
        font=sub_f, fill=TEXT,
    )
    draw.text((x, 470), "Dale Linn", font=label_f, fill=MUTED)

    out = ROOT / "social" / "og-card.png"
    img.save(out, "PNG", optimize=True)
    print(f"  {out.relative_to(ROOT)} ({W}x{H})")


def build_avatar():
    size = 512
    img = Image.new("RGB", (size, size), NAVY)
    mark = Image.open(ROOT / "logo" / "logo-mono-stone-1024.png").convert("RGBA")
    target = 360
    scale = target / max(mark.size)
    mark = mark.resize((int(mark.size[0] * scale), int(mark.size[1] * scale)),
                       Image.LANCZOS)
    ox = (size - mark.size[0]) // 2
    oy = (size - mark.size[1]) // 2
    img.paste(mark, (ox, oy), mark)
    out = ROOT / "social" / "avatar-512.png"
    img.save(out, "PNG", optimize=True)
    print(f"  {out.relative_to(ROOT)} ({size}x{size})")


def main():
    (ROOT / "social").mkdir(exist_ok=True)
    logo_dir = ROOT / "logo"
    fav_dir = ROOT / "favicon"

    print("Logo PNGs (from SVG):")
    for v in ("primary", "reversed", "lava", "mono-navy", "mono-stone"):
        for s in (512, 1024, 2048):
            svg_to_png(logo_dir / f"logo-{v}.svg",
                       logo_dir / f"logo-{v}-{s}.png", s)

    print("Wordmark:")
    for w in (480, 960, 1920):
        svg_to_png_wide(logo_dir / "logo-wordmark.svg",
                        logo_dir / f"logo-wordmark-{w}.png", w)

    print("3D hero (from Gemini's actual JPG):")
    build_3d_hero()

    print("Favicons:")
    fav_src = fav_dir / "favicon-source.svg"
    for s, name in [(16, "favicon-16.png"), (32, "favicon-32.png"),
                    (48, "favicon-48.png"), (180, "apple-touch-icon.png"),
                    (192, "icon-192.png"), (512, "icon-512.png")]:
        svg_to_png(fav_src, fav_dir / name, s)

    print("Favicon ICO:")
    build_favicon_ico()

    print("OG card:")
    build_og_card()

    print("Avatar:")
    build_avatar()

    print("\nDone.")


if __name__ == "__main__":
    main()
