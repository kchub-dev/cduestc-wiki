// 豆包网页版适配器（www.doubao.com，非官方接口）。
//
// 认证：完全依赖浏览器里已登录的 cookie（sessionid 等），请求用
// credentials: 'include' 自动携带。查询串里的 msToken / a_bogus 按社区
// 已验证的方式使用随机假值即可通过。
//
// 对话：把多轮消息压平成一条 <|im_start|> 标记文本（content_type 2001），
// 服务端自动创建会话；流式事件 event_type 2001 为增量、2003 为结束；
// 回答结束后调 thread/delete 清理会话，避免污染用户的豆包历史列表。
//
// ⚠️ 这是逆向出来的私有接口，豆包改版就可能失效。字段或报错行为有变化时，
// 优先核对本文件的常量与响应解析，参考 extension/README.md 的维护指南。

import { readSSE } from '../sse.js'

const BASE_URL = 'https://www.doubao.com'

// 官方网页客户端参数快照（社区抓包，2025 年末可用）
const DEFAULT_ASSISTANT_ID = '497858'
const VERSION_CODE = '20800'
const PC_VERSION = '2.44.0'

const BASE_HEADERS = {
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
}

let cachedDeviceId = null
let cachedWebId = null

function randomUUID() {
    return crypto.randomUUID()
}

function randomDigits(length) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    let text = ''
    for (const byte of bytes)
        text += String(byte % 10)
    return text
}

function randomBase64Url(length) {
    const bytes = new Uint8Array(length)
    crypto.getRandomValues(bytes)
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')
}

// 假 a_bogus：官方签名参数的占位形式，社区验证可过
function fakeABogus() {
    const alphabet = 'abcdef0123456789'
    const bytes = new Uint8Array(40)
    crypto.getRandomValues(bytes)
    const pick = length => Array.from({ length }, (_, index) =>
        alphabet[bytes[index] % alphabet.length]).join('')
    return ['mf', pick(34), pick(6)].join('-')
}

async function getDeviceIds() {
    if (cachedDeviceId && cachedWebId)
        return { deviceId: cachedDeviceId, webId: cachedWebId }
    try {
        const stored = await chrome.storage.local.get(['dbDeviceId', 'dbWebId'])
        if (stored?.dbDeviceId && stored?.dbWebId) {
            cachedDeviceId = stored.dbDeviceId
            cachedWebId = stored.dbWebId
            return { deviceId: cachedDeviceId, webId: cachedWebId }
        }
    }
    catch {
        // storage 不可用则每次临时生成
    }
    cachedDeviceId = `7${randomDigits(18)}`
    cachedWebId = `7${randomDigits(18)}`
    try {
        await chrome.storage.local.set({ dbDeviceId: cachedDeviceId, dbWebId: cachedWebId })
    }
    catch {
        // 持久化失败无碍，内存里已有
    }
    return { deviceId: cachedDeviceId, webId: cachedWebId }
}

function buildCommonParams({ deviceId, webId }) {
    const params = new URLSearchParams({
        'aid': DEFAULT_ASSISTANT_ID,
        'device_id': deviceId,
        'device_platform': 'web',
        'language': 'zh',
        'pc_version': PC_VERSION,
        'pkg_type': 'release_version',
        'real_aid': DEFAULT_ASSISTANT_ID,
        'region': 'CN',
        'samantha_web': '1',
        'sys_region': 'CN',
        'tea_uuid': webId,
        'use-olympus-account': '1',
        'version_code': VERSION_CODE,
        'web_id': webId,
        'web_tab_id': randomUUID(),
        'msToken': randomBase64Url(96),
        'a_bogus': fakeABogus(),
    })
    return params.toString()
}

