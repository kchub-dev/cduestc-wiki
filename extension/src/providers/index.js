// 上游 provider 注册表：新增一个上游 = 新增一个 adapter 文件 + 在这里注册。

import { deepseekProvider } from './deepseek.js'
import { doubaoProvider } from './doubao.js'

export const providers = {
    deepseek: deepseekProvider,
    doubao: doubaoProvider,
}

export const DEFAULT_PROVIDER_ID = 'deepseek'

export async function getSelectedProviderId() {
    try {
        const stored = await chrome.storage.local.get('provider')
        if (stored?.provider && providers[stored.provider])
            return stored.provider
    }
    catch {
        // storage 不可用时使用默认值
    }
    return DEFAULT_PROVIDER_ID
}

export async function getThinkingEnabled() {
    try {
        const stored = await chrome.storage.local.get('thinking')
        return stored?.thinking === true
    }
    catch {
        return false
    }
}

export async function getSettings() {
    const provider = await getSelectedProviderId()
    const thinking = await getThinkingEnabled()
    return { provider, thinking }
}
