"""Make the rope-ring logo's baked-in checkerboard background truly transparent.

The source icon.png has an opaque gray/white checkerboard rendered as real pixels.
The rope is highly saturated orange; the checkerboard is grayscale (chroma ~= 0).
So we key on chroma = max(r,g,b) - min(r,g,b): high chroma -> keep (opaque),
near-zero -> drop (transparent), with a soft ramp for anti-aliased edges.

This script is intentionally reusable:
- as a CLI: `python scripts/make_icon_transparent.py SRC OUT...`
- as a helper imported by packaging scripts that need a cleaned source image.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable

from PIL import Image

LOW = 24    # chroma <= LOW  -> fully transparent (grayscale checkerboard)
HIGH = 64   # chroma >= HIGH -> fully opaque (saturated rope)
PAD = 8


def _apply_transparency_key(img: Image.Image) -> tuple[Image.Image, int]:
    out = img.convert('RGBA')
    px = out.load()
    w, h = out.size
    kept = 0

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            chroma = max(r, g, b) - min(r, g, b)
            if chroma <= LOW:
                na = 0
            elif chroma >= HIGH:
                na = 255
            else:
                na = int((chroma - LOW) * 255 / (HIGH - LOW))
            if na:
                kept += 1
            px[x, y] = (r, g, b, min(a, na))

    return out, kept


def _crop_to_content(img: Image.Image, pad: int = PAD) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    l, t, rr, bb = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    rr = min(img.width, rr + pad)
    bb = min(img.height, bb + pad)
    return img.crop((l, t, rr, bb))


def cleaned_icon(src: str | Path) -> tuple[Image.Image, int]:
    """Return the transparent, tightly cropped icon image and kept-pixel count."""
    img = Image.open(src)
    keyed, kept = _apply_transparency_key(img)
    return _crop_to_content(keyed), kept


def save_clean_icon(src: str | Path, outputs: Iterable[str | Path]) -> tuple[Image.Image, int]:
    """Generate and save the cleaned icon to one or more output paths."""
    img, kept = cleaned_icon(src)
    for out in outputs:
        path = Path(out)
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path)
    return img, kept


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print('usage: python scripts/make_icon_transparent.py SRC OUT...', file=sys.stderr)
        return 2

    src = argv[1]
    outs = argv[2:]
    img, kept = save_clean_icon(src, outs)
    print('size', img.size, 'kept_px', kept, '->', len(outs), 'files')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
