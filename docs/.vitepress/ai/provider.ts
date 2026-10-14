import { openAIProvider } from './providers/openai'

export { extensionAIProvider } from './providers/extension'

// 默认 provider：校园 AI 网关（原有功能，保持默认不变）。
// 「本地直连」模式（浏览器扩展，见 providers/extension.ts）由 AIChat 组件
// 按用户选择动态切换，未装扩展时始终走这里。
export const activeAIProvider = openAIProvider
