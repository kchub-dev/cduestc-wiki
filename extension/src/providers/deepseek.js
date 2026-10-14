// DeepSeek 网页版适配器（chat.deepseek.com，非官方接口）。
//
// 认证链路：浏览器里的 userToken（由 content-deepseek.js 从登录页
// localStorage 读取，或直接读 cookie）-> Bearer 调 /api/v0/users/current
// 换取短期 accessToken（约 1 小时）-> 会话 / PoW / 补全都用 accessToken。
//
// PoW：服务端下发 {challenge, salt, expire_at, difficulty}，需要找到 nonce
// 使 DeepSeekHashV1(`${salt}_${expire_at}_${nonce}`) 与 challenge 完全相等，
// 答案连同原始参数 base64 后放进 X-Ds-PoW-Response 请求头。
//
// ⚠️ 这是逆向出来的私有接口，DeepSeek 改版就可能失效。字段或报错行为有变化
// 时，优先核对本文件的常量与响应解析，参考 extension/README.md 的维护指南。

import { solveDeepSeekChallenge } from '../deepseek-hash.js'
import { readSSE } from '../sse.js'

const BASE_URL = 'https://chat.deepseek.com'
const API_BASE = `${BASE_URL}/api/v0`

// 与真实网页客户端一致的基本请求头（见官方 2.0.0 web build 抓包）。
// Cookie / UA / Origin 由浏览器自动附带，不在这里伪造。
const BASE_HEADERS = {
    'Accept': '*/*',
    'X-Client-Bundle-Id': 'com.deepseek.chat',
    'X-Client-Platform': 'web',
    'X-Client-Version': '2.0.0',
}

// userToken -> accessToken 缓存（accessToken 有效期约 1 小时）
let cachedAccessToken = null
let cachedAccessTokenExpireAt = 0

