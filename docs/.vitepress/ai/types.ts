export type AIProviderId = 'openai'

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

export interface AIChatRequest {
    message: string
    sources: AIKnowledgeSource[]
    history: AIHistoryMessage[]
    signal?: AbortSignal
    onToken?: (content: string) => void
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
