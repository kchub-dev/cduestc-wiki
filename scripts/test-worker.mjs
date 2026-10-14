import assert from 'node:assert/strict'
import worker from '../workers/spark-proxy.js'
import { normalizeChatCompletionsUrl, resolvePreset } from './switch-ai-upstream.mjs'
import { modelsEndpoint, recommendChatModel } from './ai-upstream-models.mjs'

const originalFetch = globalThis.fetch
const origin = 'https://wiki.kcos.club'
const headers = { 'Origin': origin, 'Content-Type': 'application/json' }
let calls = 0
const capturedRequests = []
// 每次请求使用不同的 CF-Connecting-IP：Worker 按客户端限流（12 次/分钟），
// 测试里的连续请求应模拟不同访客，否则会被限流挡住而不是走到被测逻辑。
let clientIpSeq = 0

function chatRequest(body = { messages: [{ role: 'user', content: '你好' }] }) {
    clientIpSeq += 1
    return new Request('https://spark-api.kcos.club/v1/chat/completions', {
        method: 'POST',
        headers: { ...headers, 'CF-Connecting-IP': `203.0.113.${clientIpSeq % 250}` },
        body: JSON.stringify(body),
    })
}

try {
    globalThis.fetch = async (url, options) => {
        calls++
        const request = JSON.parse(options.body)
        capturedRequests.push({ url, options, request })
        if (request.stream && url.includes('primary-sse-error')) {
            const body = 'data: {"code":11200,"message":"AppIdNoAuthError"}\n\ndata: [DONE]\n\n'
            return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        if (request.stream && url.includes('primary-empty-stream'))
            return new Response(JSON.stringify({ content: [{ text: '' }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        // 渠道故障时上游用 HTTP 200 把「参数错误」当正文返回（真实观测到的行为）
        if (request.stream && url.includes('primary-soft-error-stream')) {
            const body = 'data: {"choices":[{"delta":{"content":"参数错误"},"finish_reason":null}]}\n\ndata: [DONE]\n\n'
            return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        if (!request.stream && url.includes('primary-soft-error-json'))
            return new Response(JSON.stringify({ choices: [{ message: { content: '参数错误' } }] }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        // 正常回答里提到「参数错误」这个词（长文本解释），不应被软错误判定误伤
        if (url.includes('primary-long-answer-with-phrase'))
            return new Response(JSON.stringify({
                choices: [{ message: { content: '选课系统如果弹出「参数错误」，通常是因为你选择的课程已经满员，建议换一个时间段再试。' } }],
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            })
        if (request.stream) {
            const body = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\ndata: [DONE]\n\n'
            return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
        }
        if (url.includes('primary-401'))
            return new Response(JSON.stringify({ error: { message: 'unauthorized' } }), { status: 401 })
        if (url.includes('primary-400-model'))
            return new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 400 })
        if (url.includes('primary-400-shape'))
            return new Response(JSON.stringify({ error: { message: 'invalid json schema' } }), { status: 400 })
        if (calls === 1 && url.includes('spark-api-open.xf-yun.com'))
            return new Response(JSON.stringify({ error: { message: 'primary unavailable' } }), { status: 503 })
        return new Response(JSON.stringify({ choices: [{ message: { content: 'fallback' } }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })
    }

    const env = {
        SPARK_API_PASSWORD: 'test-primary',
        SPARK_ALLOWED_ORIGINS: origin,
        SPARK_FALLBACK_URL: 'https://fallback.example/v1/chat/completions',
        SPARK_FALLBACK_API_PASSWORD: 'test-fallback',
        SPARK_FALLBACK_NAME: 'test-fallback',
        SPARK_FALLBACK_MODEL: 'test-model',
    }
    const health = await worker.fetch(new Request('https://spark-api.kcos.club/health'), env)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), {
        status: 'ok',
        fallbackConfigured: true,
        upstreams: ['spark-primary', 'test-fallback'],
    })

    const preflight = await worker.fetch(new Request('https://spark-api.kcos.club/v1/chat/completions', {
        method: 'OPTIONS',
        headers: {
            'Origin': origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    }), env)
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin)
    assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS')
    assert.equal(await preflight.text(), '')

    const forbidden = await worker.fetch(new Request('https://spark-api.kcos.club/telemetry', {
        method: 'POST',
        headers: { ...headers, Origin: 'https://evil.example' },
        body: JSON.stringify({ event: 'feedback' }),
    }), env)
    assert.equal(forbidden.status, 403)

    const invalid = await worker.fetch(chatRequest({ messages: [] }), env)
    assert.equal(invalid.status, 400)

    const telemetry = await worker.fetch(new Request('https://spark-api.kcos.club/telemetry', {
        method: 'POST',
        headers,
        body: JSON.stringify({ event: 'search_zero', queryPreview: '校园网怎么连接 13800138000', rating: 1 }),
    }), env)
    assert.equal(telemetry.status, 202)

    calls = 0
    capturedRequests.length = 0
    const stream = await worker.fetch(chatRequest({
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
    }), env)
    assert.equal(stream.status, 200)
    assert.match(await stream.text(), /data: \[DONE\]/)

    calls = 0
    capturedRequests.length = 0
    const sseErrorFallback = await worker.fetch(chatRequest({
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
    }), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-sse-error.example/v1/chat/completions',
    })
    assert.equal(sseErrorFallback.status, 200)
    assert.match(await sseErrorFallback.text(), /data: \[DONE\]/)
    assert.equal(calls, 3)
    assert.equal(capturedRequests[2].url, env.SPARK_FALLBACK_URL)

    calls = 0
    capturedRequests.length = 0
    const emptyStreamFallback = await worker.fetch(chatRequest({
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
    }), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-empty-stream.example/v1/chat/completions',
    })
    assert.equal(emptyStreamFallback.status, 200)
    assert.match(await emptyStreamFallback.text(), /data: \[DONE\]/)
    assert.equal(calls, 3)
    assert.equal(capturedRequests[0].url, 'https://primary-empty-stream.example/v1/chat/completions')
    assert.equal(capturedRequests[1].url, 'https://primary-empty-stream.example/v1/chat/completions')
    assert.equal(capturedRequests[2].url, env.SPARK_FALLBACK_URL)

    // HTTP 200 包装的「参数错误」正文必须触发故障转移，而不是当成正常回答透传
    calls = 0
    capturedRequests.length = 0
    const softErrorStreamFallback = await worker.fetch(chatRequest({
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
    }), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-soft-error-stream.example/v1/chat/completions',
    })
    assert.equal(softErrorStreamFallback.status, 200)
    assert.doesNotMatch(await softErrorStreamFallback.clone().text(), /参数错误/)
    assert.equal(calls, 3)
    assert.equal(capturedRequests[2].url, env.SPARK_FALLBACK_URL)

    calls = 0
    capturedRequests.length = 0
    const softErrorJsonFallback = await worker.fetch(chatRequest({
        messages: [{ role: 'user', content: '你好' }],
    }), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-soft-error-json.example/v1/chat/completions',
    })
    assert.equal(softErrorJsonFallback.status, 200)
    assert.doesNotMatch(await softErrorJsonFallback.clone().text(), /参数错误/)

    // 正常回答里出现「参数错误」四个字（如解释报错含义）不应被误判为软错误
    calls = 0
    capturedRequests.length = 0
    const longAnswer = await worker.fetch(chatRequest(), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-long-answer-with-phrase.example/v1/chat/completions',
    })
    assert.equal(longAnswer.status, 200)
    assert.match(await longAnswer.clone().text(), /选课系统/)
    assert.equal(calls, 1)

    calls = 0
    capturedRequests.length = 0
    const fallback = await worker.fetch(chatRequest(), env)
    assert.equal(fallback.status, 200)
    assert.equal(calls, 2)
    assert.equal(capturedRequests[1].url, env.SPARK_FALLBACK_URL)
    assert.equal(capturedRequests[1].request.model, env.SPARK_FALLBACK_MODEL)
    assert.equal(capturedRequests[1].options.headers.Authorization, 'Bearer test-fallback')

    calls = 0
    capturedRequests.length = 0
    const unauthorized = await worker.fetch(chatRequest(), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-401.example/v1/chat/completions',
    })
    assert.equal(unauthorized.status, 200)
    assert.equal(calls, 2)

    calls = 0
    capturedRequests.length = 0
    const missingModel = await worker.fetch(chatRequest(), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-400-model.example/v1/chat/completions',
    })
    assert.equal(missingModel.status, 200)
    assert.equal(calls, 2)

    calls = 0
    capturedRequests.length = 0
    const badRequest = await worker.fetch(chatRequest(), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-400-shape.example/v1/chat/completions',
    })
    assert.equal(badRequest.status, 400)
    assert.equal(calls, 1)

    const unconfigured = await worker.fetch(chatRequest(), { SPARK_ALLOWED_ORIGINS: origin })
    assert.equal(unconfigured.status, 503)

    calls = 0
    capturedRequests.length = 0
    const fallbackOnly = await worker.fetch(chatRequest(), {
        SPARK_ALLOWED_ORIGINS: origin,
        SPARK_FALLBACK_PRESET: 'siliconflow',
        SPARK_FALLBACK_API_PASSWORD: 'sf-key',
        SPARK_FALLBACK_NAME: 'siliconflow',
    })
    assert.equal(fallbackOnly.status, 200)
    assert.equal(calls, 1)
    assert.equal(capturedRequests[0].url, 'https://api.siliconflow.cn/v1/chat/completions')
    assert.equal(capturedRequests[0].request.model, 'Qwen/Qwen2.5-7B-Instruct')
    assert.equal(capturedRequests[0].options.headers.Authorization, 'Bearer sf-key')

    calls = 0
    capturedRequests.length = 0
    const zhipu = await worker.fetch(chatRequest(), {
        SPARK_ALLOWED_ORIGINS: origin,
        SPARK_FALLBACK_PRESET: 'zhipu',
        SPARK_FALLBACK_API_PASSWORD: 'zhipu-key',
    })
    assert.equal(zhipu.status, 200)
    assert.equal(capturedRequests[0].url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
    assert.equal(capturedRequests[0].request.model, 'glm-4.7-flash')
    assert.deepEqual(capturedRequests[0].request.thinking, { type: 'disabled' })

    // modelverse：备用槽指向单模型白名单上游，主上游 401 时自动接管（非流式）
    calls = 0
    capturedRequests.length = 0
    const modelverseFailover = await worker.fetch(chatRequest(), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-401.example/v1/chat/completions',
        SPARK_FALLBACK_PRESET: 'modelverse',
        SPARK_FALLBACK_API_PASSWORD: 'modelverse-test-key',
        SPARK_FALLBACK_NAME: 'modelverse',
        SPARK_FALLBACK_URL: 'https://api.modelverse.cn/v1/chat/completions',
        SPARK_FALLBACK_MODEL: 'deepseek-v4.1-flash',
    })
    assert.equal(modelverseFailover.status, 200)
    assert.equal(calls, 2)
    assert.equal(capturedRequests[1].url, 'https://api.modelverse.cn/v1/chat/completions')
    assert.equal(capturedRequests[1].request.model, 'deepseek-v4.1-flash')
    assert.equal(capturedRequests[1].options.headers.Authorization, 'Bearer modelverse-test-key')

    // 流式路径：主上游 SSE 软错误 → 同源重试一次 → 备用接管
    calls = 0
    capturedRequests.length = 0
    const modelverseStreamFailover = await worker.fetch(chatRequest({
        messages: [{ role: 'user', content: '你好' }],
        stream: true,
    }), {
        ...env,
        SPARK_OPENAI_URL: 'https://primary-sse-error.example/v1/chat/completions',
        SPARK_FALLBACK_PRESET: 'modelverse',
        SPARK_FALLBACK_API_PASSWORD: 'modelverse-test-key',
        SPARK_FALLBACK_NAME: 'modelverse',
        SPARK_FALLBACK_URL: 'https://api.modelverse.cn/v1/chat/completions',
        SPARK_FALLBACK_MODEL: 'deepseek-v4.1-flash',
    })
    assert.equal(modelverseStreamFailover.status, 200)
    assert.match(await modelverseStreamFailover.text(), /data: \[DONE\]/)
    assert.equal(calls, 3)
    assert.equal(capturedRequests[2].url, 'https://api.modelverse.cn/v1/chat/completions')

    assert.equal(
        normalizeChatCompletionsUrl('https://api.siliconflow.cn/v1'),
        'https://api.siliconflow.cn/v1/chat/completions',
    )
    assert.equal(resolvePreset('groq').model, 'llama-3.3-70b-versatile')
    assert.equal(resolvePreset('modelverse').url, 'https://api.modelverse.cn/v1/chat/completions')
    assert.equal(resolvePreset('modelverse').model, 'deepseek-v4.1-flash')
    assert.equal(modelsEndpoint('https://api.groq.com/openai/v1'), 'https://api.groq.com/openai/v1/models')
    assert.equal(recommendChatModel(['whisper-large-v3', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile']), 'llama-3.3-70b-versatile')
    assert.equal(recommendChatModel(['glm-4.5', 'glm-4.6', 'glm-5.3-flash', 'glm-5.3-flashx']), 'glm-5.3-flash')

    console.log('[test-worker] health, CORS, validation, telemetry, SSE, failover, and free-upstream presets passed')
}
finally {
    globalThis.fetch = originalFetch
}
