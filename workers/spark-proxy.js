const MAX_REQUEST_CHARS = 48_000
const MAX_MESSAGES = 12
const MAX_MESSAGE_CHARS = 12_000
const MAX_TOTAL_MESSAGE_CHARS = 40_000
const UPSTREAM_TIMEOUT_MS = 60_000
const RATE_LIMIT = 12
// 遥测是无成本的轻量写入，与提问共用配额会让连点几次 👍/👎 就把提问额度耗尽
const TELEMETRY_RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const requestAttempts = new Map()

const UPSTREAM_PRESETS = {
    spark: {
        name: 'spark-primary',
        url: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
        model: 'generalv3.5',
    },
    siliconflow: {
        name: 'siliconflow',
        url: 'https://api.siliconflow.cn/v1/chat/completions',
        model: 'Qwen/Qwen2.5-7B-Instruct',
    },
    groq: {
        name: 'groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
    },
    zhipu: {
        name: 'zhipu',
        url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-4.7-flash',
        extra: { thinking: { type: 'disabled' } },
    },
    oaifree: {
        name: 'oaifree',
        url: 'https://hub.oaifree.com/v1/chat/completions',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
    },
    modelverse: {
        name: 'modelverse',
        url: 'https://api.modelverse.cn/v1/chat/completions',
        model: 'deepseek-v4.1-flash',
    },
}

function getAllowedOrigins(env) {
    return new Set(String(env.SPARK_ALLOWED_ORIGINS || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean))
}

function getOrigin(request) {
    return request.headers.get('Origin') || ''
}

function getClientKey(request) {
    return request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')?.split(',')[0].trim()
        || getOrigin(request)
}

function isRateLimited(request, bucket = 'chat', limit = RATE_LIMIT) {
    const now = Date.now()

    // 清理放在入口而非「新窗口」分支内：持续高频请求会一直命中已有窗口，
    // 原先的写法在真正需要清理的攻击场景下反而永远不会执行
    if (requestAttempts.size > 10_000) {
        for (const [storedKey, attempt] of requestAttempts) {
            if (now - attempt.startedAt >= RATE_WINDOW_MS)
                requestAttempts.delete(storedKey)
        }
    }

    // 按用途分桶，避免遥测与提问互相挤占配额
    const key = `${bucket}:${getClientKey(request)}`
    const previous = requestAttempts.get(key)
    if (!previous || now - previous.startedAt >= RATE_WINDOW_MS) {
        requestAttempts.set(key, { startedAt: now, count: 1 })
        return false
    }

    previous.count += 1
    return previous.count > limit
}

function json(body, status = 200, origin = '*') {
    return Response.json(body, {
        status,
        headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Cache-Control': 'no-store',
            'Vary': 'Origin',
            'X-Content-Type-Options': 'nosniff',
        },
    })
}

function noContent(origin) {
    return new Response(null, {
        status: 204,
        headers: withCors({}, origin),
    })
}

function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > MAX_MESSAGES)
        throw new TypeError('Invalid message list')

    let totalLength = 0
    for (const message of messages) {
        if (!message || !['system', 'user', 'assistant'].includes(message.role)
            || typeof message.content !== 'string'
            || message.content.length > MAX_MESSAGE_CHARS) {
            throw new TypeError('Invalid message content')
        }
        totalLength += message.content.length
    }

    if (messages.at(-1)?.role !== 'user' || totalLength > MAX_TOTAL_MESSAGE_CHARS)
        throw new TypeError('Invalid conversation shape')

    return messages.map(message => ({
        role: message.role,
        content: message.content,
    }))
}

function buildUpstreamRequest(env, payload, messages) {
    return {
        model: env.SPARK_MODEL || 'generalv3.5',
        messages,
        temperature: 0.2,
        max_tokens: 1024,
        stream: payload.stream === true,
    }
}

function hasOpenAIContent(text) {
    try {
        const payload = JSON.parse(text)
        if (payload.error)
            return false
        const content = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.delta?.content
        return typeof content === 'string' && content.trim().length > 0 && !isSoftErrorText(content)
    }
    catch {
        return false
    }
}

