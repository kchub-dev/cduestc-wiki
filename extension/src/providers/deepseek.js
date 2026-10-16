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

// DeepSeek 通道页：userToken 由该页面的 content 脚本上报（storage.session）。
// 凭证缺失时在隐藏的最小化窗口里静默打开一次，拿到凭证后立即关闭窗口。
const DS_CHANNEL_TAB_URL = `${BASE_URL}/`
const DS_CHANNEL_WAIT_MS = 15000

// 与真实网页客户端一致的基本请求头（见官方 2.0.0 web build 抓包）。
// Cookie / UA / Origin 由浏览器自动附带，不在这里伪造。
const BASE_HEADERS = {
    'Accept': '*/*',
    'X-Client-Bundle-Id': 'com.deepseek.chat',
    'X-Client-Platform': 'web',
    'X-Client-Version': '2.5.0',
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

/**
 * 读取浏览器里的 userToken：优先 storage.session（content 脚本上报）。
 * skipCookie=true 时跳过 cookie 兜底——未登录时 DeepSeek 也会下发匿名
 * userToken cookie，拿它调接口只会得到 40003，不如直接引导登录。
 */
async function getUserToken({ skipCookie = false } = {}) {
    try {
        const stored = await chrome.storage.session.get('dsUserToken')
        if (stored?.dsUserToken)
            return stored.dsUserToken
    }
    catch {
        // storage.session 不可用时走 cookie 兜底
    }

    if (skipCookie)
        return null

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

/**
 * 静默获取登录凭证：在隐藏容器里打开一次 DeepSeek 页面，
 * 由页面脚本上报 userToken。拿到后立即关闭（用户几乎无感）；
 * 若迟迟拿不到（大概率未登录），把页面亮出来引导用户登录。
 *
 * 容器按平台选择：Windows / Linux 用最小化窗口（完全无感）；
 * macOS 上 Edge 忽略程序化最小化，退回后台标签（不抢焦点，用完即关）。
 */
async function openChannelTabAndWaitForToken() {
    let os = ''
    try {
        os = (await chrome.runtime.getPlatformInfo()).os
    }
    catch {}

    let close = null
    let surface = null

    if (os !== 'mac') {
        try {
            const win = await chrome.windows.create({ url: DS_CHANNEL_TAB_URL, state: 'minimized', focused: false })
            const state = (await chrome.windows.get(win.id)).state
            if (state === 'minimized') {
                close = () => chrome.windows.remove(win.id).catch(() => {})
                surface = () => chrome.windows.update(win.id, { state: 'normal', focused: true }).catch(() => {})
            }
            else {
                // 平台不支持最小化：撤掉窗口，走标签方案
                await chrome.windows.remove(win.id).catch(() => {})
            }
        }
        catch {}
    }

    if (!close) {
        try {
            const target = await chrome.windows.getLastFocused().catch(() => null)
            const tab = await chrome.tabs.create({
                url: DS_CHANNEL_TAB_URL,
                active: false,
                ...(target ? { windowId: target.id } : {}),
            })
            close = () => chrome.tabs.remove(tab.id).catch(() => {})
            surface = () => chrome.tabs.update(tab.id, { active: true }).catch(() => {})
        }
        catch {
            return // 容器都建不出来就只能走报错
        }
    }

    const start = Date.now()
    while (Date.now() - start < DS_CHANNEL_WAIT_MS) {
        try {
            const stored = await chrome.storage.session.get('dsUserToken')
            if (stored?.dsUserToken) {
                // 拿到凭证：静默收场
                close()
                return
            }
        }
        catch {
            break
        }
        await new Promise(resolve => setTimeout(resolve, 500))
    }

    // 超时（大概率未登录）：亮出来引导登录，不再自动关闭
    surface?.()
}

async function getAccessToken(signal) {
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpireAt)
        return cachedAccessToken

    let userToken = await getUserToken()
    if (!userToken) {
        await openChannelTabAndWaitForToken()
        // 等待后只认页面上报的凭证：cookie 里的可能是匿名 token
        userToken = await getUserToken({ skipCookie: true })
    }
    if (!userToken)
        throw new Error('未找到 DeepSeek 登录凭证：已在后台打开 DeepSeek 页面，请在该页面登录后重试')

    let payload
    try {
        payload = await fetchJSON('/users/current', { accessToken: userToken, signal })
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (reason.includes('40003') || /authorization/i.test(reason))
            throw new Error('DeepSeek 登录凭证无效或已失效：请在 DeepSeek 页面重新登录后重试')
        throw error
    }
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

async function requestPowChallenge(accessToken, signal, targetPath = '/api/v0/chat/completion') {
    const payload = await fetchJSON('/chat/create_pow_challenge', {
        method: 'POST',
        body: { target_path: targetPath },
        accessToken,
        signal,
    })
    const challenge = pickBizData(payload)?.challenge
    if (!challenge?.challenge)
        throw new Error('DeepSeek 未下发 PoW 挑战')
    return challenge
}

// PoW 求解统一走 offscreen 文档：MV3 SW 线程被浏览器大幅降频（实测约 1/300），
// 直接在 SW 里算要几十秒；offscreen 文档是扩展自带的隐藏页面，算力正常且不可见。
const OFFSCREEN_URL = 'offscreen.html'
let offscreenCreating = null

async function ensureOffscreen() {
    try {
        if (await chrome.offscreen.hasDocument())
            return true
    }
    catch {
        // hasDocument 不可用时直接尝试创建
    }
    if (!offscreenCreating) {
        offscreenCreating = (async () => {
            const reasons = ['WORKERS', 'DOM_PARSER']
            for (const reason of reasons) {
                try {
                    await chrome.offscreen.createDocument({
                        url: OFFSCREEN_URL,
                        reasons: [reason],
                        justification: '计算 DeepSeek 接口要求的 PoW 工作量证明',
                    })
                    return true
                }
                catch (error) {
                    if (String(error).includes('already exists'))
                        return true
                }
            }
            return false
        })().finally(() => {
            offscreenCreating = null
        })
    }
    return await offscreenCreating
}

/**
 * 求解 PoW nonce：优先 offscreen，失败退回 SW 内计算（慢但兜底）。
 * @param {object} challenge 服务端下发的 PoW 挑战
 * @returns {Promise<{nonce: number, via: string, solveMs: number}>} nonce 及求解来源/耗时
 */
async function solveChallengeNonce(challenge) {
    try {
        if (await ensureOffscreen()) {
            const response = await chrome.runtime.sendMessage({ type: 'kcos-pow-solve', challenge })
            if (response?.ok && Number.isInteger(response.nonce))
                return { nonce: response.nonce, via: 'offscreen', solveMs: response.solveMs || 0 }
            if (response && response.ok === false)
                throw new Error(response.message || 'PoW 求解失败')
        }
    }
    catch (error) {
        const reason = String(error?.message || error)
        // 求解本身失败（如难度内无解）不应重试
        if (reason.includes('难度'))
            throw error
        // offscreen 不可用：退回 SW 内求解
    }
    const startedAt = Date.now()
    const nonce = solveDeepSeekChallenge(challenge)
    return { nonce, via: 'sw', solveMs: Date.now() - startedAt }
}

async function buildPowHeader(challenge) {
    const { nonce } = await solveChallengeNonce(challenge)
    const payload = {
        algorithm: challenge.algorithm,
        challenge: challenge.challenge,
        salt: challenge.salt,
        answer: nonce,
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
 * 上传一个附件：单独取 PoW → multipart 上传 → 等待服务端处理完成，返回 file id。
 * 完成后的 file id 放进补全请求的 ref_file_ids。
 */
async function uploadAttachment(accessToken, attachment, signal) {
    const challenge = await requestPowChallenge(accessToken, signal, '/api/v0/file/upload_file')
    const powHeader = await buildPowHeader(challenge)

    const binary = atob(attachment.data || '')
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++)
        bytes[index] = binary.charCodeAt(index)
    const form = new FormData()
    form.append('file', new Blob([bytes], { type: attachment.mime || 'application/octet-stream' }), attachment.name || 'attachment')

    const response = await fetch(`${API_BASE}/file/upload_file`, {
        method: 'POST',
        headers: {
            ...BASE_HEADERS,
            'Authorization': `Bearer ${accessToken}`,
            'X-Ds-PoW-Response': powHeader,
        },
        body: form,
        credentials: 'include',
        signal,
    })
    if (!response.ok)
        throw new Error(['DeepSeek 附件上传 HTTP', response.status].join(' '))
    const payload = await response.json().catch(() => null)
    const fileId = pickBizData(payload)?.id
    if (!fileId)
        throw new Error('DeepSeek 附件上传失败：响应中没有文件 ID')

    // PENDING → SUCCESS（服务端要解析文件内容），最多等 30 秒
    const start = Date.now()
    while (Date.now() - start < 30000) {
        try {
            const list = await fetchJSON(`/file/fetch_files?file_ids=${encodeURIComponent(fileId)}`, { accessToken, signal })
            const status = pickBizData(list)?.files?.[0]?.status
            if (status === 'SUCCESS' || status === 'FAILED')
                break
        }
        catch {
            // 轮询失败不致命，继续等
        }
        await new Promise(resolve => setTimeout(resolve, 1200))
    }
    return fileId
}

/**
 * 发起一次对话补全。
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages OpenAI 风格消息
 * @param {boolean} [options.thinking] 是否开启深度思考（R1 风格）
 * @param {Array<{name: string, mime: string, data: string}>} [options.attachments] 附件（base64）
 * @param {(text: string) => void} [options.onDelta] 正文增量回调
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} 完整正文
 */
export async function deepseekChat({ messages, thinking = false, attachments = [], onDelta, signal }) {
    const accessToken = await getAccessToken(signal)
    const sessionId = await createChatSession(accessToken, signal)

    // 附件先上传拿到 file id（重试补全时不重复上传）
    const refFileIds = []
    for (const attachment of (Array.isArray(attachments) ? attachments.slice(0, 3) : [])) {
        if (attachment?.data)
            refFileIds.push(await uploadAttachment(accessToken, attachment, signal))
    }

    // 一次补全尝试：新建 PoW 挑战 → 请求补全 → 解析流
    const attemptCompletion = async () => {
        const challenge = await requestPowChallenge(accessToken, signal)
        const powHeader = await buildPowHeader(challenge)

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
                ref_file_ids: refFileIds,
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

    try {
        try {
            return await attemptCompletion()
        }
        catch (error) {
            // 服务器繁忙（backend_err）是间歇性的：稍等后用新挑战自动重试一次
            if (!/服务器繁忙/.test(error?.message || '') || signal?.aborted)
                throw error
            await new Promise(resolve => setTimeout(resolve, 2500))
            if (signal?.aborted)
                throw new Error('本地直连请求已取消')
            return await attemptCompletion()
        }
    }
    finally {
        deleteChatSession(accessToken, sessionId)
    }
}

// SSE 有两种形态：
// 旧版：data: {"p":"response/fragments","o":"APPEND","v":[{type,content}]}（正文在 ANSWER/RESPONSE 片段，
//       另有 {"p":"response/thinking_content","v":"..."} 之类的字符串增量）
// 新版：命名事件（event: ready / hint / close），hint 携带 {type:"error", content, finish_reason}；
//       服务端繁忙时整个流只有 ready + hint(backend_err) + close，没有任何正文。
async function consumeCompletionStream(response, onDelta) {
    let content = ''
    let streamError = ''
    let sawClose = false

    const appendDelta = (text) => {
        if (typeof text !== 'string' || !text)
            return
        content += text
        onDelta?.(text)
    }

    await readSSE(response, (payload, eventName) => {
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

        // 新版命名事件
        if (eventName === 'hint') {
            if (data?.type === 'error') {
                const detail = data.content || '未知错误'
                const busy = data.finish_reason === 'backend_err'
                    || detail.includes('暂时不可用')
                    || /temporarily/i.test(detail)
                streamError = busy
                    ? 'DeepSeek 服务器繁忙（暂时不可用），已自动重试仍失败，请稍后再试或切换豆包直连 / 校园网关'
                    : ['DeepSeek 回答失败', detail].filter(Boolean).join('：')
            }
            return
        }
        if (eventName === 'close') {
            sawClose = true
            return
        }
        if (eventName === 'ready')
            return

        // 快照形态（带附件/视觉问答常见）：{"v":{"response":{...fragments:[{type:"RESPONSE",content:"..."}]}}}
        // 快照可能是累积全文，按「前缀衔接」做差量追加，避免与已流式收到的内容重复
        const snapshot = data.v && typeof data.v === 'object' && !Array.isArray(data.v) ? data.v.response : null
        if (snapshot?.fragments) {
            const text = (Array.isArray(snapshot.fragments) ? snapshot.fragments : [snapshot.fragments])
                .filter(fragment => ['ANSWER', 'RESPONSE'].includes(String(fragment?.type || '').toUpperCase()))
                .map(fragment => String(fragment?.content || ''))
                .join('')
            if (text) {
                if (text.startsWith(content))
                    appendDelta(text.slice(content.length))
                else if (content && !content.endsWith(text))
                    appendDelta(text)
                else if (!content)
                    appendDelta(text)
            }
            return
        }

        // 旧版补丁格式
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
        // 字符串增量：思考内容与结束标记不展示，正文增量透传。
        if (typeof v === 'string' && !/thinking|finish_reason|status/.test(String(p || '')))
            appendDelta(v)
    })

    if (streamError)
        throw new Error(streamError)
    if (!content && sawClose)
        throw new Error('DeepSeek 没有返回内容（服务器繁忙），请稍后重试')
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
                : '未找到登录凭证：提问时扩展会自动打开 DeepSeek 页面，在该页面登录即可',
        }
    },
}
