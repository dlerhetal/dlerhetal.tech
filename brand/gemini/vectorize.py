"""Phase A of the free pipeline: take Gemini's 2D mark extracts and produce
professional SVG via VTracer, then fan out to all brand variants.

No hand-tracing. No guessing coordinates. The vectorizer does the vectorizer's job.

Inputs:  _raw/final-2d-positive.png          (navy d on Gemini's stone)
         _raw/final-2d-reversed.png          (stone d on Gemini's navy)

Outputs: logo/logo-primary.svg                 (navy on stone)
         logo/logo-reversed.svg                (stone on navy)
         logo/logo-lava.svg                    (recolored to lava for hero)
         logo/logo-mono-navy.svg               (transparent bg, navy)
         logo/logo-mono-stone.svg              (transparent bg, stone)
         logo/logo-wordmark.svg                (mark + dlerhetal.tech text)
         favicon/favicon-source.svg            (mark on rounded navy square)
         favicon/favicon-source-light.svg      (mark on rounded stone square)
"""
from pathlib import Path
import io
import re
import tempfile
import vtracer
from PIL import Image
import numpy as np

ROOT = Path(__file__).parent
RAW = ROOT / "_raw"
LOGO = ROOT / "logo"
FAV = ROOT / "favicon"

NAVY = "#1A3C6E"
LAVA = "#CF2A27"
STONE = "#E6E9EE"

# Gemini's actual rendered colors (not the token values)
GEMINI_NAVY = (2, 37, 77)
GEMINI_STONE = (205, 205, 200)


def tight_crop_and_upscale(src_path, factor=6, pad_ratio=0.10):
    """Tight-bbox the dark pixels, pad by pad_ratio of the bbox dimensions,
    then LANCZOS upscale by factor for cleaner vectorizer edges.
    Also flattens near-stone pixels to exact stone so VTracer binary mode
    produces a single clean foreground region."""
    img = Image.open(src_path).convert("RGB")
    arr = np.array(img)

    # Distance from GEMINI_STONE — anything far is foreground
    stone = np.array(GEMINI_STONE)
    diff = np.abs(arr.astype(int) - stone).max(axis=2)
    fg_mask = diff > 30  # foreground pixels (the navy mark)

    ys, xs = np.where(fg_mask)
    if len(xs) == 0:
        raise RuntimeError(f"no foreground found in {src_path}")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1

    bbox_w, bbox_h = x1 - x0, y1 - y0
    pad = int(max(bbox_w, bbox_h) * pad_ratio)
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(arr.shape[1], x1 + pad)
    y1 = min(arr.shape[0], y1 + pad)

    cropped = img.crop((x0, y0, x1, y1))

    # Flatten near-stone pixels to pure stone so binary vectorization is clean
    arr2 = np.array(cropped)
    diff2 = np.abs(arr2.astype(int) - stone).max(axis=2)
    mask2 = diff2 <= 30
    arr2[mask2] = stone
    flat = Image.fromarray(arr2)

    # Upscale
    w, h = flat.size
    up = flat.resize((w * factor, h * factor), Image.LANCZOS)
    tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    up.save(tmp.name, "PNG")
    return tmp.name, up.size


def upscale(src_path, factor=6):
    """Legacy shim for compatibility."""
    return tight_crop_and_upscale(src_path, factor=factor)


def vectorize_binary(src_path, out_path, hierarchical="cutout"):
    """Run VTracer in binary mode. Produces one path for the navy mark."""
    up_path, up_size = upscale(src_path, factor=6)
    vtracer.convert_image_to_svg_py(
        up_path,
        str(out_path),
        colormode="binary",
        hierarchical=hierarchical,
        mode="spline",
        filter_speckle=8,
        corner_threshold=60,
        length_threshold=4.0,
        max_iterations=10,
        splice_threshold=45,
        path_precision=3,
    )
    print(f"  vectorized {src_path.name} -> {out_path.name} (source upscaled to {up_size})")
    Path(up_path).unlink()


