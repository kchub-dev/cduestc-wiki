// 豆包适配器（页面驱动版）。
//
// 背景：豆包的 /chat/completion 接口要求强校验的 a_bogus 签名——实测把签名
// 换成等长随机值会立刻触发风控拦截与滑块验证挑战。所以这里不再直接调接口，
// 而是通过扩展在用户浏览器里驱动「已登录的豆包网页」完成一次提问：
// content-doubao.js 负责注入问题、读取流式回答；真实请求由豆包页面自己
// 签名发出，与人工使用完全一致。
//
// 页面通道：优先复用上次创建的豆包标签页（后台打开，不打断用户），
// 找不到时自动新建。会话历史留在该标签页的同一会话里。

import { flattenOpenAIMessages } from '../sse.js'

const RUN_TAB_URL = 'https://www.doubao.com/chat/'
const RUN_TAB_KEY = 'doubaoRunTabId'
const RUN_TIMEOUT_MS = 4 * 60 * 1000

async function pingTab(tabId) {
    try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'doubao-ping' })
        return result?.ok ? result : null
    }
    catch {
        // 内容脚本还没加载好
        return null
    }
}

async function waitForTabReady(tabId, timeoutMs = 15000) {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
        const info = await pingTab(tabId)
        if (info)
            return info
        await new Promise(resolve => setTimeout(resolve, 400))
    }
    return null
}

async function ensureRunTab() {
    let tabId = null
    try {
        const stored = await chrome.storage.session.get(RUN_TAB_KEY)
        if (typeof stored?.[RUN_TAB_KEY] === 'number')
            tabId = stored[RUN_TAB_KEY]
    }
    catch {
        // storage.session 不可用时直接新建
    }

    if (tabId !== null) {
        try {
            await chrome.tabs.get(tabId)
            const info = await waitForTabReady(tabId, 3000)
            if (info) {
                // 标签页被用户导航到别处时拉回聊天页（不影响其它页面使用）
                if (!info.url.includes('/chat')) {
                    await chrome.tabs.update(tabId, { url: RUN_TAB_URL })
                    await waitForTabReady(tabId)
                }
                return tabId
            }
            // 页面存在但内容脚本未就绪（加载中）：给它多一点时间
            const late = await waitForTabReady(tabId, 8000)
            if (late)
                return tabId
        }
        catch {
            // 标签页已被关闭，走重建
        }
    }

    const tab = await chrome.tabs.create({ url: RUN_TAB_URL, active: false })
    try {
        await chrome.storage.session.set({ [RUN_TAB_KEY]: tab.id })
    }
    catch {
        // 记不住也没关系，下次再建
    }
    await waitForTabReady(tab.id)
    return tab.id
}

/**
 * 发起一次对话补全（页面驱动）。
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages OpenAI 风格消息
 * @param {(text: string) => void} [options.onDelta] 正文增量回调
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} 完整正文
 */
export async function doubaoChat({ messages, onDelta, signal }) {
    const prompt = flattenOpenAIMessages(messages)
    const tabId = await ensureRunTab()

    return await new Promise((resolve, reject) => {
        let settled = false
        let content = ''
        let port
        let pokeTimer = null
        let timeoutTimer = null

        const cleanup = () => {
            if (pokeTimer)
                clearInterval(pokeTimer)
            if (timeoutTimer)
                clearTimeout(timeoutTimer)
            signal?.removeEventListener('abort', onAbort)
            try {
                port?.disconnect()
            }
            catch {
                // 已断开
            }
        }
        const finish = (error, result) => {
            if (settled)
                return
            settled = true
            cleanup()
            if (error)
                reject(error)
            else
                resolve(result)
        }
        function onAbort() {
            try {
                port?.postMessage({ type: 'abort' })
            }
            catch {
                // 端口已关闭
            }
            finish(new Error('本地直连请求已取消'))
        }

        try {
            port = chrome.tabs.connect(tabId, { name: `doubao-run:${Date.now()}` })
        }
        catch {
            finish(new Error('无法连接豆包标签页，请在扩展里刷新后重试'))
            return
        }

        port.onMessage.addListener((message) => {
            if (message?.type === 'delta' && typeof message.delta === 'string' && message.delta) {
                content += message.delta
                onDelta?.(message.delta)
                return
            }
            if (message?.type === 'done') {
                if (typeof message.content === 'string' && message.content)
                    content = message.content
                finish(null, content)
                return
            }
            if (message?.type === 'error') {
                finish(new Error(message.message || '豆包页面返回错误'))
            }
        })
        port.onDisconnect.addListener(() => {
            finish(new Error('豆包页面连接已断开（标签页被关闭或刷新），请重试'))
        })

        signal?.addEventListener('abort', onAbort, { once: true })
        timeoutTimer = setTimeout(() => finish(new Error('豆包回答超时，请稍后重试')), RUN_TIMEOUT_MS)

        // 后台标签页的定时器会被浏览器节流：由扩展侧定期 poke，页面侧即时检查
        pokeTimer = setInterval(() => {
            try {
                port.postMessage({ type: 'poke' })
            }
            catch {
                // 端口已关闭，onDisconnect 会处理
            }
        }, 800)

        port.postMessage({ type: 'run', prompt })
    })
}

export const doubaoProvider = {
    id: 'doubao',
    label: '豆包',
    chat: doubaoChat,
    async checkAuth() {
        try {
            const cookie = await chrome.cookies.get({ url: 'https://www.doubao.com', name: 'sessionid' })
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
