#!/usr/bin/env python3
"""把源字体切成「常用 / 生僻」两档 woff2，并生成对应的 @font-face CSS。

背景（GitHub issue #19）：正文字体原本放在阿里云 OSS，资源被删除后 404，
站点回退到系统字体。这里改为自托管子集：随 GitHub Pages 发布，零外部依赖。

设计：
- 常用档：ASCII + 拉丁扩展 + 中文标点 + GB2312 全部汉字（6763 字）
  → 覆盖日常 99.9% 文本，首屏只加载这一个文件。
- 生僻档：GBK 中不属于 GB2312 的扩展汉字（约 1.5 万字）
  → 通过 unicode-range 精确声明，只有页面真的用到生僻字时才下载。

两档合计覆盖 GBK 全字表，即「所有常用中文都能正常显示」。

用法（源字体需自行下载，见 SOURCE_HINT）：
    python3 scripts/build-fonts.py path/to/MapleMono-NF-CN-Light.ttf
    # 可选：为其它字重/装饰字体也生成子集（保持字体名与 CSS 变量一致）
    python3 scripts/build-fonts.py path/to/Bold.ttf --family MapleMono-1 --slug maple-bold
    python3 scripts/build-fonts.py path/to/Thin.ttf --family writefont --slug chenyuluoyan

输出：
    docs/public/fonts/<slug>-common.woff2
    docs/public/fonts/<slug>-extended.woff2
    docs/.vitepress/theme/fonts.css（默认字体）/ <slug>.css（其它字体）
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FONT_DIR = ROOT / 'docs' / 'public' / 'fonts'
OUT_CSS = ROOT / 'docs' / '.vitepress' / 'theme' / 'fonts.css'
FAMILY = 'MapleMono-2'

SOURCE_HINT = (
    '源字体：Maple Mono NF CN（https://github.com/subframe7536/maple-font/releases）\n'
    '  下载 MapleMono-NF-CN-Light.ttf 后传入本脚本路径即可重新生成子集。'
)


def gb2312_chars() -> set[str]:
    chars = set()
    for high in range(0xB0, 0xF8):
        for low in range(0xA1, 0xFF):
            try:
                chars.add(bytes([high, low]).decode('gb2312'))
            except UnicodeDecodeError:
                continue
    return chars


def gbk_chars() -> set[str]:
    chars = set()
    for lead in range(0x81, 0xFF):
        for trail in list(range(0x40, 0x7F)) + list(range(0x80, 0xFF)):
            try:
                chars.add(bytes([lead, trail]).decode('gbk'))
            except UnicodeDecodeError:
                continue
    return chars


def ascii_and_punctuation() -> set[str]:
    chars = {chr(code) for code in range(0x20, 0x7F)}
    # 拉丁扩展（é ü ñ 等）、常用符号、中文标点、全角字符
    chars.update(chr(code) for code in range(0xA0, 0x180))
    chars.update(chr(code) for code in range(0x2000, 0x2070))
    chars.update(chr(code) for code in range(0x3000, 0x3040))
    chars.update(chr(code) for code in range(0xFF00, 0xFFF0))
    chars.update('·—…‘’“”℃№※→←↑↓√≈≠≤≥±×÷°‰')
    return chars


def merge_ranges(codepoints: list[int], max_gap: int = 24, blocked: set[int] | None = None) -> list[tuple[int, int]]:
    """把码点合并成连续区间，并保证不与 blocked 里的码点重叠。

    max_gap > 0 时允许小间隔合并（CSS 更短），但合并出来的区间若跨到
    blocked 里的码点就必须断开——两档字体的 unicode-range 重叠会让浏览器
    按声明顺序选错文件，必须严格避免。
    """
    if not codepoints:
        return []
    blocked = blocked or set()
    ranges: list[list[int]] = [[codepoints[0], codepoints[0]]]
    for code in codepoints[1:]:
        current = ranges[-1]
        can_merge = code - current[1] <= max_gap
        if can_merge and blocked:
            # 检查待合并区间是否夹带 blocked 码点
            can_merge = not any(point in blocked for point in range(current[1] + 1, code + 1))
        if can_merge:
            current[1] = code
        else:
            ranges.append([code, code])
    return [(start, end) for start, end in ranges]


def css_unicode_range(ranges: list[tuple[int, int]]) -> str:
    parts = []
    for start, end in ranges:
        if start == end:
            parts.append(f'U+{start:X}')
        else:
            parts.append(f'U+{start:X}-{end:X}')
    return ','.join(parts)


def build_subset(source: Path, chars: set[str], out_path: Path) -> None:
    text_file = OUT_FONT_DIR / f'.{out_path.stem}.txt'
    text_file.write_text(''.join(sorted(chars)), encoding='utf-8')
    subprocess.run([
        sys.executable, '-m', 'fontTools.subset', str(source),
        f'--text-file={text_file}',
        '--flavor=woff2',
        '--layout-features=*',
        '--no-hinting',
        f'--output-file={out_path}',
    ], check=True, stdout=subprocess.DEVNULL)
    text_file.unlink(missing_ok=True)


def main() -> None:
    args = sys.argv[1:]
    if not args:
        print(SOURCE_HINT)
        raise SystemExit(1)

    family = FAMILY
    slug = 'maple'
    if '--family' in args:
        family = args[args.index('--family') + 1]
    if '--slug' in args:
        slug = args[args.index('--slug') + 1]
    paths_only = [arg for arg in args if not arg.startswith('--')
                  and arg not in (family, slug)]
    if not paths_only:
        print(SOURCE_HINT)
        raise SystemExit(1)

    source = Path(paths_only[0]).expanduser().resolve()
    if not source.is_file():
        print(f'找不到源字体：{source}\n{SOURCE_HINT}')
        raise SystemExit(1)

    OUT_FONT_DIR.mkdir(parents=True, exist_ok=True)

    common = ascii_and_punctuation() | gb2312_chars()
    extended = gbk_chars() - common

    print(f'[{slug}] 常用档字符数：{len(common)}  生僻档字符数：{len(extended)}')

    common_path = OUT_FONT_DIR / f'{slug}-common.woff2'
    extended_path = OUT_FONT_DIR / f'{slug}-extended.woff2'
    build_subset(source, common, common_path)
    build_subset(source, extended, extended_path)

    common_ranges = merge_ranges(sorted(ord(char) for char in common), max_gap=0)
    common_codes = {code for start, end in common_ranges for code in range(start, end + 1)}
    extended_ranges = merge_ranges(
        sorted(ord(char) for char in extended),
        max_gap=24,
        blocked=common_codes,
    )

    def face(path: Path, ranges: list[tuple[int, int]]) -> str:
        return (
            '@font-face {\n'
            f"    font-family: '{family}';\n"
            f"    src: url('/fonts/{path.name}') format('woff2');\n"
            '    font-weight: normal;\n'
            '    font-style: normal;\n'
            '    font-display: swap;\n'
            f'    unicode-range: {css_unicode_range(ranges)};\n'
            '}\n'
        )

    css = (
        '/* 由 scripts/build-fonts.py 生成，请勿手工编辑。\n'
        ' * 常用档首屏加载；生僻档按 unicode-range 按需下载。\n'
        ' * 背景：原 OSS 托管字体已失效（issue #19），改为随站点自托管。\n'
        ' */\n'
        + face(common_path, common_ranges)
        + face(extended_path, extended_ranges)
    )
    out_css = OUT_CSS if slug == 'maple' else OUT_CSS.with_name(f'{slug}.css')
    out_css.write_text(css, encoding='utf-8')

    for path in (common_path, extended_path):
        print(f'  {path.relative_to(ROOT)}  {path.stat().st_size / 1024:.0f} KB')
    print(f'  {out_css.relative_to(ROOT)}  {len(css) / 1024:.1f} KB '
          f'（{len(common_ranges)}+{len(extended_ranges)} 个区间）')


if __name__ == '__main__':
    main()
