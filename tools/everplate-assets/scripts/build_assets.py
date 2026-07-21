#!/usr/bin/env python3
"""Build deterministic EverPlate vector masters and derived raster assets."""

from __future__ import annotations

import io
import json
import math
import shutil
from pathlib import Path

import cairosvg
import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / "tools" / "everplate-assets"
BRAND = ROOT / "public" / "brand" / "everplate"
MASTERS = BRAND / "masters"
RASTER = BRAND / "raster"
IN_APP = BRAND / "in-app"
STORE = BRAND / "store"
NATIVE_LIBRARY = BRAND / "native"
REVIEW = TOOLS / "review"
CANDIDATES = REVIEW / "candidates"
NATIVE_ROOT = ROOT / "native" / "everplate"
FONT_ROOT = ROOT / "native" / "everplate" / "node_modules" / "@fontsource"
LORA = FONT_ROOT / "lora" / "files" / "lora-latin-400-normal.woff2"

GREEN = "#274233"
GREEN_DARK = "#1B2E26"
DARKEST = "#0F1412"
CREAM = "#FAF7F0"
DARK_CREAM = "#FAF5F2"
BLACK = "#111413"
WHITE = "#FFFFFF"


def ensure_dirs() -> None:
    for directory in (BRAND, MASTERS, RASTER, IN_APP, STORE, NATIVE_LIBRARY, REVIEW):
        directory.mkdir(parents=True, exist_ok=True)


def font_context(font_path: Path):
    font = TTFont(font_path)
    font.flavor = None
    raw = io.BytesIO()
    font.save(raw)
    face = hb.Face(raw.getvalue())
    hb_font = hb.Font(face)
    upem = face.upem
    hb_font.scale = (upem, upem)
    return font, hb_font, upem


def shaped_path(text: str, font_path: Path, target_height: float, center_x: float, center_y: float) -> str:
    font, hb_font, upem = font_context(font_path)
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(hb_font, buffer, {"kern": True, "liga": True})
    glyph_set = font.getGlyphSet()
    order = font.getGlyphOrder()
    records = []
    cursor_x = 0
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        name = order[info.codepoint]
        records.append((name, cursor_x + position.x_offset, position.y_offset))
        cursor_x += position.x_advance

    bounds_pen = BoundsPen(glyph_set)
    cursor_x = 0
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        name = order[info.codepoint]
        pen = TransformPen(bounds_pen, (1, 0, 0, 1, cursor_x + position.x_offset, position.y_offset))
        glyph_set[name].draw(pen)
        cursor_x += position.x_advance
    if not bounds_pen.bounds:
        raise RuntimeError(f"Unable to determine bounds for {text!r}")
    x0, y0, x1, y1 = bounds_pen.bounds
    scale = target_height / (y1 - y0)
    rendered_w = (x1 - x0) * scale
    rendered_h = (y1 - y0) * scale
    tx = center_x - rendered_w / 2 - x0 * scale
    ty = center_y + rendered_h / 2 + y0 * scale

    chunks = []
    cursor_x = 0
    for info, position in zip(buffer.glyph_infos, buffer.glyph_positions):
        name = order[info.codepoint]
        pen = SVGPathPen(glyph_set)
        transform = TransformPen(
            pen,
            (
                scale,
                0,
                0,
                -scale,
                tx + (cursor_x + position.x_offset) * scale,
                ty - position.y_offset * scale,
            ),
        )
        glyph_set[name].draw(transform)
        chunks.append(pen.getCommands())
        cursor_x += position.x_advance
    return " ".join(chunks)


def svg_document(viewbox: tuple[int, int], body: str, title: str, desc: str) -> str:
    width, height = viewbox
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">
  <title id="title">{title}</title>
  <desc id="desc">{desc}</desc>
  <metadata>asset-status=production; source=deterministic-vector-reconstruction; reference=approved-everplate-guide; font=Lora-OFL-1.1</metadata>
  {body}
