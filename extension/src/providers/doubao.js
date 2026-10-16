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
const RUN_WINDOW_KEY = 'doubaoRunWindowId'
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

/**
 * 在「隐藏的最小化窗口」里创建通道页（Windows / Linux 有效）。
 * macOS 上 Edge 会忽略程序化最小化——这里验证状态，不成立就撤掉窗口改用后台标签。
 */
async function createChannelWindow(url, tabKey, windowKey) {
    let windowId = null
    try {
        const stored = await chrome.storage.session.get(windowKey)
        if (typeof stored?.[windowKey] === 'number')
            windowId = stored[windowKey]
    }
    catch {
        // storage.session 不可用时忽略
    }

    if (windowId !== null) {
        try {
            const existing = await chrome.windows.get(windowId, { populate: true })
            const tab = await chrome.tabs.create({ url, active: false, windowId: existing.id })
            try {
                await chrome.storage.session.set({ [tabKey]: tab.id })
            }
            catch {}
            return tab.id
        }
        catch {
            // 窗口已被关闭，走新建
        }
    }

    const win = await chrome.windows.create({ url, state: 'minimized', focused: false })
    try {
        const current = await chrome.windows.get(win.id)
        if (current.state !== 'minimized') {
            // 平台忽略最小化（macOS）：撤掉窗口，让调用方走后台标签方案
            await chrome.windows.remove(win.id)
            throw new Error('minimize-unsupported')
        }
    }
    catch (error) {
        if (String(error).includes('minimize-unsupported'))
            throw error
        // 校验失败同样撤掉，避免留下可见窗口
        try {
            await chrome.windows.remove(win.id)
        }
        catch {}
        throw new Error('minimize-unsupported')
    }

    let tab = win.tabs?.[0]
    if (!tab) {
        const populated = await chrome.windows.get(win.id, { populate: true })
        tab = populated.tabs?.[0]
    }
    try {
        await chrome.storage.session.set({ [windowKey]: win.id, [tabKey]: tab.id })
    }
    catch {}
    return tab.id
}

/**
 * 平台自适应创建通道页：
 * - Windows / Linux：隐藏的最小化窗口（用户完全无感）
 * - macOS：后台 + 钉住的小标签（不抢焦点、只在标签栏最左侧占一个图标位）
 */
async function createChannelTab(url, tabKey, windowKey) {
    let os = ''
    try {
        os = (await chrome.runtime.getPlatformInfo()).os
    }
    catch {
        // 取不到平台信息按需要最小化的平台处理（失败会自动退标签）
    }

    if (os !== 'mac') {
        try {
            return await createChannelWindow(url, tabKey, windowKey)
        }
        catch {
            // 最小化不可用：退回标签方案
        }
    }

    const target = await chrome.windows.getLastFocused().catch(() => null)
    const tab = await chrome.tabs.create({
        url,
        active: false,
        pinned: true,
        ...(target ? { windowId: target.id } : {}),
    })
    try {
        await chrome.storage.session.set({ [tabKey]: tab.id })
    }
    catch {}
    return tab.id
}

/** 把通道亮出来（只在需要用户登录等必须介入的场景调用） */
async function surfaceChannelWindow(tabId) {
    try {
        await chrome.tabs.update(tabId, { active: true })
    }
    catch {}
    try {
        const tab = await chrome.tabs.get(tabId)
        if (typeof tab.windowId === 'number')
            await chrome.windows.update(tab.windowId, { focused: true })
    }
    catch {
        // 窗口不存在就算了
    }
}

async function isDoubaoLoggedIn() {
    try {
        const cookie = await chrome.cookies.get({ url: 'https://www.doubao.com', name: 'sessionid' })
        return Boolean(cookie?.value)
    }
    catch {
        return true // 读不到 cookie 就不拦，让运行时报错兜底
    }
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
            let info = await pingTab(tabId)
            if (!info) {
                // 可能是被挂起/冻结的隐藏页：刷新一次唤醒
                try {
                    await chrome.tabs.reload(tabId)
                    info = await waitForTabReady(tabId, 10000)
                }
                catch {
                    info = null
                }
            }
            if (info) {
                // 通道页被导航到别处时拉回聊天页
                if (!info.url.includes('/chat')) {
                    await chrome.tabs.update(tabId, { url: RUN_TAB_URL })
                    await waitForTabReady(tabId)
                }
                return tabId
            }
            tabId = null
        }
        catch {
            // 标签页已被关闭，走重建
        }
    }

    tabId = await createChannelTab(RUN_TAB_URL, RUN_TAB_KEY, RUN_WINDOW_KEY)
    await waitForTabReady(tabId)
    return tabId
}

/**
 * 发起一次对话补全（页面驱动）。
 * @param {object} options
 * @param {Array<{role: string, content: string}>} options.messages OpenAI 风格消息
 * @param {Array<{name: string, mime: string, data: string}>} [options.attachments] 附件（base64，最多 3 个）
 * @param {(text: string) => void} [options.onDelta] 正文增量回调
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} 完整正文
 */
export async function doubaoChat({ messages, attachments = [], onDelta, signal }) {
    const prompt = flattenOpenAIMessages(messages)
    const tabId = await ensureRunTab()
    // 未登录时把隐藏的通道窗口亮出来引导登录（否则用户不知道去哪里登录）
    if (!(await isDoubaoLoggedIn())) {
        await surfaceChannelWindow(tabId)
        throw new Error('豆包未登录：已为你打开豆包页面，登录一次后重试即可')
    }

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

        port.postMessage({ type: 'run', prompt, attachments: Array.isArray(attachments) ? attachments.slice(0, 3) : [] })
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
