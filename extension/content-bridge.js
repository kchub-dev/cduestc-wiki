// wiki 页面 <-> 扩展 的桥接脚本。
// 页面 JS 无法跨域访问豆包 / DeepSeek，这里把页面里约定命名空间的
// postMessage 转成长连接端口交给后台 service worker 处理。
// 只有来自同一页面窗口、命名空间匹配的消息会被处理。

(async () => {
    const NS = 'kcos-wiki-ai-bridge/v1'

    // 防止重复执行（扩展更新重载时脚本可能再次运行）
    if (window.__kcosAiBridgeInstalled)
        return
    window.__kcosAiBridgeInstalled = true

    const reply = (type, payload) => {
        window.postMessage({ ns: NS, type, ...payload }, location.origin)
    }

    // 进行中的对话请求：requestId -> port（用于取消）
    const activePorts = new Map()

    window.addEventListener('message', async (event) => {
        if (event.source !== window || event.origin !== location.origin)
            return
        const data = event.data
        if (!data || data.ns !== NS)
            return

        if (data.type === 'ping' && typeof data.nonce === 'string') {
            try {
                const info = await chrome.runtime.sendMessage({ type: 'ping' })
                reply('pong', { nonce: data.nonce, payload: info || null })
            }
            catch {
                // 扩展上下文失效（刚更新 / 重载）时按不可用处理
                reply('pong', { nonce: data.nonce, payload: null })
            }
            return
        }

        if (data.type === 'set-provider' && typeof data.id === 'string') {
            // 页面在「直连」模式下切换上游（豆包 / DeepSeek）
            try {
                const result = await chrome.runtime.sendMessage({ type: 'set-provider', provider: data.provider })
                reply('provider-changed', { id: data.id, ok: result?.ok === true, provider: result?.provider, message: result?.message })
            }
            catch {
                reply('provider-changed', { id: data.id, ok: false, message: '扩展后台不可用' })
            }
            return
        }

        if (data.type === 'chat' && typeof data.id === 'string') {
            if (activePorts.has(data.id))
                return
            let port
            try {
                port = chrome.runtime.connect({ name: `chat:${data.id}` })
            }
            catch {
                reply('error', { id: data.id, message: '扩展后台不可用，请重新加载扩展或刷新页面' })
                return
            }
            activePorts.set(data.id, port)

            port.onMessage.addListener((message) => {
                if (!message || message.id !== data.id)
                    return
                if (message.type === 'delta') {
                    reply('delta', { id: data.id, delta: message.delta })
                }
                else if (message.type === 'done') {
                    reply('done', { id: data.id, content: message.content })
                    cleanup(data.id)
                }
                else if (message.type === 'error') {
                    reply('error', { id: data.id, message: message.message })
                    cleanup(data.id)
                }
            })
            port.onDisconnect.addListener(() => {
                if (activePorts.has(data.id)) {
                    reply('error', { id: data.id, message: '扩展后台连接中断，请检查扩展是否被浏览器挂起' })
                    cleanup(data.id)
                }
            })

            port.postMessage({ type: 'chat', payload: data.payload })
            return
        }

        if (data.type === 'abort' && typeof data.id === 'string') {
            const port = activePorts.get(data.id)
            if (port) {
                try {
                    port.postMessage({ type: 'abort' })
                }
                catch {
                    // 端口已关闭
                }
                cleanup(data.id)
            }
        }
    })

    function cleanup(id) {
        const port = activePorts.get(id)
        activePorts.delete(id)
        try {
            port?.disconnect()
        }
        catch {
            // 已断开
        }
    }
})()
