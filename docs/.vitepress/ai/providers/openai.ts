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

export const openAIProvider: AIProvider = {
    id: 'openai',
    label: 'OpenAI 兼容模式',
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
                    temperature: 0.7,
                    max_tokens: 1024,
                }),
                signal: controller.signal,
            })

            if (!response.ok)
                throw new Error(await parseErrorMessage(response))

            const data = await response.json()
            const content = data.choices?.[0]?.message?.content?.trim()
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
