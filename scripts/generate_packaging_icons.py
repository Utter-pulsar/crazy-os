from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image

from make_icon_transparent import cleaned_icon

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'resources' / 'icon.png'
BUILD_DIR = ROOT / 'build'
MASTER_PNG = BUILD_DIR / 'icon.png'
WINDOWS_ICON = BUILD_DIR / 'icon.ico'
INSTALLER_ICON = BUILD_DIR / 'installerIcon.ico'
UNINSTALLER_ICON = BUILD_DIR / 'uninstallerIcon.ico'
MAC_ICON = BUILD_DIR / 'icon.icns'
LINUX_DIR = BUILD_DIR / 'icons'
LINUX_SIZES = (16, 24, 32, 48, 64, 128, 256, 512, 1024)
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]
ICNS_SIZES = [(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)]


def square_canvas(img: Image.Image, size: int = 1024) -> Image.Image:
    src = img.convert('RGBA')
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))

    max_dim = max(src.width, src.height)
    scale = min((size - 2) / max_dim, 1.0) if max_dim else 1.0
    target_w = max(1, round(src.width * scale))
    target_h = max(1, round(src.height * scale))
    resized = src.resize((target_w, target_h), Image.Resampling.LANCZOS)

    left = (size - target_w) // 2
    top = (size - target_h) // 2
    canvas.alpha_composite(resized, (left, top))
    return canvas


def save_linux_pngs(master: Image.Image) -> None:
    LINUX_DIR.mkdir(parents=True, exist_ok=True)
    for size in LINUX_SIZES:
        out = LINUX_DIR / f'{size}x{size}.png'
        master.resize((size, size), Image.Resampling.LANCZOS).save(out)


def save_windows_icons(master: Image.Image) -> None:
    WINDOWS_ICON.parent.mkdir(parents=True, exist_ok=True)
    master.save(WINDOWS_ICON, format='ICO', sizes=ICO_SIZES)
    shutil.copy2(WINDOWS_ICON, INSTALLER_ICON)
    shutil.copy2(WINDOWS_ICON, UNINSTALLER_ICON)


def save_mac_icon(master: Image.Image) -> None:
    master.save(MAC_ICON, format='ICNS', sizes=ICNS_SIZES)


def main() -> int:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    cleaned, kept = cleaned_icon(SRC)
    master = square_canvas(cleaned)
    master.save(MASTER_PNG)
    save_windows_icons(master)
    save_mac_icon(master)
    save_linux_pngs(master)

    print('generated packaging icons from', SRC)
    print('  master      ', MASTER_PNG)
    print('  windows exe ', WINDOWS_ICON)
    print('  installer   ', INSTALLER_ICON)
    print('  uninstaller ', UNINSTALLER_ICON)
    print('  macOS       ', MAC_ICON)
    print('  linux dir   ', LINUX_DIR)
    print('  source size ', cleaned.size, 'kept_px', kept)
    print('  master size ', master.size)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