function hasOpenAIStreamContent(body) {
    let content = ''
    for (const line of String(body).split(/\r?\n/u)) {
        if (!line.startsWith('data:'))
            continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]')
            continue
        try {
            const payload = JSON.parse(data)
            if (payload.error || payload.code || payload.message && !payload.choices)
                return false
            const token = payload.choices?.[0]?.delta?.content ?? payload.choices?.[0]?.message?.content
            if (typeof token === 'string')
                content += token
        }
        catch {
            return false
        }
    }
    return content.trim().length > 0 && !isSoftErrorText(content)
}

// 上游可能用 HTTP 200 包装业务错误：渠道故障时把「参数错误」「Unauthorized」
// 之类的提示直接当成正文返回。这类响应若按正常答案透传，用户会把错误提示
// 误当成回答。只在正文很短且与已知错误提示完全一致时判定，避免误伤正常回答。
const SOFT_ERROR_TEXTS = new Set([
    '参数错误',
    '请求参数错误',
    '请求错误',
    'unauthorized',
    'invalid api key',
    'invalid request',
    'invalid parameter',
    'invalid params',
])

function isSoftErrorText(value) {
    const text = String(value || '').trim().replace(/[。.!！:：]+$/u, '').toLowerCase()
    if (!text || text.length > 40)
        return false
    return SOFT_ERROR_TEXTS.has(text)
}

function responseWithBody(response, body, origin) {
    return new Response(body, {
        status: response.status,
        headers: withCors({
            'Content-Type': response.headers.get('Content-Type') || 'application/json',
        }, origin),
    })
}

function withCors(headers, origin) {
    const result = new Headers(headers)
    result.set('Access-Control-Allow-Origin', origin)
    result.set('Access-Control-Allow-Headers', 'Content-Type')
    result.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    result.set('Cache-Control', 'no-store')
    result.set('Vary', 'Origin')
    result.set('X-Content-Type-Options', 'nosniff')
    return result
}

function passthrough(upstreamResponse, origin) {
    return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: withCors({
            'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
        }, origin),
    })
}

function getPreset(name) {
    return UPSTREAM_PRESETS[String(name || '').trim().toLowerCase()] || null
}

function resolveUpstream(options) {
    const preset = getPreset(options.preset)
    const url = String(options.url || preset?.url || '').trim()
    const password = String(options.password || '').trim()
    if (!url || !password)
        return null

    return {
        name: String(options.name || preset?.name || 'remote').trim() || 'remote',
        url,
        password,
        model: String(options.model || preset?.model || 'gpt-4o-mini').trim(),
        extra: preset?.extra && typeof preset.extra === 'object' ? preset.extra : {},
    }
}

function getUpstreams(env) {
    const fallbackPassword = env.SPARK_FALLBACK_API_PASSWORD
        || (env.SPARK_FALLBACK_REUSE_PRIMARY === 'true' ? env.SPARK_API_PASSWORD : '')

    return [
        resolveUpstream({
            preset: env.SPARK_PRIMARY_PRESET || 'spark',
            name: env.SPARK_PRIMARY_NAME,
            url: env.SPARK_OPENAI_URL,
            model: env.SPARK_MODEL,
            password: env.SPARK_API_PASSWORD,
        }),
        resolveUpstream({
            preset: env.SPARK_FALLBACK_PRESET,
            name: env.SPARK_FALLBACK_NAME,
            url: env.SPARK_FALLBACK_URL,
            model: env.SPARK_FALLBACK_MODEL,
            password: fallbackPassword,
        }),
    ].filter(Boolean)
}

function shouldFailover(status) {
    return status === 401 || status === 403 || status === 404
        || status === 408 || status === 409 || status >= 429
}

function isUnavailableModelError(text) {
    const sample = String(text || '').slice(0, 1_000).toLowerCase()
    return /model[_ ]?(not found|does not exist|invalid)|unknown model|no such model|invalid_model/.test(sample)
}

