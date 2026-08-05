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
VITE_SPARK_AUTH_URL=http://127.0.0.1:8787/spark/auth
```

将 `server/.env.example` 复制为 Git 忽略的 `server/.env.local`，填写讯飞凭据和助手地址，再单独启动本地签名服务：

```sh
pnpm run dev:spark-auth
```

服务仅监听 `127.0.0.1:8787`，并通过短期会话地址代理讯飞 WebSocket。API Key、API Secret 和讯飞签名 URL 都只保留在代理服务端，不能写入 `VITE_*` 变量或前端源码。线上部署需要使用反向代理或 Cloudflare Tunnel 将 `/spark/auth` 和 `/spark/chat` 安全发布到 HTTPS/WSS 地址。两个 Provider 的链路彼此独立；当前 Provider 失败时只降级到本地知识库，不会自动调用另一个 Provider。

### 推送

提交 Pull Request。
