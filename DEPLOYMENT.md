# 一键部署手册

本文适用于把本仓库复制到新的 GitHub 仓库后，交给 AI 编程代理完成首次部署和后续发布。

## 目标架构

~~~text
GitHub main -> GitHub Actions -> VitePress build -> GitHub Pages
Browser AIChat -> Cloudflare Worker -> Spark OpenAI-compatible HTTP API
Worker telemetry -> Cloudflare Analytics Engine
~~~

前端只包含 Worker 的公开 URL，不包含讯飞、Cloudflare 或 GitHub Secret。知识库由构建阶段生成，随 Pages artifact 发布。

## 首次配置

### 1. 本地环境

要求：Node.js 22+、pnpm 11、Python 3、GitHub CLI gh，以及已启用 Workers Analytics Engine 的 Cloudflare 账户。

复制仓库后先执行：

~~~sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:worker
pnpm eval:retrieval
pnpm test:ai-security
~~~

### 2. 修改部署标识

复制仓库时检查 wrangler.jsonc：

- account_id 改为目标 Cloudflare 账户 ID。
- name 改为目标 Worker 名称。
- routes[0].pattern 改为目标 Worker 域名。
- SPARK_ALLOWED_ORIGINS 改为 Pages 自定义域名和本地开发域名。

### 3. 配置 GitHub Variables

将 REPO 替换为 OWNER/REPOSITORY，将域名替换为实际值：

~~~sh
REPO="OWNER/REPOSITORY"
SITE_DOMAIN="wiki.example.com"
WORKER_DOMAIN="spark-api.example.com"

gh variable set VITE_OPENAI_PROXY_URL --repo "$REPO" --body "https://$WORKER_DOMAIN/v1/chat/completions"
gh variable set VITE_AI_TELEMETRY_URL --repo "$REPO" --body "https://$WORKER_DOMAIN/telemetry"
gh variable set VITE_OPENAI_MODEL --repo "$REPO" --body generalv3.5
~~~

### 4. 配置凭证

CLOUDFLARE_API_TOKEN 只写入 GitHub Secret。它至少需要目标账户的 Workers 编辑权限；如果 AI 代理还要直接切换 Pages DNS，则需要 Zone DNS 编辑权限：

~~~sh
read -r -s -p "Cloudflare API Token: " DEPLOY_CF_TOKEN
printf '\n'
printf '%s' "$DEPLOY_CF_TOKEN" | gh secret set CLOUDFLARE_API_TOKEN --repo "$REPO"
~~~

讯飞 HTTP 接口的 APIPassword 只写入 Worker Secret：

~~~sh
read -r -s -p "Spark APIPassword: " DEPLOY_SPARK_PASSWORD
printf '\n'
printf '%s' "$DEPLOY_SPARK_PASSWORD" \
  | CLOUDFLARE_API_TOKEN="$DEPLOY_CF_TOKEN" \
    pnpm exec wrangler secret put SPARK_API_PASSWORD --config wrangler.jsonc
~~~

不要把凭证发送到聊天窗口、写入 .env、VITE_*、Markdown、JSON 或 Git commit。讯飞 WebSocket Assistant 的四要素不能替代当前 HTTP 网关所需的 APIPassword。

`wrangler.jsonc` 已配置讯飞 Spark-X2 HTTP 接口作为第二上游：

~~~text
SPARK_FALLBACK_URL=https://spark-api-open.xf-yun.com/v2/chat/completions
SPARK_FALLBACK_MODEL=spark-x
~~~

默认复用 `SPARK_API_PASSWORD`。如果控制台为备用模型签发了独立 APIPassword，再额外写入：

~~~sh
read -r -s -p "Spark fallback APIPassword: " DEPLOY_SPARK_FALLBACK_PASSWORD
printf '\n'
printf '%s' "$DEPLOY_SPARK_FALLBACK_PASSWORD" \
  | CLOUDFLARE_API_TOKEN="$DEPLOY_CF_TOKEN" \
    pnpm exec wrangler secret put SPARK_FALLBACK_API_PASSWORD --config wrangler.jsonc
unset DEPLOY_SPARK_FALLBACK_PASSWORD
unset DEPLOY_CF_TOKEN DEPLOY_SPARK_PASSWORD
~~~

备用上游只有在主上游超时、429 或 5xx 时才会调用；`/health` 的 `fallbackConfigured` 字段必须为 `true` 才表示配置已经进入 Worker。

### 5. 启用 Analytics Engine

在目标 Cloudflare 账户启用 Workers Analytics Engine：

~~~text
https://dash.cloudflare.com/<ACCOUNT_ID>/workers/analytics-engine
~~~

启用后，wrangler.jsonc 中的 AI_TELEMETRY binding 会在 Worker 部署时生效。

### 6. 配置 Pages DNS

自定义 Pages 子域名必须直接指向仓库所属账户的 Pages 域名：

