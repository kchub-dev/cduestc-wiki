# 科成星球 | 电子科技大学成都学院WIKI

科成星球是电子科技大学成都学院第三方公益校园生活百科。

[访问在线版 wiki.kcos.club](https://wiki.kcos.club/)。

## 加入我们

项目组 QQ 群：[1027931860](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=b5xzyCga9ARuCjngtAtQM2UbifBdYPzw&authKey=8r%2FZWZKc21rMnDLjBRpo21H420NXt33AA7pEgiYt3u9Nfe5pBuIX26XK0U1IaIUO&noverify=0&group_code=1027931860)

## 贡献指南

- Fork该项目并进行Pull Request 或 在该项目内提交Issue。

- 前往项目组QQ群（1027931860）进行留言反馈
- 贡献指南至邮箱[reply@cduestc.fun](mailto:reply@cduestc.fun)

## 更新日志

阅读[在线版](https://wiki.kcos.club/changelog)或仓库内[源文档](/docs/changelog.md)。

## 鸣谢

源仓库：[西邮WIKI](https://wiki.cooo.site/)

## 本地运行/部署

项目采用 VitePress 构建。

完整的首次配置、AI 代理执行协议、GitHub Pages 与 Cloudflare Worker 发布流程，见：

- [一键部署手册](./DEPLOYMENT.md)
- [AI 部署执行协议](./AGENTS.md)

### 安装依赖

```sh
pnpm i
```
### 本地测试

```sh
pnpm run dev
```

### 搜索收录与分享卡片

`pnpm build` 构建完成后会自动扫描 VitePress 输出目录，生成 `sitemap.xml` 与 `robots.txt`，便于百度、谷歌等搜索引擎抓取。站点 `<head>` 已注入 Open Graph / Twitter 分享卡片元信息，分享任意页面到微信/QQ 时会显示统一的品牌卡片图 `/og-image.jpg`（约 102 KB）。

### AI 助手配置

复制 `.env.example` 中需要的配置到 `docs/.env.local`。AI 服务由站点维护者在构建或部署时选择，页面不会向访客提供切换入口或密钥设置。正式站默认使用 OpenAI 兼容模式：

```sh
VITE_OPENAI_PROXY_URL=https://spark-api.kcos.club/v1/chat/completions
VITE_OPENAI_MODEL=generalv3.5
```

`VITE_OPENAI_PROXY_URL` 指向站点自己的后端代理。代理接收 OpenAI Chat Completions 格式的请求并返回兼容响应；前端支持 SSE 增量输出，上游 API Key、Base URL 等敏感配置必须只保存在后端环境中，不能写入 `VITE_*` 变量或前端源码。

当前 Worker 使用讯飞 OpenAI 兼容 HTTP 接口作为上游，前端只调用一个标准 `POST /v1/chat/completions` 网关：

```sh
wrangler secret put SPARK_API_PASSWORD
wrangler deploy --config wrangler.jsonc
```

`SPARK_API_PASSWORD` 从讯飞控制台对应模型的 HTTP 接口认证信息中获取。Worker 固定主上游 URL、模型、temperature 和 max_tokens，只接收有限数量的 `system/user/assistant` 消息，并对 IP 做 best-effort 限流。生产默认将讯飞 Spark-X2（`https://spark-api-open.xf-yun.com/v2/chat/completions`，模型 `spark-x`）作为第二上游，并复用主 APIPassword；配置 `SPARK_FALLBACK_API_PASSWORD` 后可覆盖为独立凭证。凭证只保留在 Worker Secret 中。

知识库构建会生成带哈希版本的 `core/campus/study/life` 分片、`lsa-v1` 64 维分布式语义向量，并在浏览器内执行 BM25 + RRF 混合检索。`pnpm build` 同时运行内容安全扫描、页面锚点校验和 sitemap 生成；`pnpm eval:retrieval` 使用线上同一套分片和 manifest，执行 50 条回归查询并检查引用覆盖率、引用精度和降级链接率。零命中查询会以脱敏预览写入 Analytics Engine。

### AI Worker 状态

- Worker 通过 `spark-api.kcos.club` 提供 OpenAI 兼容 HTTP 网关。
- 讯飞 APIPassword 只存储在 `SPARK_API_PASSWORD` Worker Secret，不进入前端或仓库。
- 生产部署使用 `wrangler deploy --config wrangler.jsonc`，健康检查为 `/health`。

核心代码位于 `workers/spark-proxy.js` 与 `wrangler.jsonc`。

验证结果：

| 检查 | 结果 |
| --- | --- |
| 本机 8787 关闭 | 通过 |
| Tunnel Spark 路由删除 | 通过 |
| Worker 健康检查 | 通过 |
| 云端 HTTP 网关健康检查 | 通过 |
| 线上页面实际提问 | 通过 |
| 控制台错误 | 无 |
| Pages 部署 | 成功 |

> 安全提醒：APIPassword 属于敏感凭证，必须通过 `wrangler secret put SPARK_API_PASSWORD` 写入 Worker，不能写进 `.env`、GitHub Pages 变量或前端源码。CI 自动发布还需要 GitHub Secret `CLOUDFLARE_API_TOKEN`。复制仓库后的完整配置顺序见 [`DEPLOYMENT.md`](./DEPLOYMENT.md)。

### 推送

提交 Pull Request。
