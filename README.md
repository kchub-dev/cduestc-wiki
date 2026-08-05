# 科成星球 | 电子科技大学成都学院WIKI

科成星球是电子科技大学成都学院第三方公益校园生活百科。

[访问在线版 cduestc.fun](https://cduestc.fun)。

## 加入我们

项目组 QQ 群：[1027931860](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=b5xzyCga9ARuCjngtAtQM2UbifBdYPzw&authKey=8r%2FZWZKc21rMnDLjBRpo21H420NXt33AA7pEgiYt3u9Nfe5pBuIX26XK0U1IaIUO&noverify=0&group_code=1027931860)

## 贡献指南

- Fork该项目并进行Pull Request 或 在该项目内提交Issue。

- 前往项目组QQ群（1027931860）进行留言反馈
- 贡献指南至邮箱[reply@cduestc.fun](mailto:reply@cduestc.fun)

## 更新日志

阅读[在线版](https://cduestc.fun/changelog)或仓库内[源文档](/docs/changelog.md)。

## 鸣谢

源仓库：[西邮WIKI](https://wiki.cooo.site/)

## 本地运行/部署

项目采用 VitePress 构建。

### 安装依赖

```sh
pnpm i
```
### 本地测试

```sh
pnpm run dev
```

### 搜索收录与分享卡片

`pnpm build` 构建完成后会自动扫描 VitePress 输出目录，生成 `sitemap.xml` 与 `robots.txt`，便于百度、谷歌等搜索引擎抓取。站点 `<head>` 已注入 Open Graph / Twitter 分享卡片元信息，分享任意页面到微信/QQ 时会显示统一的品牌卡片图 `/og-image.png`。

### AI 助手配置

复制 `.env.example` 中需要的配置到 `docs/.env.local`。AI 服务由站点维护者在构建或部署时选择，页面不会向访客提供切换入口或密钥设置。正式站默认使用 OpenAI 兼容模式：

```sh
VITE_AI_PROVIDER=openai
VITE_OPENAI_PROXY_URL=https://example.com/api/ai/openai
VITE_OPENAI_MODEL=step-3.5-flash
```

`VITE_OPENAI_PROXY_URL` 指向站点自己的后端代理。代理接收 OpenAI Chat Completions 格式的请求并返回兼容响应；上游 API Key、Base URL 等敏感配置必须只保存在后端环境中，不能写入 `VITE_*` 变量或前端源码。

讯飞演示模式使用独立链路：

```sh
VITE_AI_PROVIDER=spark
VITE_SPARK_AUTH_URL=https://spark-api.kcos.club/spark/auth
```

讯飞 WebSocket 代理运行在 Cloudflare Workers，代码和路由配置分别位于 `workers/spark-proxy.js` 与 `wrangler.jsonc`。首次部署前通过 Wrangler 写入以下 Worker Secrets：

```sh
wrangler secret put SPARK_APP_ID
wrangler secret put SPARK_API_KEY
wrangler secret put SPARK_API_SECRET
wrangler secret put SPARK_ASSISTANT_URL
wrangler deploy --config wrangler.jsonc
```

Worker 通过 60 秒短期会话代理讯飞 WebSocket。API Key、API Secret 和讯飞签名 URL 都只保留在 Worker 内，不能写入 `VITE_*` 变量或前端源码。服务由 Cloudflare 常驻运行，不依赖开发者电脑或 Tunnel。两个 Provider 的链路彼此独立；当前 Provider 失败时只降级到本地知识库，不会自动调用另一个 Provider。

### 讯飞 Worker 迁移状态

已将上述本地 Tunnel 方案迁移至 Cloudflare Workers，线上 AI 不再依赖开发者电脑：

- Worker 通过 `spark-api.kcos.club` 同时提供 HTTP 鉴权（`/spark/auth`）与 WebSocket 代理（`/spark/chat`）。
- 4 项讯飞配置（`SPARK_APP_ID`、`SPARK_API_KEY`、`SPARK_API_SECRET`、`SPARK_ASSISTANT_URL`）已存入 Cloudflare Worker Secrets；仓库源码与前端构建产物均不含真实值。
- 本机 `scripts/spark-auth-server.mjs`（8787 服务）、LaunchAgent、本地凭据及 Tunnel 中 `spark-api.kcos.club → 8787` 路由均已删除。
- `workers_dev` 因当前网络存在 DNS 污染，生产改为官方推荐的 Worker 自定义域名方式（`wrangler.jsonc` 中 `routes[].custom_domain = true`），同时启用 Custom Domains、WebSockets 与 Secrets。

核心代码位于 `workers/spark-proxy.js` 与 `wrangler.jsonc`。

验证结果：

| 检查 | 结果 |
| --- | --- |
| 本机 8787 关闭 | 通过 |
| Tunnel Spark 路由删除 | 通过 |
| Worker 健康检查 | 通过 |
| 云端真实讯飞 WebSocket | 通过 |
| 线上页面实际提问 | 通过 |
| 控制台错误 | 无 |
| Pages 部署 | 成功 |
| 上游提交 | Draft PR #15 |

> 安全提醒：iFlytek 凭证曾出现在对话记录中，建议在讯飞开放平台后台轮换一次 API Key / Secret，并通过 `wrangler secret put SPARK_API_KEY` / `wrangler secret put SPARK_API_SECRET` 同步更新对应 Worker Secrets。

### 推送

提交 Pull Request。
