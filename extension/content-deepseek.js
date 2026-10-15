// DeepSeek 登录页辅助脚本：把浏览器里的 userToken 上报给扩展后台。
// userToken 存在 chat.deepseek.com 的 localStorage 里，后台 service worker
// 无法直接读取页面存储，这里在页面加载时主动上报一次。
// 存储位置是 chrome.storage.session：只存在于本次浏览器会话内存中，
// 浏览器关闭即清空，不会写入磁盘。

(() => {
    const readUserToken = () => {
        try {
            const raw = localStorage.getItem('userToken')
            if (!raw)
                return ''
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
        catch {
            return ''
        }
    }

    const report = () => {
        const token = readUserToken()
        // 先直接写 storage.session（后台已开放权限）；失败再走消息兜底
        try {
            chrome.storage.session.set({ dsUserToken: token }).catch(() => {
                chrome.runtime.sendMessage({ type: 'report-ds-token', token }).catch(() => {})
            })
        }
        catch {
            chrome.runtime.sendMessage({ type: 'report-ds-token', token }).catch(() => {})
        }
    }

    report()

    // 后台 service worker 重启后存储仍在；但如果用户刚登录，页面内 token
    // 变化时再报一次。监听 storage 事件即可覆盖大部分场景。
    window.addEventListener('storage', report)

    // 登录往往发生在通道标签页自己内部（同页 localStorage 变化不会触发
    // storage 事件），所以周期比对一次，值有变化才上报。
    setInterval(() => {
        try {
            const token = readUserToken()
            chrome.storage.session.get('dsUserToken').then((stored) => {
                if ((stored?.dsUserToken || '') !== token)
                    report()
            }).catch(() => {})
        }
        catch {}
    }, 3000)
})()
