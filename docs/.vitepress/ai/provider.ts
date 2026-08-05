import { AI_PROVIDER } from './config'
import { openAIProvider } from './providers/openai'
import { sparkProvider } from './providers/spark'

const providers = {
    openai: openAIProvider,
    spark: sparkProvider,
}

export const activeAIProvider = providers[AI_PROVIDER]
