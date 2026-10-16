// 「本地直连」浏览器扩展桥接协议（页面侧）。
//
// 页面 JS 无法携带用户 cookie 跨域请求豆包 / DeepSeek，这部分由
// 「科成星球 AI 直连助手」浏览器扩展完成：页面把拼好的完整 prompt 通过
// window.postMessage 交给扩展注入的 content 脚本，扩展后台用自己的登录
// 会话请求上游并把回答增量流式传回。
//
// 协议命名空间与扩展侧 `extension/src/constants.js` 保持一致。

import { ref } from 'vue'

export const BRIDGE_NAMESPACE = 'kcos-wiki-ai-bridge/v1'

export interface BridgeInfo {
    version: string
    providers: string[]
    provider: string
    thinking: boolean
}

interface BridgeEvent {
    ns?: string
    type?: string
    nonce?: string
    id?: string
    payload?: BridgeInfo
    delta?: string
    content?: string
    message?: string
    ok?: boolean
    provider?: string
}

// 上游显示名：扩展侧 provider id -> 界面文案
export const UPSTREAM_LABELS: Record<string, string> = {
    deepseek: 'DeepSeek',
    doubao: '豆包',
}

export function upstreamLabel(id: string | undefined) {
    if (!id)
        return ''
    return UPSTREAM_LABELS[id] || id
}

// 扩展握手结果缓存：mounted 时探测一次，后续直接读
export const bridgeInfo = ref<BridgeInfo | null>(null)

let pendingPing: Promise<BridgeInfo | null> | null = null

function isBridgeEvent(event: MessageEvent): event is MessageEvent<BridgeEvent> {
    return event.source === window
        && event.origin === location.origin
        && !!event.data
        && event.data.ns === BRIDGE_NAMESPACE
}

/**
 * 探测扩展是否存在。发一个带随机 nonce 的 ping，1.2 秒内收到扩展回的
 * pong 即认为可用。扩展未安装时安静返回 null。
 */
export function pingExtensionBridge(timeoutMs = 1200): Promise<BridgeInfo | null> {
    if (typeof window === 'undefined')
        return Promise.resolve(null)
    if (pendingPing)
        return pendingPing

    const attemptOnce = () => new Promise<BridgeInfo | null>((resolve) => {
        const nonceBytes = new Uint8Array(8)
        crypto.getRandomValues(nonceBytes)
        const nonce = Array.from(nonceBytes, byte => byte.toString(36)).join('')
        let settled = false

        const cleanup = () => {
            window.removeEventListener('message', onMessage)
            clearTimeout(timer)
        }
        const onMessage = (event: MessageEvent) => {
            if (!isBridgeEvent(event) || event.data.type !== 'pong' || event.data.nonce !== nonce)
                return
            settled = true
            cleanup()
            resolve(event.data.payload || null)
        }
        const timer = setTimeout(() => {
            if (settled)
                return
            settled = true
            cleanup()
            resolve(null)
        }, timeoutMs)

        window.addEventListener('message', onMessage)
        window.postMessage({ ns: BRIDGE_NAMESPACE, type: 'ping', nonce }, location.origin)
    })

    // 扩展后台（MV3 Service Worker）冷启动唤醒可能较慢：多试几轮，任一成功即返回。
    // 只 ping 一次的话，偶发的冷启动延迟会让页面误判「扩展未安装」且不再恢复。
    pendingPing = (async () => {
        for (let round = 0; round < 3; round++) {
            const payload = await attemptOnce()
            if (payload) {
                bridgeInfo.value = payload
                return payload
            }
            await new Promise(resolve => setTimeout(resolve, 400))
        }
        bridgeInfo.value = null
        return null
    })().finally(() => {
        pendingPing = null
    })

    return pendingPing
}

export interface BridgeChatOptions {
    /** OpenAI 风格消息（system + 历史 + 拼好知识点的最终 user 消息） */
    messages: Array<{ role: string, content: string }>
    onToken?: (token: string) => void
    signal?: AbortSignal
    /** 整体超时，默认 5 分钟（深度思考模式可能较慢） */
    timeoutMs?: number
    /** 附件（base64），仅直连模式使用 */
    attachments?: Array<{ name: string, mime: string, data: string }>
}