</svg>
'''


def write_svg(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")


def monogram_body(color: str) -> str:
    e_path = shaped_path("E", LORA, 470, 512, 500)
    return f'''<g fill="none" stroke="{color}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 705 282 A 294 294 0 1 0 735 706" stroke-width="15"/>
    <path d="M 370 653 C 447 731 591 746 696 663" stroke-width="13"/>
  </g>
  <path d="{e_path}" fill="{color}"/>'''


def wordmark_body(color: str, width: int = 1600, height: int = 420) -> str:
    path = shaped_path("EverPlate", LORA, 230, width / 2, height / 2)
    return f'<path d="{path}" fill="{color}"/>'


def lockup_body(color: str, stacked: bool) -> tuple[tuple[int, int], str]:
    if stacked:
        mark = monogram_body(color)
        word = shaped_path("EverPlate", LORA, 170, 600, 940)
        body = f'<g transform="translate(260 90) scale(.6640625)">{mark}</g>\n  <path d="{word}" fill="{color}"/>'
        return (1200, 1200), body
    mark = monogram_body(color)
    word = shaped_path("EverPlate", LORA, 250, 1320, 300)
    body = f'<g transform="translate(60 44) scale(.5)">{mark}</g>\n  <path d="{word}" fill="{color}"/>'
    return (2048, 600), body


def rasterize(svg_path: Path, out_path: Path, width: int, height: int | None = None) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cairosvg.svg2png(
        url=str(svg_path),
        write_to=str(out_path),
        output_width=width,
        output_height=height,
    )
    with Image.open(out_path) as image:
        image.load()
        image.save(out_path, format="PNG", optimize=True)


def monogram_layer(size: int, color: str, inset_ratio: float = 0.18) -> Image.Image:
    svg = svg_document((1024, 1024), monogram_body(color), "EverPlate monogram", "Circular E monogram.")
    raw = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    image = Image.open(io.BytesIO(raw)).convert("RGBA")
    if inset_ratio:
        target = round(size * (1 - inset_ratio * 2))
        image = image.resize((target, target), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.alpha_composite(image, ((size - target) // 2, (size - target) // 2))
        return canvas
    return image


def solid_icon(size: int, background: str, mark: str, mark_ratio: float = 0.64) -> Image.Image:
    canvas = Image.new("RGB", (size, size), background)
    mark_size = round(size * mark_ratio)
    layer = monogram_layer(mark_size, mark, inset_ratio=0)
    canvas.paste(layer, ((size - mark_size) // 2, (size - mark_size) // 2), layer)
    return canvas


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True)


def splash(size: tuple[int, int], background: str, mark: str, portrait_anchor: float = 0.43) -> Image.Image:
    width, height = size
    canvas = Image.new("RGB", size, background)
    mark_size = round(min(width, height) * (0.30 if height > width else 0.26))
    layer = monogram_layer(mark_size, mark, inset_ratio=0)
    center_y = round(height * portrait_anchor) if height > width else height // 2
    canvas.paste(layer, ((width - mark_size) // 2, center_y - mark_size // 2), layer)
    return canvas


def build_vectors() -> None:
    variants = {
        "monogram.svg": GREEN,
        "monogram-black.svg": BLACK,
        "monogram-white.svg": WHITE,
        "monogram-cream.svg": CREAM,
        "monochrome.svg": BLACK,
    }
    for name, color in variants.items():
        write_svg(MASTERS / name, svg_document((1024, 1024), monogram_body(color), "EverPlate monogram", "Production circular E monogram."))

    for name, color in {
        "wordmark.svg": GREEN,
        "wordmark-light.svg": CREAM,
        "wordmark-black.svg": BLACK,
        "wordmark-white.svg": WHITE,
    }.items():
        write_svg(MASTERS / name, svg_document((1600, 420), wordmark_body(color), "EverPlate wordmark", "Production EverPlate wordmark converted to vector paths."))

    for stacked in (False, True):
        for light in (False, True):
            color = CREAM if light else GREEN
            viewbox, body = lockup_body(color, stacked)
            suffix = "-light" if light else ""
            shape = "stacked" if stacked else "horizontal"
            write_svg(MASTERS / f"lockup-{shape}{suffix}.svg", svg_document(viewbox, body, "EverPlate logo lockup", f"Production {shape} monogram and wordmark lockup."))


def build_raster_masters() -> None:
    source = MASTERS / "monogram.svg"
    for size in (4096, 2048, 1024):
        rasterize(source, RASTER / f"monogram-green-{size}.png", size, size)
    for variant in ("black", "white", "cream"):
        rasterize(MASTERS / f"monogram-{variant}.svg", RASTER / f"monogram-{variant}-1024.png", 1024, 1024)
    rasterize(MASTERS / "wordmark.svg", RASTER / "wordmark-green-3200.png", 3200, 840)
    rasterize(MASTERS / "wordmark-light.svg", RASTER / "wordmark-light-3200.png", 3200, 840)
    rasterize(MASTERS / "lockup-horizontal.svg", RASTER / "lockup-horizontal-4096.png", 4096, 1200)
    rasterize(MASTERS / "lockup-horizontal-light.svg", RASTER / "lockup-horizontal-light-4096.png", 4096, 1200)
    rasterize(MASTERS / "lockup-stacked.svg", RASTER / "lockup-stacked-2400.png", 2400, 2400)


def build_context_assets() -> None:
    save_png(solid_icon(1024, GREEN, CREAM), MASTERS / "app-icon-ios-1024.png")
    save_png(solid_icon(512, GREEN, CREAM), MASTERS / "app-icon-google-play-512.png")
    for size, name in ((32, "favicon-32.png"), (64, "navigation-monogram-64.png"), (180, "apple-touch-icon-180.png"), (192, "pwa-icon-192.png"), (512, "pwa-icon-512.png")):
        save_png(solid_icon(size, GREEN, CREAM), IN_APP / name)
    save_png(solid_icon(512, GREEN, CREAM, 0.54), IN_APP / "pwa-maskable-512.png")
    save_png(monogram_layer(512, BLACK, inset_ratio=0.12), IN_APP / "pdf-monogram-grayscale-512.png")
    watermark = monogram_layer(512, GREEN, inset_ratio=0.12)
    watermark.putalpha(watermark.getchannel("A").point(lambda value: round(value * 0.16)))
    save_png(watermark, IN_APP / "empty-state-watermark-512.png")
    save_png(solid_icon(512, GREEN, CREAM), IN_APP / "share-preview-mark-512.png")
    rasterize(MASTERS / "lockup-horizontal.svg", IN_APP / "auth-lockup-1600.png", 1600, 469)
    rasterize(MASTERS / "lockup-stacked.svg", IN_APP / "onboarding-lockup-1200.png", 1200, 1200)

    notification = monogram_layer(96, WHITE, inset_ratio=0.1)
    save_png(notification, IN_APP / "android-notification-96.png")


def build_splashes() -> None:
    save_png(splash((2160, 3840), CREAM, GREEN), MASTERS / "splash-light-2160x3840.png")
    save_png(splash((2160, 3840), DARKEST, DARK_CREAM), MASTERS / "splash-dark-2160x3840.png")
    save_png(splash((2732, 2732), CREAM, GREEN, 0.5), MASTERS / "splash-light-2732.png")
    save_png(splash((2732, 2732), DARKEST, DARK_CREAM, 0.5), MASTERS / "splash-dark-2732.png")


def cover_crop(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    width, height = size
    scale = max(width / image.width, height / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def store_composition(hero: Image.Image, size: tuple[int, int], lockup_width_ratio: float = 0.36) -> Image.Image:
    canvas = cover_crop(hero, size).convert("RGBA")
    veil = Image.new("RGBA", size, (15, 20, 18, 0))
    veil_draw = ImageDraw.Draw(veil)
    veil_draw.rectangle((0, 0, round(size[0] * 0.58), size[1]), fill=(15, 20, 18, 132))
    canvas = Image.alpha_composite(canvas, veil)
    lockup_path = RASTER / "lockup-horizontal-light-4096.png"
    lockup = Image.open(lockup_path).convert("RGBA")
    target_width = round(size[0] * lockup_width_ratio)
    target_height = round(target_width * lockup.height / lockup.width)
    lockup = lockup.resize((target_width, target_height), Image.Resampling.LANCZOS)
    x = round(size[0] * 0.075)
    y = (size[1] - target_height) // 2
    canvas.alpha_composite(lockup, (x, y))
    return canvas.convert("RGB")


def build_store_assets() -> None:
    selected = TOOLS / "tmp" / "candidates" / "hero" / "image_2.png"
    if not selected.exists():
        raise RuntimeError("Selected hero candidate is missing; generate hero/image_2.png first.")
    hero = Image.open(selected).convert("RGB")
    save_png(hero, MASTERS / "hero-source-1536x1024.png")
    outputs = {
        "app-store-promotional-source-4320x1080.png": (4320, 1080),
        "google-play-feature-1024x500.png": (1024, 500),
        "open-graph-1200x630.png": (1200, 630),
        "support-hero-2400x1350.png": (2400, 1350),
        "testflight-cover-1600x1200.png": (1600, 1200),
    }
    for name, size in outputs.items():
        save_png(store_composition(hero, size), STORE / name)


def build_ios_catalog() -> None:
    catalog = NATIVE_LIBRARY / "ios" / "AppIcon.appiconset"
    catalog.mkdir(parents=True, exist_ok=True)
    source = Image.open(MASTERS / "app-icon-ios-1024.png").convert("RGB")
    specs = [
        ("iphone", "20x20", "2x", 40), ("iphone", "20x20", "3x", 60),
        ("iphone", "29x29", "2x", 58), ("iphone", "29x29", "3x", 87),
        ("iphone", "40x40", "2x", 80), ("iphone", "40x40", "3x", 120),
        ("iphone", "60x60", "2x", 120), ("iphone", "60x60", "3x", 180),
        ("ipad", "20x20", "1x", 20), ("ipad", "20x20", "2x", 40),
        ("ipad", "29x29", "1x", 29), ("ipad", "29x29", "2x", 58),
        ("ipad", "40x40", "1x", 40), ("ipad", "40x40", "2x", 80),
        ("ipad", "76x76", "1x", 76), ("ipad", "76x76", "2x", 152),
        ("ipad", "83.5x83.5", "2x", 167),
        ("ios-marketing", "1024x1024", "1x", 1024),
    ]
    images = []
    for idiom, logical, scale, pixels in specs:
        safe_logical = logical.replace(".", "-")
        name = f"AppIcon-{safe_logical}@{scale}.png"
        save_png(source.resize((pixels, pixels), Image.Resampling.LANCZOS), catalog / name)
        images.append({"idiom": idiom, "size": logical, "scale": scale, "filename": name})
    (catalog / "Contents.json").write_text(json.dumps({"images": images, "info": {"author": "xcode", "version": 1}}, indent=2) + "\n")

    installed = NATIVE_ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "AppIcon.appiconset"
    if installed.exists():
        shutil.rmtree(installed)
    shutil.copytree(catalog, installed)

    splash_set = NATIVE_ROOT / "ios" / "App" / "App" / "Assets.xcassets" / "Splash.imageset"
    splash_set.mkdir(parents=True, exist_ok=True)
    for dark in (False, True):
        source_path = MASTERS / ("splash-dark-2732.png" if dark else "splash-light-2732.png")
        for scale in (1, 2, 3):
            suffix = "-dark" if dark else ""
            shutil.copy2(source_path, splash_set / f"Default@{scale}x~universal~anyany{suffix}.png")


def android_vector(color: str) -> str:
    e_path = shaped_path("E", LORA, 470, 512, 500)
    return f'''<?xml version="1.0" encoding="utf-8"?>
