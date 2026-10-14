#!/usr/bin/env python3
"""打包浏览器扩展，产物两用：

- 用户下载版 -> docs/public/downloads/cduestc-ai-extension.zip
  带顶层文件夹，解压后得到可直接在浏览器「加载解压缩的扩展」中选择的目录。
  随站点一起发布，学生从 wiki.kcos.club 直接下载，无需 GitHub / 网盘 / 梯子。
- 商店提交版 -> extension-dist/cduestc-ai-extension-store-v{version}.zip
  manifest.json 位于 zip 根部，符合 Edge / Chrome 加载项商店的上传要求。

由 predev / prebuild 自动调用，也可手动运行：python3 scripts/pack-extension.py
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "extension"
USER_OUT_DIR = ROOT / "docs" / "public" / "downloads"
STORE_OUT_DIR = ROOT / "extension-dist"
FOLDER_NAME = "cduestc-ai-extension"
EXCLUDED_DIRS = {"tools"}
EXCLUDED_FILES = {"STORE-SUBMISSION.md"}


def collect_files() -> list[Path]:
    files = []
    for path in sorted(EXT_DIR.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(EXT_DIR)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if rel.parts[0] in EXCLUDED_DIRS:
            continue
        if len(rel.parts) == 1 and rel.name in EXCLUDED_FILES:
            continue
        files.append(path)
    return files


def write_zip(zip_path: Path, files: list[Path], prefix: str) -> None:
    zip_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, prefix + path.relative_to(EXT_DIR).as_posix())


def main() -> None:
    manifest = json.loads((EXT_DIR / "manifest.json").read_text("utf-8"))
    version = manifest.get("version", "0.0.0")
    files = collect_files()

    user_zip = USER_OUT_DIR / f"{FOLDER_NAME}.zip"
    write_zip(user_zip, files, f"{FOLDER_NAME}/")

    store_zip = STORE_OUT_DIR / f"{FOLDER_NAME}-store-v{version}.zip"
    write_zip(store_zip, files, "")

    for zip_path in (user_zip, store_zip):
        size_kb = zip_path.stat().st_size / 1024
        print(
            f"[pack-extension] {zip_path.relative_to(ROOT)} "
            f"v{version} - {len(files)} files, {size_kb:.1f} KB"
        )


if __name__ == "__main__":
    main()
