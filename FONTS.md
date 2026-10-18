# 字体维护说明

站点的自定义字体**全部自托管**在 `docs/public/fonts/`，随 GitHub Pages 一起发布，不依赖任何外部 CDN 或对象存储。

> 背景（GitHub issue #19）：字体原本托管在 `oss.cduestc.fun`，该存储被清空后全站字体 404，浏览器回退到系统字体。现已改为仓库内自托管。

## 为什么是「两档子集」

源字体是全字库（Maple Mono NF CN 单个约 16MB TTF / 6MB woff2），首屏直接加载会非常慢（实测 42–90 秒）。因此按字符频率切成两档：

| 档位 | 字符范围 | 体积 | 加载时机 |
| --- | --- | --- | --- |
| 常用档 `*-common.woff2` | ASCII + 拉丁扩展 + 中文标点 + GB2312 全部汉字（6763 字） | 约 1.6–1.9 MB | 首屏（`<link rel=preload>`） |
| 生僻档 `*-extended.woff2` | GBK 中不属于 GB2312 的扩展汉字（约 1.5 万字） | 约 2.5–3.8 MB | 页面真的用到生僻字时，由 `unicode-range` 自动按需下载 |

两档合计覆盖 **GBK 全字表 21791 字**，日常与生僻中文都能正常显示。

## 两档的 unicode-range 必须零重叠

浏览器按 `@font-face` 声明顺序匹配字体。若两档的 `unicode-range` 有重叠，生僻档可能抢走常用字的渲染，表现为「部分常用字用了错误的字形」。生成脚本已经保证：

- 常用档：严格连续区间（`max_gap=0`）；
- 生僻档：允许小间隔合并以缩短 CSS，但合并时会跳过常用档覆盖的码点。

改动脚本后请复核：两档 range 交集必须为 0，且各自字体字形被自身 range 完整覆盖。

## 重新生成

源字体在仓库里已不再保留 TTF（只保留生成的子集）。需要重新生成时：

1. 从上游下载源字体：
   - Maple Mono NF CN：<https://github.com/subframe7536/maple-font/releases>（Light / Bold）
   - 陈雨洛燕体（ChenYuluoyan）：<https://github.com/Chenyuluoyan/thin-font>
2. 运行脚本（需要 `fonttools` + `brotli`）：

```sh
pip install fonttools brotli

# 正文字体（Light）—— 生成 fonts.css
python3 scripts/build-fonts.py path/to/MapleMono-NF-CN-Light.ttf

# 粗体（--family 与 CSS 里的 font-family 对应）
python3 scripts/build-fonts.py path/to/MapleMono-NF-CN-Bold.ttf --family MapleMono-1 --slug maple-bold

# 手写装饰体
python3 scripts/build-fonts.py path/to/ChenYuluoyan-2.0-Thin.ttf --family writefont --slug chenyuluoyan
```

输出：

- `docs/public/fonts/<slug>-common.woff2`、`<slug>-extended.woff2`
- `docs/.vitepress/theme/fonts.css`（正文）、`maple-bold.css`、`chenyuluoyan.css`

## 已知限制

- **ChenYuluoyan（手写体）源字体本身只有约 1 万个字形**，缺部分常用字（如「电」）。这是字体本身的设计范围，不是子集化造成的；若该字缺失会回退到下一个字体，不影响可读性。
- 该字体当前在站内**没有被任何样式引用**，仅保留以备将来使用。若确认长期不用，可连同其 CSS 一并删除，节省约 4.4MB。

## 相关文件

| 文件 | 说明 |
| --- | --- |
| `scripts/build-fonts.py` | 子集化 + 生成 CSS 的脚本 |
| `docs/.vitepress/theme/fonts.css` | 正文字体声明（生成，勿手改） |
| `docs/.vitepress/theme/maple-bold.css` | 粗体声明（生成） |
| `docs/.vitepress/theme/chenyuluoyan.css` | 手写体声明（生成） |
| `docs/.vitepress/config.mts` | 首屏 `preload` 与 CSP `font-src` |