<!-- EverPlate production monogram; reconstructed from approved guide with Lora OFL paths. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp" android:height="108dp"
    android:viewportWidth="108" android:viewportHeight="108">
    <group android:scaleX="0.064" android:scaleY="0.064" android:translateX="21.232" android:translateY="21.232">
        <path android:fillColor="@android:color/transparent" android:strokeColor="{color}"
            android:strokeWidth="15" android:strokeLineCap="round" android:strokeLineJoin="round"
            android:pathData="M705,282A294,294 0,1 0,735,706" />
        <path android:fillColor="@android:color/transparent" android:strokeColor="{color}"
            android:strokeWidth="13" android:strokeLineCap="round" android:strokeLineJoin="round"
            android:pathData="M370,653C447,731 591,746 696,663" />
        <path android:fillColor="{color}" android:pathData="{e_path}" />
    </group>
</vector>
'''


def build_android_assets() -> None:
    public_android = NATIVE_LIBRARY / "android"
    public_android.mkdir(parents=True, exist_ok=True)
    foreground = android_vector(CREAM)
    monochrome = android_vector(WHITE)
    background = '''<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="108dp" android:height="108dp" android:viewportWidth="108" android:viewportHeight="108">
    <path android:fillColor="#274233" android:pathData="M0,0h108v108h-108z" />
