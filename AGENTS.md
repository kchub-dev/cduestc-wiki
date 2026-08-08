# AI 部署执行协议

当用户要求“部署这个仓库”或“上线 AI + 知识库”时，AI 代理按以下顺序执行。完整说明见 DEPLOYMENT.md。

## 执行顺序

1. 读取 DEPLOYMENT.md、wrangler.jsonc、.github/workflows/deploy.yml、package.json。
2. 检查 git status --short --branch，保留用户无关改动。
3. 确认 gh auth status、pnpm --version、node --version、python3 --version。
4. 确认 GitHub Variables、CLOUDFLARE_API_TOKEN Secret、Worker 的 SPARK_API_PASSWORD Secret 已存在；缺失时在本机安全提示用户输入。
5. 确认 Cloudflare Analytics Engine 已启用。
6. 执行：

~~~sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:worker
pnpm eval:retrieval
~~~

7. 只提交属于本次部署的文件，推送 main，等待 deploy.yml 全部 job 成功。
8. 对 Pages 执行 /pages/health 检查；如果 is_proxied=true，将 Pages DNS 切为 DNS-only。
9. 当 is_https_eligible=true 时，执行 PUT /repos/OWNER/REPO/pages -F https_enforced=true。
10. 验证 Pages manifest、Worker health、Telemetry、非法 Origin 和真实 Chat Completions 请求。

## 首次执行时必须向用户索取的内容

只在本机终端接收，不要求用户把值发送到聊天：

- GitHub 登录状态，或让用户在本机执行 gh auth login
- Cloudflare API Token：账户范围 Workers 编辑权限；若 AI 要直接切换 DNS，另需 Zone DNS 编辑权限
- 讯飞 HTTP 接口 APIPassword
- GitHub Pages 自定义域名和 Cloudflare Worker 域名

讯飞的 WebSocket Assistant 四要素不能替代当前 Worker 所需的 HTTP APIPassword。如果用户只提供 WebSocket 凭证，暂停改造并说明认证协议不匹配，不要把它们写入当前 HTTP 网关。

## 禁止事项

- 禁止把 Secret 写入 .env、VITE_*、Markdown、JSON、GitHub Variables 或 Git commit。
- 禁止使用 git reset --hard、git checkout -- 或删除用户文件。
- 禁止在 Pages DNS 证书签发期间开启 Cloudflare Proxy。
- 禁止在没有线上响应证据时声称部署成功。
