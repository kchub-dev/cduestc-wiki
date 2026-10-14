# 科成星球 AI 直连助手（浏览器扩展）

在科成星球 Wiki（`wiki.kcos.club`）的聊天浮窗里，用**你自己登录的 DeepSeek / 豆包网页账号**直接生成回答。Wiki 本身保持纯静态、零后端：所有 AI 请求都发生在用户自己的浏览器里，用用户自己的账号，回答内容不经过任何第三方服务器。

> Wiki 侧的配套改动见仓库内 `docs/ai-extension.md`（面向用户的使用说明）。

## 安装（开发者模式加载）

1. 打开 Chrome / Edge，地址栏进入 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 右上角打开「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本仓库的 `extension/` 目录。
4. 在 **当前浏览器里登录** [chat.deepseek.com](https://chat.deepseek.com) 或 [www.doubao.com](https://www.doubao.com)（用到哪家登哪家），登录后**打开一次它的页面**（让辅助脚本把登录凭证上报给扩展）。
5. 打开 Wiki 任意页面，点右下角 AI 助手，标题栏把「网关」切换成「直连」即可。

## 工作原理

```
Wiki 页面（纯静态，本地 RAG 检索 + prompt 组装）
   │  window.postMessage（命名空间 kcos-wiki-ai-bridge/v1）
   ▼
content-bridge.js（只在 wiki 域名上运行，页面 ↔ 扩展转发）
   │  chrome.runtime.connect 长连接端口
   ▼
background service worker（扩展后台，唯一有跨域权限的地方）
   │  fetch + credentials（用户自己浏览器的登录 cookie）
   ▼
chat.deepseek.com / www.doubao.com（用户自己的账号）
```

- **知识检索在页面本地完成**：扩展是纯传输层，收到的已经是拼好知识点
  的完整 prompt。知识点只随问题一起发给你自己登录的 AI 账号。
- **DeepSeek 认证链路**：`content-deepseek.js` 在登录页读取 localStorage
  里的 `userToken`，写入 `chrome.storage.session`（仅本次浏览器会话内存，
  不落盘）→ 后台用它换短期 accessToken → 建会话 → 计算 PoW → 流式补全，
  结束后删除会话，不在用户账号里留下对话。
- **豆包认证链路**：完全依赖浏览器已有 cookie（sessionid），查询串里的
  `msToken` / `a_bogus` 用随机占位值即可。回答结束同样删除会话。
- **PoW（工作量证明）**：DeepSeek 网页版要求每条补全请求附带
  `X-Ds-PoW-Response`。算法为 DeepSeekHashV1（SHA3-256 海绵结构、只跑
  KECCAK-p[1600] 后 23 轮）：求 nonce 使
  `hash(salt_expireAt_nonce)` 与 challenge 全等，实现在
  `src/deepseek-hash.js`（已与 Node/OpenSSL 的 SHA3-256 对拍验证）。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `manifest.json` | MV3 清单：权限、host、脚本注册 |
| `background.js` | 后台 SW：ping / 对话端口路由、流式转发 |
| `content-bridge.js` | wiki 域名上的桥接脚本（postMessage ↔ 端口） |
| `content-deepseek.js` | DeepSeek 登录页上的 userToken 上报脚本 |
| `src/deepseek-hash.js` | DeepSeekHashV1（keccak 23 轮）+ nonce 求解 |
| `src/providers/deepseek.js` | DeepSeek 适配器 |
| `src/providers/doubao.js` | 豆包适配器 |
| `src/sse.js` | SSE 流读取 + 消息压平工具 |
| `popup.html` / `popup.js` | 弹窗：默认上游、深度思考开关、登录状态 |
| `tools/gen-icons.mjs` | 图标生成脚本（纯 Node，无依赖） |

## 上游改版时的维护指南

两个上游都是**非官方逆向接口**，改版可能失效。典型症状与排查顺序：

- **提示「未找到登录凭证」**：重新登录并打开一次对应网站页面；检查
  `chrome://extensions` 里扩展是否被浏览器禁用。
- **HTTP 401/403**：登录过期，重新登录即可。
- **DeepSeek「接口错误 40x / 未下发 PoW 挑战」**：客户端版本号变了。对照
  真实浏览器抓包更新 `src/providers/deepseek.js` 里的 `X-Client-Version`
  等请求头，以及响应里 `data.biz_data` 的取值路径。
- **豆包「非流式响应」**：多半是接口路径或参数风控变化。更新
  `src/providers/doubao.js` 顶部的 `VERSION_CODE` / `PC_VERSION`，或对比
  官方网页最新抓包调整 body 结构。
- **回答为空或乱码**：上游改了 SSE 事件结构。检查各适配器文件底部的
  `consume*Stream` 函数与注释里记录的事件格式。

调试技巧：`chrome://extensions` → 本扩展 → 「Service Worker」点开控制台，
能看到所有错误；`background.js` 顶部的消息监听是所有请求的入口。

## 给其他站点复用（大面积拓展）

扩展默认只桥接以下 wiki 域名（见 `manifest.json` 的 `content_scripts`）：

- `https://wiki.kcos.club/*`（线上）
- `http://localhost:5173/*`、`http://127.0.0.1:5173/*`（本地开发）

其他人想给自己的静态站接入：fork 后在 `manifest.json` 的 `content_scripts[0].matches`
里加上自己的域名，重新加载扩展即可；同时参考 `docs/.vitepress/ai/bridge.ts`
把页面侧握手协议（同一个命名空间 `kcos-wiki-ai-bridge/v1`）抄过去。

## 风险与边界（务必了解）

- 自动化调用豆包 / DeepSeek 网页版**可能违反其用户协议**，理论上有账号
  被限制的风险。请控制频率、仅个人学习使用，勿用于批量抓取或商业服务。
- 扩展把 wiki 检索到的知识片段拼进 prompt 一起发给上游，等于把这些公开
  百科内容发给你自己的账号，不涉及隐私数据；扩展**不上报**任何浏览记录，
  拥有的权限仅限两个上游域名的网络访问与 wiki 域名的桥接脚本。
- 上游接口随时可能改版失效，适配器需要跟着维护；这不影响 wiki 本身的
  「校园网关」模式（两套互相独立，网关仍是默认模式）。
