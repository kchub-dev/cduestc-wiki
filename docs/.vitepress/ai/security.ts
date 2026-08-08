const PROMPT_INJECTION_PATTERNS = [
    /ignore\s+(?:all|any|the|previous|earlier|above)\s+(?:instructions?|rules?|messages?)/iu,
    /(?:reveal|show|print|泄露|输出|显示).{0,24}(?:system|developer|prompt|提示词|系统指令)/iu,
    /(?:忽略|无视|跳过).{0,24}(?:之前|上面|系统|开发者).{0,12}(?:指令|提示|规则)/u,
    /(?:jailbreak|prompt\s*injection|越狱|开发者消息|系统提示词)/iu,
    /<\/?(?:system|developer|assistant|tool|reference)\b/iu,
]

const SENSITIVE_PATTERNS = [
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu,
    /https?:\/\/\S+/giu,
    /(?<!\d)1[3-9]\d{9}(?!\d)/gu,
    /(?<!\d)\d{6,}(?!\d)/gu,
]

export interface SanitizedUserInput {
    text: string
    blocked: boolean
}

function removeControlCharacters(value: string) {
    return [...value].filter((character) => {
        const code = character.codePointAt(0) || 0
        return !((code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127)
    }).join('')
}

export function sanitizeUserInput(value: string): SanitizedUserInput {
    const rawText = value.normalize('NFKC')
    const text = removeControlCharacters(value
        .normalize('NFKC'))
        .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/gu, '')
        .replace(/[<>]/g, ' ')
        .replace(/\s+/gu, ' ')
        .trim()
        .slice(0, 1_000)

    return {
        text,
        blocked: PROMPT_INJECTION_PATTERNS.some(pattern => pattern.test(rawText)),
    }
}

export function redactTelemetryQuery(value: string) {
    return value
        .replace(/\[redacted\]/giu, '[已脱敏]')
        .replace(SENSITIVE_PATTERNS[0], '[email]')
        .replace(SENSITIVE_PATTERNS[1], '[url]')
        .replace(SENSITIVE_PATTERNS[2], '[phone]')
        .replace(SENSITIVE_PATTERNS[3], '[number]')
        .slice(0, 120)
}
