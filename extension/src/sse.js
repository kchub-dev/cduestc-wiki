// 极简 SSE 读取器：按行扫描 fetch 响应体，把 data: 载荷交给回调。
// 两个上游（DeepSeek / 豆包）都是 data 行承载 JSON，这里做统一处理。

/**
 * @param {Response} response
 * @param {(payload: string) => void} onData 每个 data: 事件的文本载荷
 * @param {() => void} [onEnd] 流自然结束时的回调
 */
export async function readSSE(response, onData, onEnd) {
    if (!response.body)
        throw new Error('上游没有返回可读取的响应流')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let done = false

    try {
        while (!done) {
            const chunk = await reader.read()
            done = chunk.done
            buffer += decoder.decode(chunk.value || new Uint8Array(), { stream: !chunk.done })
            const lines = buffer.split(/\r?\n/)
            buffer = lines.pop() || ''
            for (const line of lines) {
                if (!line.startsWith('data:'))
                    continue
                onData(line.slice(5).trimStart())
            }
        }
        // 处理结尾没有换行的残留行
        if (buffer.startsWith('data:'))
            onData(buffer.slice(5).trimStart())
    }
    finally {
        reader.cancel().catch(() => {})
    }
    onEnd?.()
}

/**
 * 把 OpenAI 风格的多轮消息压平成一段纯文本 prompt。
 * system 打头，历史对话用「用户 / 助手」标注，供无对话结构的上游使用。
 * @param {Array<{role: string, content: string}>} messages
 */
export function flattenOpenAIMessages(messages) {
    const systemParts = []
    const transcript = []
    for (const message of messages) {
        if (message.role === 'system') {
            systemParts.push(message.content)
        }
        else {
            transcript.push(`${message.role === 'assistant' ? '助手' : '用户'}：${message.content}`)
        }
    }
    const lines = []
    if (systemParts.length)
        lines.push(`[系统指令]\n${systemParts.join('\n')}`)
    lines.push(...transcript)
    return lines.join('\n\n')
}
