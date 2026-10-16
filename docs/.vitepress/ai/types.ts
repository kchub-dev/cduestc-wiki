export type AIProviderId = 'openai' | 'extension'

export interface AIHistoryMessage {
    role: 'user' | 'assistant'
    content: string
}

export interface AIKnowledgeSource {
    id: string
    title: string
    section: string
    content: string
    url: string
}

// 附件（仅本地直连支持）：base64 内容随请求一起走扩展通道
export interface AIAttachment {
    name: string
    mime: string
    /** base64（不含 data: 前缀） */
    data: string
}

export interface AIChatRequest {
    message: string
    sources: AIKnowledgeSource[]
    history: AIHistoryMessage[]
    signal?: AbortSignal
    onToken?: (content: string) => void
    /** 直连模式的附件（图片/文档），网关模式恒为空 */
    attachments?: AIAttachment[]
}

export interface AIChatResponse {
    content: string
    citedSourceIds: string[]
}

export interface AIProvider {
    id: AIProviderId
    label: string
    isConfigured: () => boolean
    chat: (request: AIChatRequest) => Promise<AIChatResponse>
}
