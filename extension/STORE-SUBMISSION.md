# 上架微软 Edge 加载项商店（提交指南）

> 本文件不随扩展包分发（打包脚本已排除），供维护者使用。

## 为什么选微软 Edge 加载项商店

| 对比项 | 微软 Edge 加载项 | Chrome 应用商店 |
| --- | --- | --- |
| 开发者费用 | **免费** | 5 美元注册费 |
| 国内直接访问 | ✅ 可以（无外网梯子也能打开） | ❌ 被墙，需要梯子 |
| 学生端覆盖 | Windows 电脑自带 Edge，装机即用 | 需自行安装 Chrome |
| 审核周期 | 通常 1-7 个工作日 | 数天到数周 |

结论：**微软 Edge 加载项商店**是当前唯一能在国内顺畅分发的官方渠道，且上架后在 Edge 里是真正的一键安装 + 自动更新。Chrome 官方商店作为后续可选项（需要梯子和付费）。

## 商店提交版 zip 在哪里

运行 `pnpm pack:extension`（或 `pnpm build`）后生成：

```
extension-dist/cduestc-ai-extension-store-v{version}.zip
```

注意商店提交版和用户下载版的区别：商店版 `manifest.json` 位于 zip **根部**（提交要求），用户下载版带一层 `cduestc-ai-extension/` 文件夹（方便解压后直接加载）。

## 提交前需要准备的材料

1. **微软账号**：任意 Microsoft 账号，免费注册 [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/)。
2. **扩展包**：上面的 store 版 zip。
3. **商店页面文案**：
   - 名称：科成星球 AI 直连助手
   - 简介（不超过 132 字符）：在科成星球 Wiki 上使用你自己登录的豆包 / DeepSeek 账号回答问题；请求只发生在你的浏览器里。
   - 详细描述：见下方「审查员说明」模板。
   - 分类：效率（Productivity）
   - 语言：中文（简体）
4. **隐私政策**：需要一个可公开访问的 URL。可直接使用 Wiki 上的说明页 `https://wiki.kcos.club/ai-extension`，或单独写一页。
5. **截图**：至少 1 张（建议 1280×800 或 640×400）：Wiki 聊天窗 + 扩展弹窗各一张即可。
6. **权限用途说明**（提交表单里逐项要求解释，模板见下）。

## 权限用途说明模板（提交表单直接粘贴）

- `cookies`：读取用户自己浏览器中已登录的 `chat.deepseek.com` / `www.doubao.com` 会话 cookie，用于以用户本人身份向其发送提问。凭证不离开用户浏览器，不上传任何服务器。
- `storage`：保存用户的默认上游选择（DeepSeek / 豆包）与深度思考开关等本地设置。
- 主机权限 `chat.deepseek.com`、`www.doubao.com`：向上述两个站点发送用户提问并接收流式回答。
- 内容脚本（wiki.kcos.club 等）：在站主自己的百科站点上桥接页面聊天窗口与扩展，用于传递问题与回答。
- 内容脚本（chat.deepseek.com）：读取页面 localStorage 中的登录令牌（userToken），读取后仅存于浏览器会话内存（`chrome.storage.session`），用于调用该站点自身的接口。

## 审查员说明模板（详细描述）

> 科成星球 AI 直连助手是一个 **BYOW（Bring Your Own Worker）** 工具：科成星球 Wiki（wiki.kcos.club，纯静态公益校园百科）上的 AI 聊天窗默认使用站方自建的小型代理服务；安装本扩展后，用户可以选择改用**自己在 chat.deepseek.com 或 www.doubao.com 已登录的账号**来回答，回答内容不经过站方服务器，也不上传到任何第三方。扩展不收集任何浏览数据，不注入广告，不修改页面内容；所有网络请求仅发生在用户自己的浏览器与上述两个 AI 站点之间。站点与扩展完全开源。
> 功能演示：打开 wiki.kcos.club，点击右下角 AI 助手 → 标题栏切换「直连」→ 提问。

## 提交步骤

1. 打开 [Microsoft Partner Center – Edge 扩展](https://partner.microsoft.com/dashboard/microsoftedge/)，用微软账号登录。
2. 创建开发者账号（免费，需填写基本信息，审核开通通常几分钟到 1 天）。
3. 「新建扩展」→ 上传 `cduestc-ai-extension-store-v{version}.zip`。
4. 填写商店页面（名称、简介、详细描述、分类、语言、截图）。
5. 填写「隐私」部分：声明不收集个人数据（cookies 仅本地使用）；粘贴上面的权限用途说明。
6. 提交审核。通过后拿到商店链接，把链接更新到：
   - `docs/ai-extension.md`（安装章节）
   - 更新日志 `docs/changelog.md`

## 上架后的维护

- **发新版**：改 `extension/manifest.json` 的 `version` → `pnpm pack:extension` → Partner Center 里「更新」→ 上传新 zip → 审核。Edge 商店会自动给所有用户推送更新。
- **看数据**：Partner Center 有安装量、周活等基础统计。
- **下线/急修**：Partner Center 支持紧急下架；如需紧急版本可先在 Wiki 页面发指南让用户手动更新。

## 备用分发渠道（不依赖商店）

1. **Wiki 直链下载（已实现，首选）**：`https://wiki.kcos.club/downloads/cduestc-ai-extension.zip`，随站点构建自动更新，学生已能访问 Wiki，无需 GitHub / 网盘 / 梯子。
2. **网盘镜像（可选）**：把同一个 zip 传到自己的网盘，把分享链接补充到 Wiki 说明页作为备用。
3. **Gitee 等国内代码托管 Releases（可选）**：如需第二个直链可考虑。

不建议把 GitHub Releases 当主渠道：部分学生无法直连 GitHub。