~~~text
类型: CNAME
名称: SITE_DOMAIN
目标: OWNER.github.io
代理: DNS-only / 灰云
~~~

证书签发期间不要使用 Cloudflare Proxy。否则 Pages health 会显示 is_proxied=true、is_https_eligible=false，并且强制 HTTPS 会返回“证书尚未生成”。不要为同一主机添加额外 A、AAAA 或 CNAME 记录。

### 7. 配置 Pages 自定义域名

~~~sh
gh auth login
gh api --method PUT \
  -H 'Accept: application/vnd.github+json' \
  "/repos/$REPO/pages" \
  -f cname="$SITE_DOMAIN"
~~~

## 后续一键发布

首次配置完成后，内容更新只需：

~~~sh
git add .
git commit -m "update knowledge"
git push origin main
~~~

.github/workflows/deploy.yml 会自动执行：锁定依赖安装、知识库生成与校验、内容扫描、LSA 语义索引生成、VitePress 构建、检索与引用回归、输入安全回归、Pages 部署、Worker smoke test 和 Worker 部署。

知识库 manifest 会携带 `lsa-v1` 语义索引：构建期从文档共现关系生成 64 维分布式向量，浏览器用同一词表编码查询，再与 BM25 通过 RRF 合并。它不依赖外部模型下载或向量数据库。

查看最近一次结果：

~~~sh
RUN_ID=$(gh run list --repo "$REPO" --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --repo "$REPO" --exit-status
~~~

## 线上验收

~~~sh
/usr/bin/curl -fsS "https://$SITE_DOMAIN/knowledge-manifest.json"
/usr/bin/curl -fsS "https://$WORKER_DOMAIN/health"

/usr/bin/curl -fsS -X POST \
  -H "Origin: https://$SITE_DOMAIN" \
  -H 'Content-Type: application/json' \
  --data '{"event":"gateway_response","provider":"openai","status":"200"}' \
  "https://$WORKER_DOMAIN/telemetry"

/usr/bin/curl -fsS -X POST \
  -H "Origin: https://$SITE_DOMAIN" \
  -H 'Content-Type: application/json' \
  --data '{"model":"generalv3.5","messages":[{"role":"user","content":"请只回答：连通性测试通过"}],"stream":false}' \
  "https://$WORKER_DOMAIN/v1/chat/completions"
~~~

非法来源必须被拒绝：

~~~sh
/usr/bin/curl -i -X POST \
  -H 'Origin: https://evil.example' \
  "https://$WORKER_DOMAIN/v1/chat/completions"
~~~

预期状态码为 403。

`/health` 预期包含 `{"status":"ok","fallbackConfigured":true}`。遥测中的 `search_zero` 会记录经过邮箱、手机号、URL 和长数字脱敏的查询预览，供内容补录使用，不记录完整对话。

## Pages HTTPS 检查

先触发 DNS health 检查，再读取结果：

~~~sh
gh api "/repos/$REPO/pages/health"
sleep 5
gh api "/repos/$REPO/pages/health" | jq '.domain | {is_proxied,is_pointed_to_github_pages_ip,is_https_eligible,responds_to_https,enforces_https,https_error,caa_error}'
~~~

只有 is_https_eligible=true 后才执行：

~~~sh
gh api --method PUT \
  -H 'Accept: application/vnd.github+json' \
  "/repos/$REPO/pages" \
  -F https_enforced=true
~~~

最后验证 HTTP 跳转：

~~~sh
/usr/bin/curl -I "http://$SITE_DOMAIN"
~~~

预期返回 301 或 308，并且 Location 为 https://$SITE_DOMAIN/。

## 常见故障

| 现象 | 处理 |
| --- | --- |
| tippy.js/dist/svg-arrow.css 找不到 | 保留 tippy.js 显式依赖并使用冻结安装 |
| pagefind: not found | 保留 pagefind 显式依赖并重新锁定依赖 |
| Wrangler 报 workerd 构建被忽略 | pnpm-workspace.yaml 保留 workerd: true |
| Worker 报 10089 | 在 Cloudflare 账户启用 Analytics Engine |
| Worker 返回 503 AI gateway is not configured | 重新写入 SPARK_API_PASSWORD |
| Pages 报 certificate not yet created | Pages DNS 改为 DNS-only，删除同主机额外记录，再重跑 /pages/health |
| Pages 构建成功但未部署 | 检查 pages: write、id-token: write 和 github-pages environment |

## AI 代理安全边界

- 先读取本文件、AGENTS.md、wrangler.jsonc 和 .github/workflows/deploy.yml。
- 不要把任何凭证写入文件、命令输出、提交信息或前端变量。
- 不要删除用户已有的未跟踪文件；无关改动不要加入提交。
- 先完成本地构建和 smoke test，再提交和推送。
- 每一步都用命令输出或线上请求验证，不能只报告“已部署”。