async function requestDoubao(path, { method = 'POST', body, headers, signal } = {}) {
    const { deviceId, webId } = await getDeviceIds()
    const url = `${BASE_URL}${path}?${buildCommonParams({ deviceId, webId })}`
    const response = await fetch(url, {
        method,
        headers: { ...BASE_HEADERS, 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'include',
        signal,
    })
    if (response.status === 401 || response.status === 403)
        throw new Error('豆包登录已失效，请重新登录 www.doubao.com 后重试')
    return response
}

/**
 * 发起一次对话补全。
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages OpenAI 风格消息
 * @param {(text: string) => void} [options.onDelta] 正文增量回调
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} 完整正文
 */
export async function doubaoChat({ messages, onDelta, signal }) {
    // 上游没有对话结构，按官方网页格式压平成一条 <|im_start|> 文本
    const text = messages.map((message) => {
        const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user'
        return `<|im_start|>${role}\n${message.content}\n<|im_end|>`
    }).join('\n')

    const response = await requestDoubao('/samantha/chat/completion', {
        headers: {
            'Referer': `${BASE_URL}/chat/`,
            'agw-js-conv': 'str, str',
            'X-Flow-Trace': ['04', randomUUID(), randomUUID().slice(0, 16), '01'].join('-'),
        },
        body: {
            messages: [{
                content: JSON.stringify({ text }),
                content_type: 2001,
                attachments: [],
                references: [],
            }],
            completion_option: {
                is_regen: false,
                with_suggest: false,
                need_create_conversation: true,
                launch_stage: 1,
                is_replace: false,
                is_delete: false,
                message_from: 0,
                action_bar_skill_id: 0,
                use_deep_think: false,
                use_auto_cot: false,
                resend_for_regen: false,
                enable_commerce_credit: false,
                event_id: '0',
            },
            evaluate_option: { web_ab_params: '' },
            section_id: `26${randomDigits(16)}`,
            conversation_id: '0',
            local_conversation_id: `local_16${randomDigits(14)}`,
            local_message_id: randomUUID(),
        },
        signal,
    })

    if (!response.ok)
        throw new Error(['豆包补全接口 HTTP', response.status].join(' '))

    const contentType = response.headers.get('Content-Type') || ''
    if (!contentType.includes('text/event-stream')) {
        // 非 SSE 通常意味着 JSON 错误体（未登录、风控等）
        let detail = ''
        try {
            const payload = await response.json()
            detail = payload?.message || payload?.msg || ''
        }
        catch {
            // 无 JSON 体
        }
        throw new Error(['豆包返回了非流式响应（可能未登录或被风控）', contentType, detail].filter(Boolean).join(' | '))
    }

    const { content, conversationId } = await consumeCompletionStream(response, onDelta)
    if (conversationId)
        deleteConversation(conversationId)
    return content
}

// SSE 事件：{code?, event_type, event_data} — 2001 增量 / 2003 结束；
// event_data 是一层 JSON 字符串，正文在 message.content（可能是 {text} /
// {delta:{text}} / {content} / 纯文本四种形态）。
async function consumeCompletionStream(response, onDelta) {
    let content = ''
    let conversationId = ''
    let finished = false

    await readSSE(response, (payload) => {
        if (!payload || finished)
            return
        let event
        try {
            event = JSON.parse(payload)
        }
        catch {
            return
        }
        if (event && typeof event.code === 'number' && event.code !== 0) {
            const detail = event.message || '未知错误'
            throw new Error(['豆包回答失败', event.code, detail].join(': '))
        }
        if (event.event_type === 2003) {
            finished = true
            return
        }
        if (event.event_type !== 2001)
            return

        let result
        try {
            result = JSON.parse(event.event_data)
        }
        catch {
            return
        }
        if (result.is_finish) {
            finished = true
            return
        }
        if (!conversationId && result.conversation_id)
            conversationId = result.conversation_id

        const message = result.message
        if (!message?.content)
            return

        let text = ''
        try {
            const parsed = JSON.parse(message.content)
            if (typeof parsed === 'string')
                text = parsed
            else if (typeof parsed?.text === 'string')
                text = parsed.text
            else if (typeof parsed?.delta?.text === 'string')
                text = parsed.delta.text
            else if (typeof parsed?.content === 'string')
                text = parsed.content
        }
        catch {
            text = message.content
        }

        if (text) {
            content += text
            onDelta?.(text)
        }
    })

    return { content, conversationId }
}

// 回答结束后删除会话，避免在用户的豆包历史里留下大量一次性对话
async function deleteConversation(conversationId) {
    try {
        await requestDoubao('/samantha/thread/delete', {
            body: { conversation_id: conversationId },
            headers: {
                'Referer': `${BASE_URL}/chat/${conversationId}`,
                'agw-js-conv': 'str',
            },
        })
    }
    catch {
        // 清理失败不影响主流程
    }
}

export const doubaoProvider = {
    id: 'doubao',
    label: '豆包',
    chat: doubaoChat,
    async checkAuth() {
        try {
            const cookie = await chrome.cookies.get({ url: BASE_URL, name: 'sessionid' })
            return {
                ok: Boolean(cookie?.value),
                message: cookie?.value ? '已登录' : '未找到 sessionid，请先登录 www.doubao.com',
            }
        }
        catch {
            return { ok: false, message: '无法读取 cookie，请检查扩展权限' }
        }
    },
}
