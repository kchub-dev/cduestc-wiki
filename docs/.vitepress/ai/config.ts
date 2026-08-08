export const OPENAI_CONFIG = {
    proxyUrl: import.meta.env.VITE_OPENAI_PROXY_URL?.trim() || '',
    telemetryUrl: import.meta.env.VITE_AI_TELEMETRY_URL?.trim() || '',
    model: import.meta.env.VITE_OPENAI_MODEL || 'generalv3.5',
    timeoutMs: 30_000,
}
