import type { AIProviderId } from './types'

const configuredProvider = import.meta.env.VITE_AI_PROVIDER?.trim().toLowerCase()

export const AI_PROVIDER: AIProviderId = configuredProvider === 'spark' ? 'spark' : 'openai'

export const OPENAI_CONFIG = {
    proxyUrl: import.meta.env.VITE_OPENAI_PROXY_URL?.trim() || '',
    model: import.meta.env.VITE_OPENAI_MODEL || 'step-3.5-flash',
    timeoutMs: 30_000,
}

export const SPARK_CONFIG = {
    authUrl: import.meta.env.VITE_SPARK_AUTH_URL || '',
    timeoutMs: 25_000,
}
