#!/usr/bin/env python3
"""Regenerate all AutoTax icons from the single SVG source of truth.

Run from the repository root:
    python -m pip install "cairosvg==2.8.2" "pillow==12.3.0"
    python scripts/build-autotax-icons.py
Do not hand-edit the derived PNG / ICO files.
"""
from __future__ import annotations

from io import BytesIO
from pathlib import Path
from PIL import Image
import cairosvg

ROOT = Path(__file__).resolve().parents[1]
ICONS = ROOT / "autotax" / "icons"
DOCS = ROOT / "docs"
MASTER = ICONS / "icon.svg"
SVG = MASTER.read_bytes()
assert b"<svg" in SVG and b"viewBox=\"0 0 512 512\"" in SVG, "Expected AutoTax SVG master"

# Oversample so downscaled 16px / 32px Chrome icons remain crisp.
image = Image.open(BytesIO(cairosvg.svg2png(
    bytestring=SVG, output_width=1024, output_height=1024))).convert("RGBA")

def resized(size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)

for size in (16, 24, 32, 48, 64, 128, 256):
    resized(size).save(ICONS / f"icon-{size}.png", format="PNG", optimize=True)

(DOCS / "favicon.svg").write_bytes(SVG)
resized(180).save(DOCS / "apple-touch-icon.png", format="PNG", optimize=True)
# ICO holds several resolutions, preserving crisp results on legacy browsers.
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
resized(256).save(ICONS / "favicon.ico", format="ICO", sizes=ico_sizes)
resized(256).save(DOCS / "favicon.ico", format="ICO", sizes=ico_sizes)
print("AutoTax icons regenerated: seven extension PNGs, two ICOs, SVG and Apple touch icon")