/**
 * 通过扩展发起一次对话，流式回调增量，resolve 完整正文。
 * 扩展未连接、上游报错或超时会 reject。
 */
export function chatViaBridge(options: BridgeChatOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        let buffer = ''
        let settled = false

        const finish = (cleanup: () => void, action: (bridge: {
            resolve: (value: string) => void
            reject: (error: Error) => void
        }) => void) => {
            if (settled)
                return
            settled = true
            cleanup()
            action({ resolve, reject })
        }

        const cleanup = () => {
            window.removeEventListener('message', onMessage)
            clearTimeout(timer)
            options.signal?.removeEventListener('abort', onAbort)
        }
        const onAbort = () => {
            window.postMessage({ ns: BRIDGE_NAMESPACE, type: 'abort', id }, location.origin)
            finish(cleanup, ({ reject }) => reject(new Error('本地直连请求已取消')))
        }
        const onMessage = (event: MessageEvent) => {
            if (!isBridgeEvent(event) || event.data.id !== id)
                return
            if (event.data.type === 'delta' && typeof event.data.delta === 'string') {
                buffer += event.data.delta
                options.onToken?.(event.data.delta)
                return
            }
            if (event.data.type === 'done') {
                // 扩展可在 done 里携带最终正文（应对回答中途被上游重写等情况），优先采用
                const finalContent = typeof event.data.content === 'string' && event.data.content.length > 0
                    ? event.data.content
                    : buffer
                finish(cleanup, ({ resolve }) => resolve(finalContent))
                return
            }
            if (event.data.type === 'error') {
                finish(cleanup, ({ reject }) => reject(new Error(event.data.message || '本地直连请求失败')))
            }
        }
        const timer = setTimeout(() => {
            window.postMessage({ ns: BRIDGE_NAMESPACE, type: 'abort', id }, location.origin)
            finish(cleanup, ({ reject }) => reject(new Error('本地直连请求超时，可在扩展弹窗开启/关闭深度思考后重试')))
        }, options.timeoutMs ?? 300_000)

        window.addEventListener('message', onMessage)
        options.signal?.addEventListener('abort', onAbort, { once: true })
        window.postMessage({
            ns: BRIDGE_NAMESPACE,
            type: 'chat',
            id,
            payload: {
                messages: options.messages,
                // 附件要转成纯对象：Vue 响应式代理无法通过 postMessage 的结构化克隆
                attachments: options.attachments?.map(item => ({
                    name: String(item.name),
                    mime: String(item.mime),
                    data: String(item.data),
                })),
            },
        }, location.origin)
    })
}

/**
 * 切换扩展侧的默认上游（豆包 / DeepSeek）。扩展会把选择写入自己的
 * storage，后续所有直连请求都用这个上游。
 */
export function setBridgeProvider(provider: string, timeoutMs = 3000): Promise<{ ok: boolean, message?: string }> {
    if (typeof window === 'undefined')
        return Promise.resolve({ ok: false, message: '当前环境不支持' })

    return new Promise((resolve) => {
        const id = `prov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        let settled = false

        const cleanup = () => {
            window.removeEventListener('message', onMessage)
            clearTimeout(timer)
        }
        const onMessage = (event: MessageEvent) => {
            if (!isBridgeEvent(event) || event.data.type !== 'provider-changed' || event.data.id !== id)
                return
            settled = true
            cleanup()
            resolve({ ok: event.data.ok === true, message: event.data.message })
        }
        const timer = setTimeout(() => {
            if (settled)
                return
            settled = true
            cleanup()
            resolve({ ok: false, message: '扩展未响应' })
        }, timeoutMs)

        window.addEventListener('message', onMessage)
        window.postMessage({ ns: BRIDGE_NAMESPACE, type: 'set-provider', id, provider }, location.origin)
    })
}