</vector>
'''
    (public_android / "ic_launcher_foreground.xml").write_text(foreground)
    (public_android / "ic_launcher_background.xml").write_text(background)
    (public_android / "ic_launcher_monochrome.xml").write_text(monochrome)

    res = NATIVE_ROOT / "android" / "app" / "src" / "main" / "res"
    (res / "drawable-v24" / "ic_launcher_foreground.xml").write_text(foreground)
    (res / "drawable" / "ic_launcher_background.xml").write_text(background)
    (res / "drawable" / "ic_launcher_monochrome.xml").write_text(monochrome)

    density_sizes = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    icon = Image.open(MASTERS / "app-icon-ios-1024.png").convert("RGB")
    for density, pixels in density_sizes.items():
        folder = res / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        legacy = icon.resize((pixels, pixels), Image.Resampling.LANCZOS)
        save_png(legacy, folder / "ic_launcher.png")
        save_png(legacy, folder / "ic_launcher_round.png")
        save_png(Image.new("RGB", (pixels, pixels), GREEN), folder / "ic_launcher_background.png")
        save_png(monogram_layer(pixels, CREAM, inset_ratio=0.16), folder / "ic_launcher_foreground.png")

    for splash_path in res.glob("drawable*/splash.png"):
        with Image.open(splash_path) as existing:
            size = existing.size
        dark = "night" in splash_path.parent.name
        source = Image.open(MASTERS / ("splash-dark-2732.png" if dark else "splash-light-2732.png")).convert("RGB")
        save_png(cover_crop(source, size), splash_path)

    (NATIVE_ROOT / "assets" / "logo.svg").write_text(svg_document((1024, 1024), f'<rect width="1024" height="1024" fill="{GREEN}"/>\n{monogram_body(CREAM)}', "EverPlate app icon", "Production light-mode application icon source."))
    (NATIVE_ROOT / "assets" / "logo-dark.svg").write_text(svg_document((1024, 1024), f'<rect width="1024" height="1024" fill="{DARKEST}"/>\n{monogram_body(DARK_CREAM)}', "EverPlate dark splash", "Production dark-mode splash source."))


def build_native_assets() -> None:
    build_ios_catalog()
    build_android_assets()


def build_review_assets() -> None:
    icon = Image.open(MASTERS / "app-icon-ios-1024.png").convert("RGB")
    sizes = [20, 29, 40, 60, 76, 84, 120, 152, 167, 180, 512, 1024]
    sheet = Image.new("RGB", (1800, 1250), CREAM)
    draw = ImageDraw.Draw(sheet)
    x, y, row_h = 40, 90, 0
    for size in sizes:
        preview = icon.resize((size, size), Image.Resampling.LANCZOS)
        if x + size + 80 > sheet.width:
            x, y, row_h = 40, y + row_h + 100, 0
        sheet.paste(preview, (x, y))
        draw.text((x, y - 28), f"{size}px", fill=BLACK)
        x += size + 70
        row_h = max(row_h, size)
    save_png(sheet, REVIEW / "icon-size-qa.png")

    masks = Image.new("RGB", (1600, 420), CREAM)
    base = icon.resize((320, 320), Image.Resampling.LANCZOS)
    labels = ["circle", "squircle", "rounded square", "teardrop"]
    for idx, label in enumerate(labels):
        mask = Image.new("L", (320, 320), 0)
        md = ImageDraw.Draw(mask)
        if label == "circle":
            md.ellipse((0, 0, 319, 319), fill=255)
        elif label == "squircle":
            md.rounded_rectangle((0, 0, 319, 319), radius=92, fill=255)
        elif label == "rounded square":
            md.rounded_rectangle((0, 0, 319, 319), radius=54, fill=255)
        else:
            points = [(160, 0), (300, 90), (320, 230), (230, 320), (90, 300), (0, 160), (72, 48)]
            md.polygon(points, fill=255)
        tile = Image.new("RGB", (320, 320), WHITE)
        tile.paste(base, (0, 0), mask)
        x = 40 + idx * 390
        masks.paste(tile, (x, 50))
        ImageDraw.Draw(masks).text((x, 385), label, fill=BLACK)
    save_png(masks, REVIEW / "android-mask-qa.png")

    light = Image.open(MASTERS / "splash-light-2160x3840.png")
    dark = Image.open(MASTERS / "splash-dark-2160x3840.png")
    ratios = [(9, 16), (9, 19.5), (9, 21)]
    splash_sheet = Image.new("RGB", (1500, 850), "#E8E3D9")
    x = 40
    for source, mode in ((light, "light"), (dark, "dark")):
        for rw, rh in ratios:
            target_h = 720
            target_w = round(target_h * rw / rh)
            scale = max(target_w / source.width, target_h / source.height)
            resized = source.resize((round(source.width * scale), round(source.height * scale)), Image.Resampling.LANCZOS)
            left = (resized.width - target_w) // 2
            top = (resized.height - target_h) // 2
            crop = resized.crop((left, top, left + target_w, top + target_h))
            splash_sheet.paste(crop, (x, 70))
            ImageDraw.Draw(splash_sheet).text((x, 40), f"{mode} {rw}:{rh}", fill=BLACK)
            x += target_w + 45
    save_png(splash_sheet, REVIEW / "splash-crop-qa.png")

    master_sheet = Image.new("RGB", (1800, 1100), CREAM)
    previews = [
        (MASTERS / "app-icon-ios-1024.png", (80, 90), (420, 420), "iOS icon"),
        (RASTER / "lockup-horizontal-4096.png", (560, 100), (1160, 340), "horizontal lockup"),
        (RASTER / "lockup-stacked-2400.png", (80, 600), (420, 420), "stacked lockup"),
        (STORE / "google-play-feature-1024x500.png", (560, 590), (1024, 500), "store feature"),
    ]
    md = ImageDraw.Draw(master_sheet)
    for path, position, bounds, label in previews:
        item = Image.open(path).convert("RGBA")
        item.thumbnail(bounds, Image.Resampling.LANCZOS)
        master_sheet.paste(item, position, item)
        md.text((position[0], position[1] - 28), label, fill=BLACK)
    save_png(master_sheet, REVIEW / "production-master-contact-sheet.png")

    groups = [("monogram", 3), ("wordmark", 3), ("app-icon", 3), ("splash-light", 2), ("splash-dark", 2), ("hero", 2)]
    candidate_sheet = Image.new("RGB", (1800, 3100), CREAM)
    cd = ImageDraw.Draw(candidate_sheet)
    x, y, column = 50, 80, 0
    for group, count in groups:
        for index in range(1, count + 1):
            path = CANDIDATES / group / f"image_{index}.png"
            if not path.exists():
                continue
            preview = Image.open(path).convert("RGB")
            preview.thumbnail((520, 470), Image.Resampling.LANCZOS)
            tile_y = y + (470 - preview.height) // 2
            candidate_sheet.paste(preview, (x, tile_y))
            cd.text((x, y - 28), f"{group} / candidate {index}", fill=BLACK)
            column += 1
            if column == 3:
                column = 0
                x = 50
                y += 530
            else:
                x += 580
    save_png(candidate_sheet, REVIEW / "candidate-contact-sheet.png")


def copy_candidates() -> None:
    source = TOOLS / "tmp" / "candidates"
    if not source.exists():
        return
    for group in ("monogram", "wordmark", "app-icon", "splash-light", "splash-dark", "hero"):
        src_group = source / group
        if not src_group.exists():
            continue
        dst_group = CANDIDATES / group
        dst_group.mkdir(parents=True, exist_ok=True)
        for image in src_group.glob("image_*.png"):
            shutil.copy2(image, dst_group / image.name)


def copy_font_licenses() -> None:
    licenses = BRAND / "fonts"
    licenses.mkdir(parents=True, exist_ok=True)
    shutil.copy2(FONT_ROOT / "lora" / "LICENSE", licenses / "LICENSE-Lora.txt")
    shutil.copy2(FONT_ROOT / "source-sans-3" / "LICENSE", licenses / "LICENSE-Source-Sans-3.txt")


def main() -> None:
    ensure_dirs()
    if not LORA.exists():
        raise SystemExit("Run npm install in native/everplate before building assets.")
    copy_candidates()
    copy_font_licenses()
    build_vectors()
    build_raster_masters()
    build_context_assets()
    build_splashes()
    build_store_assets()
    build_native_assets()
    build_review_assets()
    print("EverPlate deterministic brand assets built successfully.")


if __name__ == "__main__":
    main()
