"""Measure Gemini's d-mark geometry from the spec-mark crop.

Uses Hough circle detection (via skimage if available) plus pixel-density
scans to derive: outer ring center+radius+stroke, bowl center+radius+stroke,
and ascender x position + length + stroke.
"""
from pathlib import Path
from PIL import Image
import numpy as np
from scipy import ndimage

SRC = Path(__file__).parent / "_raw" / "final-spec-mark.png"


def main():
    img = Image.open(SRC).convert("RGB")
    arr = np.array(img)
    print(f"Spec mark crop: {img.size}  (w x h)")

    # Mask: navy mark pixels
    diff = np.abs(arr.astype(int) - np.array([25, 60, 110])).max(axis=2)
    mask = diff < 60
    print(f"  navy pixel count: {mask.sum()}")

    # Find tight bbox of mark
    ys, xs = np.where(mask)
    bbox = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    print(f"  mark bbox in crop: {bbox}  size={bbox[2]-bbox[0]}x{bbox[3]-bbox[1]}")

    # Per-row and per-column density to find ring structure
    cols = mask.sum(axis=0)
    rows = mask.sum(axis=1)

    # The outer ring is the biggest circular feature. Its center should be
    # the centroid of all mark pixels weighted equally.
    cx = float(xs.mean())
    cy = float(ys.mean())
    print(f"  centroid: ({cx:.1f}, {cy:.1f})")

    # Distance from centroid for each mark pixel
    dist = np.sqrt((xs - cx)**2 + (ys - cy)**2)
    # Histogram distances; outer ring forms one peak, bowl another
    hist, edges = np.histogram(dist, bins=80, range=(0, max(img.size)))
    print("  distance histogram (peaks indicate ring radii):")
    for i in range(len(hist)):
        if hist[i] > 30:
            print(f"    r={edges[i]:.0f}-{edges[i+1]:.0f}: {hist[i]} px")

    # Detect outer ring: scan along the centroid's horizontal & vertical
    # midlines for stroke transitions
    print(f"\n  Mid-row (y={int(cy)}) mask transitions:")
    row_mid = mask[int(cy)]
    transitions = np.where(np.diff(row_mid.astype(int)) != 0)[0]
    print(f"    edges at x = {transitions.tolist()}")

    print(f"  Mid-col (x={int(cx)}) mask transitions:")
    col_mid = mask[:, int(cx)]
    transitions = np.where(np.diff(col_mid.astype(int)) != 0)[0]
    print(f"    edges at y = {transitions.tolist()}")


if __name__ == "__main__":
    main()
