#!/usr/bin/env python3
"""Validate dimensions, transparency, safe zones, and production metadata."""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[3]
BRAND = ROOT / "public" / "brand" / "everplate"
MASTERS = BRAND / "masters"
IN_APP = BRAND / "in-app"
STORE = BRAND / "store"
NATIVE = BRAND / "native"
REVIEW = ROOT / "tools" / "everplate-assets" / "review"


def check_png(relative: str, dimensions: tuple[int, int], alpha: bool | None = None) -> None:
    path = BRAND / relative
    if not path.exists():
        raise AssertionError(f"Missing {relative}")
    with Image.open(path) as image:
        if image.size != dimensions:
            raise AssertionError(f"{relative}: expected {dimensions}, got {image.size}")
        has_alpha = image.mode in ("RGBA", "LA") or "transparency" in image.info
        if alpha is not None and has_alpha != alpha:
            raise AssertionError(f"{relative}: expected alpha={alpha}, got {has_alpha}")


for svg in MASTERS.glob("*.svg"):
    ET.parse(svg)
    body = svg.read_text(encoding="utf-8")
    if "asset-status=production" not in body:
        raise AssertionError(f"{svg.name}: missing production metadata")
    if re.search(r"<text\b", body):
        raise AssertionError(f"{svg.name}: production SVG contains live text")

check_png("raster/monogram-green-4096.png", (4096, 4096), True)
check_png("raster/monogram-green-2048.png", (2048, 2048), True)
check_png("raster/monogram-green-1024.png", (1024, 1024), True)
check_png("masters/app-icon-ios-1024.png", (1024, 1024), False)
check_png("masters/app-icon-google-play-512.png", (512, 512), False)
check_png("masters/splash-light-2160x3840.png", (2160, 3840), False)
check_png("masters/splash-dark-2160x3840.png", (2160, 3840), False)
check_png("in-app/favicon-32.png", (32, 32), False)
check_png("in-app/pwa-icon-192.png", (192, 192), False)
check_png("in-app/pwa-icon-512.png", (512, 512), False)
check_png("in-app/pwa-maskable-512.png", (512, 512), False)
check_png("masters/hero-source-1536x1024.png", (1536, 1024), False)
check_png("store/app-store-promotional-source-4320x1080.png", (4320, 1080), False)
check_png("store/google-play-feature-1024x500.png", (1024, 500), False)
check_png("store/open-graph-1200x630.png", (1200, 630), False)
check_png("store/support-hero-2400x1350.png", (2400, 1350), False)
check_png("store/testflight-cover-1600x1200.png", (1600, 1200), False)

icon = Image.open(MASTERS / "app-icon-ios-1024.png").convert("RGB")
background = icon.getpixel((0, 0))
for point in ((0, 0), (1023, 0), (0, 1023), (1023, 1023)):
    if icon.getpixel(point) != background:
        raise AssertionError("iOS icon corners must be opaque and uniform")

catalog = NATIVE / "ios" / "AppIcon.appiconset"
contents = (catalog / "Contents.json").read_text(encoding="utf-8")
for pixels in (20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024):
    if not any(Image.open(path).size == (pixels, pixels) for path in catalog.glob("*.png")):
        raise AssertionError(f"iOS AppIcon catalog missing {pixels}px rendition")
if '"ios-marketing"' not in contents:
    raise AssertionError("iOS AppIcon catalog missing marketing icon")

for name in ("ic_launcher_foreground.xml", "ic_launcher_background.xml", "ic_launcher_monochrome.xml"):
    body = (NATIVE / "android" / name).read_text(encoding="utf-8")
    ET.parse(NATIVE / "android" / name)
    if "placeholder" in body.lower():
        raise AssertionError(f"{name} is still a placeholder")

expected_candidates = {"monogram": 3, "wordmark": 3, "app-icon": 3, "splash-light": 2, "splash-dark": 2, "hero": 2}
for group, count in expected_candidates.items():
    actual = len(list((REVIEW / "candidates" / group).glob("image_*.png")))
    if actual != count:
        raise AssertionError(f"{group}: expected {count} review candidates, found {actual}")

for placeholder in BRAND.glob("*placeholder*"):
    raise AssertionError(f"Unexpected placeholder remains: {placeholder.name}")

print("EverPlate asset validation passed")
