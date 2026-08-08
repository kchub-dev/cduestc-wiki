import type { AIChatRequest, AIProvider } from '../types'
import { OPENAI_CONFIG } from '../config'
import { buildGroundedUserPrompt, CAMPUS_SYSTEM_PROMPT, parseGroundedResponse } from '../prompts'

async function parseErrorMessage(response: Response) {
    try {
        const data = await response.json()
        return data.error?.message || data.message || `HTTP ${response.status}`
    }
    catch {
        return `HTTP ${response.status}`
    }
}

async function readStream(response: Response, onToken?: (content: string) => void) {
    if (!response.body)
        throw new Error('模型没有返回可读取的响应流')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let done = false
    while (!done) {
        const chunk = await reader.read()
        buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
            if (!line.startsWith('data:'))
                continue
            const data = line.slice(5).trim()
            if (data === '[DONE]') {
                done = true
                break
            }
            try {
                const token = JSON.parse(data).choices?.[0]?.delta?.content
                if (typeof token === 'string' && token) {
                    content += token
                    onToken?.(token)
                }
            }
            catch {
                // Ignore keepalive/comment frames and malformed partial events.
            }
        }
        done ||= chunk.done
    }
    return content
}

export const openAIProvider: AIProvider = {
    id: 'openai',
    label: '校园 AI 网关',
    isConfigured: () => Boolean(OPENAI_CONFIG.proxyUrl),
    async chat(request: AIChatRequest) {
        if (!this.isConfigured())
            throw new Error('OpenAI 代理服务尚未配置')

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), OPENAI_CONFIG.timeoutMs)
        const abortRequest = () => controller.abort()
        request.signal?.addEventListener('abort', abortRequest, { once: true })

        try {
            const response = await fetch(OPENAI_CONFIG.proxyUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: OPENAI_CONFIG.model,
                    messages: [
                        { role: 'system', content: CAMPUS_SYSTEM_PROMPT },
                        ...request.history,
                        { role: 'user', content: buildGroundedUserPrompt(request.message, request.sources) },
                    ],
                    temperature: 0.2,
                    max_tokens: 1024,
                    stream: true,
                }),
                signal: controller.signal,
            })

            if (!response.ok)
                throw new Error(await parseErrorMessage(response))

            const contentType = response.headers.get('Content-Type') || ''
            const content = contentType.includes('text/event-stream')
                ? (await readStream(response, request.onToken)).trim()
                : (await response.json()).choices?.[0]?.message?.content?.trim()
            if (!content)
                throw new Error('模型没有返回有效内容')

            return parseGroundedResponse(content)
        }
        catch (error) {
            if (controller.signal.aborted)
                throw new Error('OpenAI 请求已取消或超时')
            throw error
        }
        finally {
            clearTimeout(timeout)
            request.signal?.removeEventListener('abort', abortRequest)
        }
    },
}
