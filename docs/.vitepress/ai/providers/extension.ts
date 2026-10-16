// 「本地直连」provider：回答由用户自己登录的豆包 / DeepSeek 网页账号生成，
// 请求由「科成星球 AI 直连助手」浏览器扩展在本机完成，不经过任何自建网关。
// 与 openai.ts（校园网关）实现同一个 AIProvider 接口，互相独立、可随时切换。

import type { AIChatRequest, AIProvider } from '../types'
import { chatViaBridge, pingExtensionBridge } from '../bridge'
import { buildGroundedUserPrompt, CAMPUS_SYSTEM_PROMPT, parseGroundedResponse } from '../prompts'

export const extensionAIProvider: AIProvider = {
    id: 'extension',
    label: '本地直连',
    isConfigured: () => Boolean(bridgeReady),
    async chat(request: AIChatRequest) {
        if (!bridgeReady) {
            throw new Error('浏览器扩展未连接：请先安装并启用「科成星球 AI 直连助手」扩展')
        }

        const messages = [
            { role: 'system', content: CAMPUS_SYSTEM_PROMPT },
            ...request.history,
            { role: 'user', content: buildGroundedUserPrompt(request.message, request.sources) },
        ]

        let raw = ''
        try {
            raw = await chatViaBridge({
                messages,
                signal: request.signal,
                onToken: request.onToken,
                attachments: request.attachments,
            })
        }
        catch (error) {
            if (request.signal?.aborted)
                throw new Error('本地直连请求已取消')
            throw error
        }

        if (!raw.trim())
            throw new Error('模型没有返回有效内容')
        return parseGroundedResponse(raw)
    },
}

// 扩展握手状态：页面挂载时探测一次，成功后 Chat UI 才允许切到直连模式。
let bridgeReady = false

export async function connectExtensionBridge() {
    const info = await pingExtensionBridge()
    bridgeReady = Boolean(info)
    return info
}

export function isExtensionBridgeReady() {
    return bridgeReady
}