async function fetchUpstream(upstream, payload) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
    try {
        return await fetch(upstream.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${upstream.password}`,
                'Content-Type': 'application/json',
                'Accept': payload.stream ? 'text/event-stream' : 'application/json',
            },
            body: JSON.stringify({
                ...payload,
                ...upstream.extra,
                model: upstream.model,
            }),
            signal: controller.signal,
        })
    }
    finally {
        clearTimeout(timeout)
    }
}

function writeTelemetry(env, event) {
    if (!env.AI_TELEMETRY?.writeDataPoint)
        return

    try {
        env.AI_TELEMETRY.writeDataPoint({
            blobs: [event.event, event.provider || 'unknown', event.status || 'unknown', event.queryPreview || ''],
            doubles: [event.sourceCount || 0, event.topScore || 0, event.citedCount || 0, event.latencyMs || 0, event.rating || 0],
            indexes: [event.event],
        })
    }
    catch {
        // Telemetry must never affect the user-facing request.
    }
}

function clampNumber(value, min, max) {
    return typeof value === 'number' && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : 0
}

function redactTelemetryText(value) {
    const text = [...String(value || '')].filter((character) => {
        const code = character.codePointAt(0) || 0
        return !((code <= 31) || code === 127)
    }).join('')
    return text
        .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[email]')
        .replace(/https?:\/\/\S+/giu, '[url]')
        .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/gu, '[phone]')
        .replace(/(?<!\d)\d{6,}(?!\d)/gu, '[number]')
        .trim()
        .slice(0, 120)
}

async function handleTelemetry(request, env, origin) {
    if (request.method === 'OPTIONS')
        return noContent(origin)
    if (request.method !== 'POST')
        return json({ error: { message: 'Method not allowed', type: 'invalid_request_error' } }, 405, origin)
    if (isRateLimited(request, 'telemetry', TELEMETRY_RATE_LIMIT))
        return json({ error: { message: 'Too many requests', type: 'rate_limit_error' } }, 429, origin)

    try {
        const payload = await request.json()
        const event = typeof payload?.event === 'string' ? payload.event : ''
        if (!['answer', 'fallback', 'search_zero', 'feedback', 'input_blocked', 'gateway_response'].includes(event))
            throw new TypeError('Invalid telemetry event')

        writeTelemetry(env, {
            event,
            provider: typeof payload.provider === 'string' ? payload.provider.slice(0, 32) : 'openai',
            status: typeof payload.status === 'string' ? payload.status.slice(0, 16) : 'unknown',
            sourceCount: clampNumber(payload.sourceCount, 0, 8),
            topScore: clampNumber(payload.topScore, 0, 10_000),
            citedCount: clampNumber(payload.citedCount, 0, 8),
            latencyMs: clampNumber(payload.latencyMs, 0, 120_000),
            rating: clampNumber(payload.rating, -1, 1),
            queryPreview: redactTelemetryText(payload.queryPreview),
        })
        return json({ ok: true }, 202, origin)
    }
    catch (error) {
        return json({
            error: {
                message: error instanceof Error ? error.message : 'Invalid telemetry payload',
                type: 'invalid_request_error',
            },
        }, 400, origin)
    }
}

async function handleChatCompletion(request, env, origin) {
    if (request.method === 'OPTIONS')
        return noContent(origin)
    if (request.method !== 'POST')
        return json({ error: { message: 'Method not allowed', type: 'invalid_request_error' } }, 405, origin)
    if (isRateLimited(request))
        return json({ error: { message: 'Too many requests', type: 'rate_limit_error' } }, 429, origin)

    const upstreams = getUpstreams(env)
    if (!upstreams.length)
        return json({ error: { message: 'AI gateway is not configured', type: 'configuration_error' } }, 503, origin)

    let payload
    try {
        const rawBody = await request.text()
        if (rawBody.length > MAX_REQUEST_CHARS)
            throw new TypeError('Request body is too large')
        payload = JSON.parse(rawBody)
        if (!payload || typeof payload !== 'object' || Array.isArray(payload))
            throw new TypeError('Request body must be an object')
        const messages = validateMessages(payload.messages)
        payload = buildUpstreamRequest(env, payload, messages)
    }
    catch (error) {
        return json({
            error: {
                message: error instanceof Error ? error.message : 'Invalid request',
                type: 'invalid_request_error',
            },
        }, 400, origin)
    }

    const startedAt = Date.now()
    let lastError = 'Upstream request failed'
    for (const [index, upstream] of upstreams.entries()) {
        const last = index === upstreams.length - 1
        try {
            const upstreamResponse = await fetchUpstream(upstream, payload)
            writeTelemetry(env, {
                event: 'gateway_response',
                provider: upstream.name,
                status: String(upstreamResponse.status),
                latencyMs: Date.now() - startedAt,
            })

            if (upstreamResponse.ok) {
                const contentType = upstreamResponse.headers.get('Content-Type') || ''
                if (payload.stream === true) {
                    const firstBody = await upstreamResponse.text()
                    const firstValid = contentType.includes('text/event-stream')
                        ? hasOpenAIStreamContent(firstBody)
                        : hasOpenAIContent(firstBody)
                    if (firstValid)
                        return responseWithBody(upstreamResponse, firstBody, origin)

                    // 上游可能用 HTTP 200 包装鉴权错误（如讯飞 11200），或返回空 JSON；同源重试一次，仍失败则切备用
                    const retryResponse = await fetchUpstream(upstream, payload)
                    writeTelemetry(env, {
                        event: 'gateway_response',
                        provider: `${upstream.name}-retry`,
                        status: String(retryResponse.status),
                        latencyMs: Date.now() - startedAt,
                    })
                    if (retryResponse.ok) {
                        const retryType = retryResponse.headers.get('Content-Type') || ''
                        const retryBody = await retryResponse.text()
                        const retryValid = retryType.includes('text/event-stream')
                            ? hasOpenAIStreamContent(retryBody)
                            : hasOpenAIContent(retryBody)
                        if (retryValid)
                            return responseWithBody(retryResponse, retryBody, origin)
                    }
                    lastError = 'Upstream returned an empty or invalid streaming response'
                    if (!last)
                        continue
                    return json({ error: { message: lastError, type: 'upstream_error' } }, 502, origin)
                }
                // 非流式同样可能被 HTTP 200 包装软错误（渠道故障时把「参数错误」当正文）
                const body = await upstreamResponse.text()
                if (!hasOpenAIContent(body)) {
                    lastError = 'Upstream returned an invalid response'
                    if (!last)
                        continue
                    return json({ error: { message: lastError, type: 'upstream_error' } }, 502, origin)
                }
                return responseWithBody(upstreamResponse, body, origin)
            }

            if (!last && shouldFailover(upstreamResponse.status)) {
                lastError = `Upstream returned HTTP ${upstreamResponse.status}`
                continue
            }

            if (!last && upstreamResponse.status === 400) {
                const text = await upstreamResponse.text()
                if (isUnavailableModelError(text)) {
                    lastError = 'Upstream model unavailable'
                    continue
                }
                return new Response(text, {
                    status: 400,
                    headers: withCors({
                        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
                    }, origin),
                })
            }

            return passthrough(upstreamResponse, origin)
        }
        catch (error) {
            lastError = error?.name === 'AbortError' ? 'Upstream request timed out' : 'Upstream request failed'
            writeTelemetry(env, {
                event: 'gateway_response',
                provider: upstream.name,
                status: '502',
                latencyMs: Date.now() - startedAt,
            })
        }
    }
    return json({ error: { message: lastError, type: 'upstream_error' } }, 502, origin)
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.pathname === '/health' && request.method === 'GET') {
            const upstreams = getUpstreams(env)
            return json({
                status: 'ok',
                fallbackConfigured: upstreams.length > 1,
                upstreams: upstreams.map(item => item.name),
            })
        }

        const origin = getOrigin(request)
        if (!getAllowedOrigins(env).has(origin))
            return json({ error: { message: 'Origin not allowed', type: 'forbidden' } }, 403, 'null')

        if (url.pathname === '/v1/chat/completions')
            return handleChatCompletion(request, env, origin)

        if (url.pathname === '/telemetry')
            return handleTelemetry(request, env, origin)

        return json({ error: { message: 'Not found', type: 'invalid_request_error' } }, 404, origin)
    },
}
