const MAX_REQUEST_CHARS = 48_000
const MAX_MESSAGES = 12
const MAX_MESSAGE_CHARS = 12_000
const MAX_TOTAL_MESSAGE_CHARS = 40_000
const UPSTREAM_TIMEOUT_MS = 35_000
const RATE_LIMIT = 12
// 遥测是无成本的轻量写入，与提问共用配额会让连点几次 👍/👎 就把提问额度耗尽
const TELEMETRY_RATE_LIMIT = 60
const RATE_WINDOW_MS = 60_000
const requestAttempts = new Map()

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

function getUpstreams(env) {
    const upstreams = [
        {
            name: 'spark-primary',
            url: env.SPARK_OPENAI_URL || 'https://spark-api-open.xf-yun.com/v1/chat/completions',
            password: env.SPARK_API_PASSWORD,
            model: env.SPARK_MODEL || 'generalv3.5',
        },
    ]
    if (env.SPARK_FALLBACK_URL && (env.SPARK_FALLBACK_API_PASSWORD || env.SPARK_API_PASSWORD)) {
        upstreams.push({
            name: 'spark-x2-fallback',
            url: env.SPARK_FALLBACK_URL,
            password: env.SPARK_FALLBACK_API_PASSWORD || env.SPARK_API_PASSWORD,
            model: env.SPARK_FALLBACK_MODEL || 'gpt-4o-mini',
        })
    }
    return upstreams
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
            body: JSON.stringify({ ...payload, model: upstream.model }),
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
    if (!env.SPARK_API_PASSWORD)
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
    const upstreams = getUpstreams(env)
    for (const [index, upstream] of upstreams.entries()) {
        try {
            const upstreamResponse = await fetchUpstream(upstream, payload)
            writeTelemetry(env, {
                event: 'gateway_response',
                provider: upstream.name,
                status: String(upstreamResponse.status),
                latencyMs: Date.now() - startedAt,
            })

            if (upstreamResponse.ok || upstreamResponse.status < 429 || index === upstreams.length - 1) {
                return new Response(upstreamResponse.body, {
                    status: upstreamResponse.status,
                    headers: withCors({
                        'Content-Type': upstreamResponse.headers.get('Content-Type') || 'application/json',
                    }, origin),
                })
            }
            lastError = `Upstream returned HTTP ${upstreamResponse.status}`
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
        if (url.pathname === '/health' && request.method === 'GET')
            return json({ status: 'ok', fallbackConfigured: getUpstreams(env).length > 1 })

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
