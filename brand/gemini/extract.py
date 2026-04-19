"""Extract Gemini's marks from VisualIdentityGuide.jpg with refined zones,
then process: trim background to transparency where useful, and write
cleaned PNGs into ./_raw/ for the build step to consume.
"""
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage

ROOT = Path(__file__).parent
SRC = ROOT.parent / "reference" / "VisualIdentityGuide.jpg"
RAW = ROOT / "_raw"
RAW.mkdir(exist_ok=True)


def near(arr, target, tol):
    return np.abs(arr.astype(int) - np.array(target)).max(axis=2) < tol


def find_mark(arr, search_box, mask, dilate_px=10, min_blob=200):
    x0, y0, x1, y1 = search_box
    sub = mask[y0:y1, x0:x1].astype(np.uint8)
    dilated = ndimage.binary_dilation(sub, iterations=dilate_px)
    labeled, n = ndimage.label(dilated)
    if n == 0:
        return None
    sizes = np.bincount(labeled.flat)
    sizes[0] = 0
    largest = int(sizes.argmax())
    if sizes[largest] < min_blob:
        return None
    blob_mask = (labeled == largest) & sub.astype(bool)
    ys, xs = np.where(blob_mask)
    return (
        x0 + int(xs.min()),
        y0 + int(ys.min()),
        x0 + int(xs.max()) + 1,
        y0 + int(ys.max()) + 1,
    )


def remove_stone_bg(img: Image.Image, stone_rgb=(205, 205, 200), tol=22):
    """Replace stone-ish background with transparency. Use a soft alpha
    based on color distance so antialiased edges blend naturally."""
    arr = np.array(img.convert("RGB"))
    diff = np.abs(arr.astype(int) - np.array(stone_rgb)).max(axis=2)
    # Alpha: 0 where exactly background, ramp up to 255 by tol*2
    alpha = np.clip((diff - tol) * 255 / tol, 0, 255).astype(np.uint8)
    rgba = np.dstack([arr, alpha])
    return Image.fromarray(rgba, mode="RGBA")


def main():
    img = Image.open(SRC).convert("RGB")
    arr = np.array(img)

    # Use "not stone" / "not navy" as the mask criterion — this catches all
    # mark pixels including antialiased edges that a tight navy-color match
    # would miss.
    stone_bg = near(arr, [205, 205, 200], 18)
    navy_bg  = near(arr, [2, 37, 77], 50)

    navy_mark   = near(arr, [25, 60, 110], 60)
    orange_mark = near(arr, [225, 90, 30], 70)
    # On the stone panels, everything that isn't stone is mark
    not_stone = ~stone_bg
    # For reversed: use a wider stone-color tolerance to catch antialiased edges
    stone_on_navy = near(arr, [195, 195, 190], 55)
    # 3D combined
    mark_3d = navy_mark | orange_mark
    # For 2D positive: use not_stone so antialiased edges are included
    navy_mark_positive = not_stone

    # Refined zones — pushed y_min up to catch tops of ascenders
    zones = [
        ("3d-primary",  (130, 200, 490, 470), mark_3d, 12),
        ("2d-positive", (700, 60,  1020, 320),  navy_mark_positive, 14),
        ("2d-reversed", (1060, 60, 1330, 330), stone_on_navy, 14),
        ("spec-mark",   (970, 460, 1175, 670), navy_mark, 14),
    ]

    for name, zone, mask, dilate in zones:
        bbox = find_mark(arr, zone, mask, dilate_px=dilate)
        if bbox is None:
            print(f"  {name}: NOT FOUND in {zone}")
            continue
        # Pad generously — the mark's outer ring antialiasing can extend
        # beyond the detected bbox, so give it room.
        pad = 24
        bbox = (
            max(0, bbox[0] - pad),
            max(0, bbox[1] - pad),
            min(img.size[0], bbox[2] + pad),
            min(img.size[1], bbox[3] + pad),
        )
        crop = img.crop(bbox)
        crop.save(RAW / f"final-{name}.png")
        print(f"  {name}: bbox={bbox} size={crop.size}")

    # Build transparent versions of 3d-primary and spec-mark (stone backgrounds)
    for name in ("3d-primary", "spec-mark"):
        src_path = RAW / f"final-{name}.png"
        if not src_path.exists():
            continue
        rgba = remove_stone_bg(Image.open(src_path))
        out = RAW / f"final-{name}-transparent.png"
        rgba.save(out, "PNG")
        print(f"  wrote {out.name}  (background -> alpha)")


if __name__ == "__main__":
    main()