async function fetchJSON(path, { method = 'GET', body, accessToken, signal } = {}) {
    const headers = { ...BASE_HEADERS, 'Content-Type': 'application/json' }
    if (accessToken)
        headers.Authorization = `Bearer ${accessToken}`
    const response = await fetch(`${API_BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        signal,
    })
    if (response.status === 401 || response.status === 403)
        throw new Error('DeepSeek 登录已失效，请重新登录 chat.deepseek.com 后重试')
    if (!response.ok)
        throw new Error(['DeepSeek 接口 HTTP', response.status].join(' '))
    const data = await response.json()
    if (data && typeof data.code === 'number' && data.code !== 0) {
        const detail = data.msg || data.data?.biz_msg || '未知错误'
        throw new Error(['DeepSeek 接口错误', data.code, detail].join(': '))
    }
    return data
}

function pickBizData(payload) {
    return payload?.data?.biz_data ?? payload?.biz_data
}

/** 读取浏览器里的 userToken：优先 storage.session（content 脚本上报），兜底 cookie。 */
async function getUserToken() {
    try {
        const stored = await chrome.storage.session.get('dsUserToken')
        if (stored?.dsUserToken)
            return stored.dsUserToken
    }
    catch {
        // storage.session 不可用时走 cookie 兜底
    }

    try {
        const cookie = await chrome.cookies.get({ url: BASE_URL, name: 'userToken' })
        if (cookie?.value)
            return normalizeUserToken(cookie.value)
    }
    catch {
        // cookies 权限异常时按未登录处理
    }
    return null
}

// localStorage 里可能存成 {"value":"..."} 的 JSON 包裹
function normalizeUserToken(raw) {
    try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed.value === 'string')
            return parsed.value
    }
    catch {
        // 普通字符串 token
    }
    return raw
}

async function getAccessToken(signal) {
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpireAt)
        return cachedAccessToken

    const userToken = await getUserToken()
    if (!userToken)
        throw new Error('未找到 DeepSeek 登录凭证，请先在当前浏览器登录 chat.deepseek.com（登录后打开任意一次 DeepSeek 页面即可）')

    const payload = await fetchJSON('/users/current', { accessToken: userToken, signal })
    const token = pickBizData(payload)?.token
    if (!token)
        throw new Error('DeepSeek 未返回 accessToken，请重新登录后重试')
    cachedAccessToken = token
    cachedAccessTokenExpireAt = Date.now() + 55 * 60 * 1000
    return token
}

async function createChatSession(accessToken, signal) {
    const payload = await fetchJSON('/chat_session/create', {
        method: 'POST',
        body: {},
        accessToken,
        signal,
    })
    const biz = pickBizData(payload) || {}
    const sessionId = biz.id || biz.chat_session?.id
    if (!sessionId)
        throw new Error('DeepSeek 会话创建失败：响应中没有会话 ID')
    return sessionId
}

async function deleteChatSession(accessToken, sessionId) {
    try {
        await fetchJSON('/chat_session/delete', {
            method: 'POST',
            body: { chat_session_id: sessionId },
            accessToken,
        })
    }
    catch {
        // 清理失败不影响主流程（会话会留在用户的 DeepSeek 列表里）
    }
}

async function requestPowChallenge(accessToken, signal) {
    const payload = await fetchJSON('/chat/create_pow_challenge', {
        method: 'POST',
        body: { target_path: '/api/v0/chat/completion' },
        accessToken,
        signal,
    })
    const challenge = pickBizData(payload)?.challenge
    if (!challenge?.challenge)
        throw new Error('DeepSeek 未下发 PoW 挑战')
    return challenge
}

function buildPowHeader(challenge) {
    const answer = solveDeepSeekChallenge(challenge)
    const payload = {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        answer,
        signature: challenge.signature,
        target_path: challenge.target_path,
    }
    // TextEncoder -> base64（service worker 可用 btoa）
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    let binary = ''
    for (const byte of bytes)
        binary += String.fromCharCode(byte)
    return btoa(binary)
}

/**
 * 发起一次对话补全。
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages OpenAI 风格消息
 * @param {boolean} [options.thinking] 是否开启深度思考（R1 风格）
 * @param {(text: string) => void} [options.onDelta] 正文增量回调
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} 完整正文
 */
export async function deepseekChat({ messages, thinking = false, onDelta, signal }) {
    const accessToken = await getAccessToken(signal)
    const sessionId = await createChatSession(accessToken, signal)

    try {
        const challenge = await requestPowChallenge(accessToken, signal)
        const powHeader = buildPowHeader(challenge)

        // 多轮对话压平成一段 prompt（上游没有暴露完整对话结构）
        const prompt = messages
            .map((message) => {
                if (message.role === 'system')
                    return message.content
                return [message.role === 'assistant' ? 'Assistant' : 'User', message.content].join(': ')
            })
            .join('\n\n')

        const response = await fetch(`${API_BASE}/chat/completion`, {
            method: 'POST',
            headers: {
                ...BASE_HEADERS,
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'X-Ds-PoW-Response': powHeader,
            },
            body: JSON.stringify({
                chat_session_id: sessionId,
                parent_message_id: null,
                model_type: 'default',
                prompt,
                ref_file_ids: [],
                thinking_enabled: Boolean(thinking),
                search_enabled: false,
                preempt: false,
            }),
            credentials: 'include',
            signal,
        })

        if (response.status === 401 || response.status === 403)
            throw new Error('DeepSeek 登录已失效，请重新登录 chat.deepseek.com 后重试')
        if (!response.ok)
            throw new Error(['DeepSeek 补全接口 HTTP', response.status].join(' '))

        return await consumeCompletionStream(response, onDelta)
    }
    finally {
        deleteChatSession(accessToken, sessionId)
    }
}

// SSE 片段格式：data: {"p":"response/fragments","o":"APPEND","v":[{type,content}]}
// THINK 片段是思考过程（忽略），ANSWER / RESPONSE 是正文。
async function consumeCompletionStream(response, onDelta) {
    let content = ''

    await readSSE(response, (payload) => {
        if (payload === '[DONE]')
            return
        let data
        try {
            data = JSON.parse(payload)
        }
        catch {
            return
        }
        if (data && typeof data.code === 'number' && data.code !== 0) {
            const detail = data.msg || '未知错误'
            throw new Error(['DeepSeek 回答失败', data.code, detail].join(': '))
        }

        const { p, v } = data
        if (p === 'response/fragments' && v) {
            const fragments = Array.isArray(v) ? v : [v]
            for (const fragment of fragments) {
                const type = String(fragment?.type || '').toUpperCase()
                if (type !== 'ANSWER' && type !== 'RESPONSE')
                    continue
                appendDelta(fragment.content)
            }
            return
        }
        // 其余形如 {"p":"response/thinking_content","o":"APPEND","v":"..."} 的
        // 字符串增量：思考内容不展示，正文增量透传。
        if (typeof v === 'string' && !String(p || '').includes('thinking'))
            appendDelta(v)
    })

    function appendDelta(text) {
        if (typeof text !== 'string' || !text)
            return
        content += text
        onDelta?.(text)
    }

    return content
}

export const deepseekProvider = {
    id: 'deepseek',
    label: 'DeepSeek',
    chat: deepseekChat,
    async checkAuth() {
        const token = await getUserToken()
        return {
            ok: Boolean(token),
            message: token
                ? '已登录'
                : '未找到登录凭证：请先登录 chat.deepseek.com（登录后打开一次它的页面即可）',
        }
    },
}
