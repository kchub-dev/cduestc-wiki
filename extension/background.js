// 后台 service worker：负责与上游 AI 网页通信，并通过长连接端口把
// 回答增量转发给 wiki 页面的 content-bridge 脚本。扩展是一个纯传输层，
// 知识库检索与 prompt 组装都在 wiki 页面本地完成。

import { BRIDGE_NAMESPACE, EXTENSION_VERSION } from './src/constants.js'
import { getSettings, providers } from './src/providers/index.js'

// 允许 content 脚本写 storage.session（DeepSeek userToken 上报用）。
// 该存储只在浏览器会话内存里存在，浏览器关闭即清空，不落盘。
try {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
}
catch {
    // 旧版本 Chrome 不支持时，DeepSeek 走 cookie 兜底
}

// ---- DeepSeek userToken 上报通道（content-deepseek.js -> storage.session）----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'report-ds-token') {
        const token = typeof message.token === 'string' ? message.token : ''
        if (token) {
            chrome.storage.session.set({ dsUserToken: token }).catch(() => {})
        }
        else {
            chrome.storage.session.remove('dsUserToken').catch(() => {})
        }
        sendResponse({ ok: true })
        return false
    }

    if (message?.type === 'ping') {
        // content-bridge 握手：告诉 wiki 页面扩展能力与当前设置
        getSettings().then(({ provider, thinking }) => {
            sendResponse({
                version: EXTENSION_VERSION,
                providers: Object.keys(providers),
                provider,
                thinking,
            })
        })
        return true
    }

    if (message?.type === 'set-provider') {
        // wiki 页面在「直连」模式下切换上游（豆包 / DeepSeek）
        const requested = typeof message.provider === 'string' ? message.provider : ''
        if (!providers[requested]) {
            sendResponse({ ok: false, message: '未知上游' })
            return false
        }
        chrome.storage.local.set({ provider: requested })
            .then(() => sendResponse({ ok: true, provider: requested }))
            .catch(() => sendResponse({ ok: false, message: '保存失败' }))
        return true
    }

    if (message?.type === 'popup-status') {
        Promise.all([
            getSettings(),
            ...Object.values(providers).map(adapter =>
                adapter.checkAuth().then(result => [adapter.id, result]).catch(() => [adapter.id, { ok: false, message: '检查失败' }])),
        ]).then(([settings, ...authEntries]) => {
            sendResponse({
                version: EXTENSION_VERSION,
                ...settings,
                auth: Object.fromEntries(authEntries),
            })
        })
        return true
    }

    return false
})

// ---- 对话长连接：端口名 chat:<requestId> ----

chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith('chat:'))
        return
    const requestId = port.name.slice('chat:'.length)
    const controller = new AbortController()
    let started = false

    port.onDisconnect.addListener(() => controller.abort())
    port.onMessage.addListener((message) => {
        if (message?.type === 'abort')
            controller.abort()
    })

    const post = (type, extra = {}) => {
        try {
            port.postMessage({ ns: BRIDGE_NAMESPACE, type, id: requestId, ...extra })
        }
        catch {
            // 端口已关闭
        }
    }

    const run = async (payload) => {
        const settings = await getSettings()
        const providerId = providers[payload?.provider] ? payload.provider : settings.provider
        const adapter = providers[providerId]
        if (!adapter)
            throw new Error(['未知上游', providerId].join(' '))

        const content = await adapter.chat({
            messages: Array.isArray(payload?.messages) ? payload.messages : [],
            thinking: payload?.thinking ?? settings.thinking,
            signal: controller.signal,
            onDelta: (delta) => {
                if (!controller.signal.aborted)
                    post('delta', { delta })
            },
        })
        post('done', { content })
    }

    port.onMessage.addListener((message) => {
        if (started || message?.type !== 'chat')
            return
        started = true
        run(message.payload).catch((error) => {
            const reason = controller.signal.aborted
                ? '请求已取消'
                : (error?.message || '上游请求失败')
            post('error', { message: reason })
        })
    })
})