def _path_bbox(d):
    """Approximate bounding box of an SVG path by scanning all numeric pairs."""
    nums = re.findall(r'-?\d+\.?\d*', d)
    if len(nums) < 4:
        return None
    # SVG path commands mix absolute positions and relative deltas.
    # This is approximate but good enough for drop-small-shapes filtering.
    floats = [float(n) for n in nums]
    xs = floats[0::2]
    ys = floats[1::2]
    if not xs or not ys:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def _drop_tiny_paths(svg, min_extent_ratio=0.18):
    """Remove <path d='...'/> elements whose bbox extent is small relative
    to the canvas. Targets VTracer's JPG-artifact phantom shapes."""
    vb_match = re.search(r'viewBox="([\d.\- ]+)"', svg)
    w_match = re.search(r'width="(\d+)"', svg)
    h_match = re.search(r'height="(\d+)"', svg)
    if vb_match:
        vb = vb_match.group(1).split()
        canvas_w = float(vb[2]); canvas_h = float(vb[3])
    elif w_match and h_match:
        canvas_w = float(w_match.group(1)); canvas_h = float(h_match.group(1))
    else:
        return svg
    min_dim = min(canvas_w, canvas_h) * min_extent_ratio

    def keep(match):
        path_text = match.group(0)
        d_m = re.search(r'd="([^"]+)"', path_text)
        if not d_m:
            return path_text
        bbox = _path_bbox(d_m.group(1))
        if bbox is None:
            return path_text
        x0, y0, x1, y1 = bbox
        if max(x1 - x0, y1 - y0) < min_dim:
            return ""
        return path_text

    return re.sub(r'<path\s+[^/]+/>', keep, svg)


def read_and_recolor_svg(svg_path, fill_color, make_transparent_bg=True):
    """Read a VTracer SVG, strip tiny artifact paths & any background rect,
    recolor the foreground. Ensure a viewBox is present."""
    svg = svg_path.read_text(encoding="utf-8")
    svg = _drop_tiny_paths(svg)

    if 'viewBox=' not in svg:
        w_match = re.search(r'width="(\d+)"', svg)
        h_match = re.search(r'height="(\d+)"', svg)
        if w_match and h_match:
            w, h = w_match.group(1), h_match.group(1)
            svg = re.sub(
                r'(<svg[^>]*?)(\s*width="\d+"\s+height="\d+")',
                rf'\1 viewBox="0 0 {w} {h}"\2',
                svg,
                count=1,
            )

    # VTracer emits paths with explicit `fill="#xxxxxx"`. Replace all fills
    # with the target color.
    # First, find the dominant foreground color (the darker one) — assume it's
    # anything that's not near-white.
    fills = set(re.findall(r'fill="(#[0-9a-fA-F]{6})"', svg))
    # Sort by luminance; the darker one is our mark color
    def lum(hx):
        r, g, b = int(hx[1:3], 16), int(hx[3:5], 16), int(hx[5:7], 16)
        return 0.299 * r + 0.587 * g + 0.114 * b
    fg_fills = sorted(fills, key=lum)
    if fg_fills:
        fg = fg_fills[0]
        svg = svg.replace(f'fill="{fg}"', f'fill="{fill_color}"')
        # Drop any other near-white background paths that VTracer sometimes emits
        if len(fg_fills) > 1:
            for bg in fg_fills[1:]:
                # Remove paths whose fill is the bg color
                svg = re.sub(
                    rf'<path [^>]*fill="{bg}"[^/]*/>',
                    "",
                    svg,
                )

    if make_transparent_bg:
        # Remove any <rect> that fills the whole canvas
        svg = re.sub(r'<rect[^/]*/>', "", svg)

    return svg


def write_svg(svg_content, out_path, bg_rect=None):
    """Optionally prepend a background rect for solid-bg variants."""
    if bg_rect:
        # Insert rect right after the opening <svg ...> tag
        svg_content = re.sub(
            r'(<svg[^>]*>)',
            rf'\1\n  <rect width="100%" height="100%" fill="{bg_rect}"/>',
            svg_content,
            count=1,
        )
    out_path.write_text(svg_content, encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)}")


def make_favicon_svg(mark_svg_content, out_path, bg_color, fg_color):
    """Produce a 64x64 rounded-square favicon with the VTracer mark scaled inside."""
    # Extract viewBox from the mark svg
    vb_match = re.search(r'viewBox="([\d.\- ]+)"', mark_svg_content)
    if not vb_match:
        raise RuntimeError("no viewBox in source svg")
    vb = vb_match.group(1).split()
    vx, vy, vw, vh = (float(x) for x in vb)

    # Recolor to fg
    inner = re.sub(r'fill="[^"]+"', f'fill="{fg_color}"', mark_svg_content)
    # Strip outer <svg> wrapper, keep just paths
    inner = re.sub(r'<\?xml[^>]*\?>', '', inner)
    inner = re.sub(r'<svg[^>]*>', '', inner)
    inner = re.sub(r'</svg>', '', inner)
    inner = re.sub(r'<rect[^/]*/>', '', inner).strip()

    # Compose: 64x64 canvas, rounded 12 bg rect, mark fitted to 44x44 centered
    target = 44
    pad = (64 - target) / 2
    scale = target / max(vw, vh)
    tx = pad + (target - vw * scale) / 2 - vx * scale
    ty = pad + (target - vh * scale) / 2 - vy * scale

    out = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <rect width="64" height="64" rx="12" fill="{bg_color}"/>
  <g transform="translate({tx:.3f} {ty:.3f}) scale({scale:.5f})">
    {inner}
  </g>
