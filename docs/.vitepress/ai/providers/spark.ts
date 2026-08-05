import type { AIChatRequest, AIProvider } from '../types'
import { SPARK_CONFIG } from '../config'
import { buildGroundedUserPrompt, CAMPUS_SYSTEM_PROMPT, parseGroundedResponse } from '../prompts'

interface SparkAuthResponse {
    url?: string
    appId?: string
}

async function getSignedWebSocketUrl(signal?: AbortSignal): Promise<Required<SparkAuthResponse>> {
    const response = await fetch(SPARK_CONFIG.authUrl, {
        method: 'POST',
        signal,
    })

    if (!response.ok)
        throw new Error(`讯飞签名服务响应异常：HTTP ${response.status}`)

    const data = await response.json() as SparkAuthResponse
    const url = data.url?.trim()
    const appId = data.appId?.trim()
    if (!url?.startsWith('wss://') || !appId)
        throw new Error('讯飞签名服务返回的数据无效')

    return { url, appId }
}

export const sparkProvider: AIProvider = {
    id: 'spark',
    label: '讯飞助手演示',
    isConfigured: () => Boolean(SPARK_CONFIG.authUrl),
    async chat(request: AIChatRequest) {
        if (!this.isConfigured())
            throw new Error('讯飞演示模式尚未配置签名服务')

        const { url, appId } = await getSignedWebSocketUrl(request.signal)
        const uid = `wiki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

        return new Promise((resolve, reject) => {
            let fullContent = ''
            let settled = false
            let ws: WebSocket
            let timeout: ReturnType<typeof setTimeout>

            function finish(callback: () => void) {
                if (settled)
                    return
                settled = true
                clearTimeout(timeout)
                request.signal?.removeEventListener('abort', abortRequest)
                callback()
            }

            function abortRequest() {
                finish(() => {
                    ws?.close()
                    reject(new Error('讯飞请求已取消'))
                })
            }

            timeout = setTimeout(() => finish(() => {
                ws?.close()
                reject(new Error('讯飞助手响应超时'))
            }), SPARK_CONFIG.timeoutMs)

            request.signal?.addEventListener('abort', abortRequest, { once: true })

            try {
                ws = new WebSocket(url)
            }
            catch {
                finish(() => reject(new Error('讯飞 WebSocket 创建失败')))
                return
            }

            ws.onopen = () => {
                const currentPrompt = `${CAMPUS_SYSTEM_PROMPT}\n\n${buildGroundedUserPrompt(request.message, request.sources)}`
                ws.send(JSON.stringify({
                    header: { app_id: appId, uid },
                    parameter: {
                        chat: { domain: 'general', temperature: 0.5, max_tokens: 1024 },
                    },
                    payload: {
                        message: {
                            text: [
                                ...request.history,
                                { role: 'user', content: currentPrompt },
                            ],
                        },
                    },
                }))
            }

            ws.onmessage = (event) => {
                if (settled)
                    return

                try {
                    const data = JSON.parse(event.data)
                    if (data.header?.code !== 0) {
                        finish(() => {
                            ws.close()
                            reject(new Error(`讯飞错误：${data.header?.code} - ${data.header?.message || '未知错误'}`))
                        })
                        return
                    }

                    const textList = data.payload?.choices?.text || []
                    for (const item of textList) {
                        if (item.content)
                            fullContent += item.content
                    }

                    const responseStatus = data.payload?.choices?.status ?? data.header?.status
                    if (responseStatus === 2) {
                        finish(() => {
                            ws.close()
                            const content = fullContent.trim()
                            if (content)
                                resolve(parseGroundedResponse(content))
                            else reject(new Error('讯飞助手没有返回有效内容'))
                        })
                    }
                }
                catch {
                    finish(() => {
                        ws.close()
                        reject(new Error('讯飞助手响应解析失败'))
                    })
                }
            }

            ws.onerror = () => finish(() => {
                ws.close()
                reject(new Error('讯飞 WebSocket 连接失败'))
            })
            ws.onclose = () => finish(() => reject(new Error('讯飞连接已关闭')))
        })
    },
}
