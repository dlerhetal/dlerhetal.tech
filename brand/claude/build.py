"""Regenerate all brand raster assets from the source SVGs.

Run: python build.py
Outputs:
  logo/logo-primary-{512,1024,2048}.png
  logo/logo-reversed-{512,1024,2048}.png
  logo/logo-lava-{512,1024,2048}.png
  logo/logo-wordmark-{512,1024}.png
  favicon/favicon-{16,32,48}.png
  favicon/apple-touch-icon.png          (180x180)
  favicon/icon-192.png, icon-512.png    (PWA)
  favicon/favicon.ico                   (multi-size 16/32/48)
  social/og-card.png                    (1200x630)
  social/avatar-512.png
"""
from pathlib import Path
import io
import cairosvg
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent

NAVY = "#1A3C6E"
NAVY_DARK = "#0F2748"
LAVA = "#CF2A27"
STONE = "#E6E9EE"
SURFACE = "#F2F4F7"
OLIVE = "#556B2F"
TEXT = "#14213D"
MUTED = "#5B6777"


def svg_to_png(svg_path: Path, out_path: Path, size: int) -> None:
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(out_path),
        output_width=size,
        output_height=size,
    )
    print(f"  wrote {out_path.relative_to(ROOT)} ({size}x{size})")


def svg_to_png_wide(svg_path: Path, out_path: Path, width: int) -> None:
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(out_path),
        output_width=width,
    )
    print(f"  wrote {out_path.relative_to(ROOT)} (w={width})")


def build_favicon_ico() -> None:
    src = ROOT / "favicon" / "favicon-source.svg"
    sizes = [16, 32, 48]
    images = []
    for s in sizes:
        png_bytes = cairosvg.svg2png(url=str(src), output_width=s, output_height=s)
        images.append(Image.open(io.BytesIO(png_bytes)).convert("RGBA"))
    ico_path = ROOT / "favicon" / "favicon.ico"
    images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )
    print(f"  wrote {ico_path.relative_to(ROOT)} (multi-size 16/32/48)")


def build_og_card() -> None:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), STONE)
    draw = ImageDraw.Draw(img)

    # Left navy block
    draw.rectangle([(0, 0), (420, H)], fill=NAVY)
    # Lava accent bar
    draw.rectangle([(0, H - 12), (W, H)], fill=LAVA)
    # Olive top rule
    draw.rectangle([(420, 0), (W, 6)], fill=OLIVE)

    # Logo in the navy block (reversed mark, 260px)
    logo_src = ROOT / "logo" / "logo-reversed.svg"
    logo_bytes = cairosvg.svg2png(
        url=str(logo_src), output_width=260, output_height=260
    )
    logo = Image.open(io.BytesIO(logo_bytes)).convert("RGBA")
    img.paste(logo, (80, (H - 260) // 2), logo)

    # Right side text
    try:
        title_font = ImageFont.truetype("segoeuib.ttf", 68)
        sub_font = ImageFont.truetype("segoeui.ttf", 32)
        label_font = ImageFont.truetype("segoeuib.ttf", 20)
    except OSError:
        title_font = ImageFont.load_default()
        sub_font = ImageFont.load_default()
        label_font = ImageFont.load_default()

    x = 480
    draw.text((x, 150), "TOOLS \u00b7 TUTORIALS \u00b7 FIELD NOTES",
              font=label_font, fill=OLIVE)
    # "dlerhetal.tech" with a lava dot
    title_left = "dlerhetal"
    dot = "."
    title_right = "tech"
    tw_left = draw.textlength(title_left, font=title_font)
    tw_dot = draw.textlength(dot, font=title_font)
    draw.text((x, 200), title_left, font=title_font, fill=NAVY)
    draw.text((x + tw_left, 200), dot, font=title_font, fill=LAVA)
    draw.text((x + tw_left + tw_dot, 200), title_right, font=title_font, fill=NAVY)

    draw.text(
        (x, 310),
        "Tools I'm building for small trade shops,\nand field notes on what breaks along the way.",
        font=sub_font, fill=TEXT,
    )
    draw.text((x, 470), "Dale Linn", font=label_font, fill=MUTED)

    out = ROOT / "social" / "og-card.png"
    img.save(out, "PNG", optimize=True)
    print(f"  wrote {out.relative_to(ROOT)} ({W}x{H})")


def build_avatar() -> None:
    size = 512
    img = Image.new("RGB", (size, size), NAVY)
    # Render reversed mark centered at 360px
    logo_src = ROOT / "logo" / "logo-mono-stone.svg"
    mark_size = 360
    mark_bytes = cairosvg.svg2png(
        url=str(logo_src), output_width=mark_size, output_height=mark_size
    )
    mark = Image.open(io.BytesIO(mark_bytes)).convert("RGBA")
    offset = ((size - mark_size) // 2, (size - mark_size) // 2)
    img.paste(mark, offset, mark)
    out = ROOT / "social" / "avatar-512.png"
    img.save(out, "PNG", optimize=True)
    print(f"  wrote {out.relative_to(ROOT)} ({size}x{size})")


def main() -> None:
    logo_dir = ROOT / "logo"
    fav_dir = ROOT / "favicon"
    social_dir = ROOT / "social"
    social_dir.mkdir(exist_ok=True)

    print("Rendering logo PNGs...")
    for variant in ["primary", "reversed", "lava", "mono-navy", "mono-stone"]:
        src = logo_dir / f"logo-{variant}.svg"
        for s in (512, 1024, 2048):
            svg_to_png(src, logo_dir / f"logo-{variant}-{s}.png", s)

    print("Rendering wordmark...")
    wordmark = logo_dir / "logo-wordmark.svg"
    for w in (480, 960, 1920):
        svg_to_png_wide(wordmark, logo_dir / f"logo-wordmark-{w}.png", w)

    print("Rendering favicon PNGs...")
    fav_src = fav_dir / "favicon-source.svg"
    for s in (16, 32, 48, 180, 192, 512):
        name = {
            180: "apple-touch-icon.png",
            192: "icon-192.png",
            512: "icon-512.png",
        }.get(s, f"favicon-{s}.png")
        svg_to_png(fav_src, fav_dir / name, s)

    print("Building favicon.ico (multi-size)...")
    build_favicon_ico()

    print("Building OG card...")
    build_og_card()

    print("Building social avatar...")
    build_avatar()

    print("\nDone.")


if __name__ == "__main__":
    main()