</svg>
"""
    out_path.write_text(out, encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)}")


def make_wordmark_svg(mark_svg_content, out_path):
    """Produce a 720x200 wordmark: mark left, 'dlerhetal.tech' right."""
    vb_match = re.search(r'viewBox="([\d.\- ]+)"', mark_svg_content)
    vb = vb_match.group(1).split()
    vx, vy, vw, vh = (float(x) for x in vb)

    inner = re.sub(r'fill="[^"]+"', f'fill="{NAVY}"', mark_svg_content)
    inner = re.sub(r'<\?xml[^>]*\?>', '', inner)
    inner = re.sub(r'<svg[^>]*>', '', inner)
    inner = re.sub(r'</svg>', '', inner)
    inner = re.sub(r'<rect[^/]*/>', '', inner).strip()

    target_h = 160
    scale = target_h / vh
    mark_w = vw * scale
    # Place mark at y=20, x=20 so it's inside a 200-tall, 20-padded canvas
    tx = 20 - vx * scale
    ty = 20 - vy * scale

    text_x = 20 + mark_w + 30  # 30px gap between mark and text

    out = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 200" width="720" height="200">
  <g transform="translate({tx:.3f} {ty:.3f}) scale({scale:.5f})">
    {inner}
  </g>
  <text x="{text_x:.1f}" y="130" font-family="Inter, 'Segoe UI', system-ui, sans-serif" font-size="80" font-weight="700" fill="{NAVY}" letter-spacing="-0.5">dlerhetal<tspan fill="{LAVA}">.</tspan>tech</text>
</svg>
"""
    out_path.write_text(out, encoding="utf-8")
    print(f"  wrote {out_path.relative_to(ROOT)}")


def main():
    print("VTracer phase A — vectorizing Gemini's 2D mark...")

    # Vectorize the positive (navy on stone) — this is the cleanest source
    raw_svg = LOGO / "_raw-vectorized.svg"
    vectorize_binary(RAW / "final-2d-positive.png", raw_svg)

    # Now fan out every variant from that single source SVG
    raw_content = raw_svg.read_text(encoding="utf-8")

    print("\nGenerating variants...")

    # Primary: navy mark on stone bg
    svg = read_and_recolor_svg(raw_svg, NAVY, make_transparent_bg=True)
    write_svg(svg, LOGO / "logo-primary.svg", bg_rect=STONE)

    # Reversed: stone mark on navy bg
    svg = read_and_recolor_svg(raw_svg, STONE, make_transparent_bg=True)
    write_svg(svg, LOGO / "logo-reversed.svg", bg_rect=NAVY)

    # Lava accent: lava mark on stone bg
    svg = read_and_recolor_svg(raw_svg, LAVA, make_transparent_bg=True)
    write_svg(svg, LOGO / "logo-lava.svg", bg_rect=STONE)

    # Mono navy: transparent, navy
    svg = read_and_recolor_svg(raw_svg, NAVY, make_transparent_bg=True)
    write_svg(svg, LOGO / "logo-mono-navy.svg")

    # Mono stone: transparent, stone
    svg = read_and_recolor_svg(raw_svg, STONE, make_transparent_bg=True)
    write_svg(svg, LOGO / "logo-mono-stone.svg")

    # Wordmark
    svg = read_and_recolor_svg(raw_svg, NAVY, make_transparent_bg=True)
    make_wordmark_svg(svg, LOGO / "logo-wordmark.svg")

    # Favicons
    svg = read_and_recolor_svg(raw_svg, NAVY, make_transparent_bg=True)
    make_favicon_svg(svg, FAV / "favicon-source.svg", bg_color=NAVY, fg_color=STONE)
    make_favicon_svg(svg, FAV / "favicon-source-light.svg", bg_color=STONE, fg_color=NAVY)

    # Leave the raw VTracer output for diffing, but rename so build.py doesn't glob it
    dst = LOGO / "_raw-vectorized.svg.keep"
    if dst.exists():
        dst.unlink()
    raw_svg.rename(dst)

    print("\nDone. Next: run build.py to regenerate rasters from the new SVGs.")


if __name__ == "__main__":
    main()
