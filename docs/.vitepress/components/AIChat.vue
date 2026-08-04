<template>
  <div class="ai-chat-container">
    <!-- 悬浮按钮 -->
    <Transition name="float-button">
      <div 
        v-show="!isOpen" 
        class="chat-float-button" 
        @click="toggleChat"
        v-tip="'科成AI助手'"
      >
        <Icon icon="ri:robot-2-line" class="chat-icon" />
        <div v-if="hasUnread" class="unread-dot"></div>
      </div>
    </Transition>

    <!-- 对话窗口 -->
    <Transition name="chat-window">
      <div v-show="isOpen" class="chat-window">
        <!-- 标题栏 -->
        <div class="chat-header">
          <div class="header-info">
            <Icon icon="ri:robot-2-fill" class="header-icon" />
            <div>
              <div class="header-title">星辰-AI助手</div>
              <div class="header-subtitle">基于校园知识库的AI助手</div>
            </div>
          </div>
          <div class="header-actions">
            <button @click="clearHistory" class="action-btn" v-tip="'清空对话'">
              <Icon icon="ri:delete-bin-line" />
            </button>
            <button @click="toggleChat" class="action-btn" v-tip="'关闭对话'">
              <Icon icon="ri:close-line" />
            </button>
          </div>
        </div>

        <!-- 消息列表 -->
        <div class="chat-messages" ref="messagesContainer">
          <!-- 欢迎消息 -->
          <div v-if="messages.length === 0" class="welcome-message">
            <Icon icon="ri:robot-2-line" class="welcome-icon" />
            <div class="welcome-text">
              <h3>👋 欢迎使用科成AI助手！</h3>
              <p>我可以帮您解答关于校园生活、实验室、社团等各种问题。</p>
              <div class="quick-questions">
                <button 
                  v-for="question in quickQuestions" 
                  :key="question"
                  @click="sendQuickQuestion(question)"
                  class="quick-btn"
                >
                  {{ question }}
                </button>
              </div>
            </div>
          </div>

          <!-- 消息历史 -->
          <div 
            v-for="message in messages" 
            :key="message.id" 
            class="message"
            :class="{ 'user-message': message.isUser, 'ai-message': !message.isUser }"
          >
            <div class="message-avatar">
              <Icon 
                :icon="message.isUser ? 'ri:user-3-fill' : 'ri:robot-2-fill'" 
                class="avatar-icon"
              />
            </div>
            <div class="message-content">
              <div
                class="message-text"
                :class="{ 'vp-doc': !message.isUser }"
                v-html="formatMessage(message.content)"
                @click="handleMessageClick"
              ></div>
              <!-- 相关页面链接 -->
              <div v-if="!message.isUser && message.links && message.links.length > 0" class="message-links">
                <div class="links-title">
                  <Icon icon="ri:link" />
                  相关页面
                </div>
                <div class="links-list">
                  <a
                    v-for="link in message.links"
                    :key="link.url"
                    :href="link.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="link-item"
                  >
                    <Icon icon="ri:file-text-line" />
                    {{ link.title }}
                  </a>
                </div>
              </div>
              <div class="message-time">{{ formatTime(message.timestamp) }}</div>
            </div>
          </div>

          <!-- 加载状态 -->
          <div v-if="isLoading" class="message ai-message">
            <div class="message-avatar">
              <Icon icon="ri:robot-2-fill" class="avatar-icon" />
            </div>
            <div class="message-content">
              <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>

          <!-- Dify建议问题 -->
          <div v-if="suggestedQuestions.length > 0 && !isLoading" class="suggested-questions">
            <div class="suggested-title">
              <Icon icon="ri:lightbulb-line" />
              您可能还想问：
            </div>
            <div class="suggested-list">
              <button 
                v-for="question in suggestedQuestions.slice(0, 3)" 
                :key="question"
                @click="sendQuickQuestion(question)"
                class="suggested-btn"
              >
                {{ question }}
              </button>
            </div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <div class="input-container">
            <textarea
              v-model="currentInput"
              @keydown.enter="handleEnterKey"
              @input="adjustTextareaHeight"
              ref="textareaRef"
              class="chat-input"
              placeholder="输入您的问题..."
              rows="1"
              :disabled="isLoading"
            ></textarea>
            <button
              @click="sendMessage"
              :disabled="!currentInput.trim() || isLoading || cooldownLeft > 0"
              class="send-btn"
            >
              <Icon icon="ri:send-plane-2-fill" />
            </button>
          </div>
          <div class="input-tips">
            <span v-if="cooldownLeft > 0" class="cooldown-tip">⏳ {{ cooldownLeft }}秒后可再次提问</span>
            <span v-else>按 Enter 发送，Shift + Enter 换行</span>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted, h, createVNode } from 'vue'
import Tip from './Tip.vue'

// 状态管理
const isOpen = ref(false)
const currentInput = ref('')
const isLoading = ref(false)
const hasUnread = ref(false)
const messages = ref<Array<{
  id: string
  content: string
  isUser: boolean
  timestamp: number
  links?: Array<{ title: string; url: string }>
}>>([])
const suggestedQuestions = ref<string[]>([])

// DOM引用
const messagesContainer = ref<HTMLElement>()
const textareaRef = ref<HTMLTextAreaElement>()

// API配置 - 讯飞星火助手（优先）
const SPARK_CONFIG = {
  appId: 'df5b1bc2',
  apiKey: '2cf0bf57b33b0747f5adb73a33adccaa',
  apiSecret: 'M2RmZTM3YjQ0ZjI3NmM3NjQxN2QyMGYy',
  assistantUrl: 'wss://spark-openapi.cn-huabei-1.xf-yun.com/v1/assistants/28hof4yktszs_v1'
}

// API配置 - OpenAI兼容接口（降级）
const API_CONFIG = {
  baseUrl: 'https://hub.linux.do/v1',
  apiKey: 'ah-6299cbb81666be776eadb25506b0d7896f3ce2b1d358b9d4d044d844b982e99a',
  model: 'step-3.5-flash'
}

// 检查 API 是否可用
const isApiAvailable = () => {
  return API_CONFIG.apiKey && API_CONFIG.apiKey !== 'YOUR_API_KEY_HERE'
}

// 纯JS SHA-256 实现（兼容所有浏览器，不依赖 crypto.subtle）
const sha256Pure = (str: string): string => {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]

  const encoder = new TextEncoder()
  const data = encoder.encode(str)
  const l = data.length * 8
  const n = Math.ceil((l + 65) / 512)
  const m = new Uint8Array(n * 64)
  m.set(data)
  m[data.length] = 0x80
  m[n * 64 - 1] = l & 0xff
  m[n * 64 - 2] = (l >>> 8) & 0xff
  m[n * 64 - 3] = (l >>> 16) & 0xff
  m[n * 64 - 4] = (l >>> 24) & 0xff

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19

  const w = new Uint32Array(64)
  for (let i = 0; i < n * 64; i += 64) {
    for (let j = 0; j < 16; j++) {
      w[j] = (m[i + j * 4] << 24) | (m[i + j * 4 + 1] << 16) | (m[i + j * 4 + 2] << 8) | m[i + j * 4 + 3]
    }
    for (let j = 16; j < 64; j++) {
      const s0 = ((w[j - 15] >>> 7) | (w[j - 15] << 25)) ^ ((w[j - 15] >>> 18) | (w[j - 15] << 14)) ^ (w[j - 15] >>> 3)
      const s1 = ((w[j - 2] >>> 17) | (w[j - 2] << 15)) ^ ((w[j - 2] >>> 19) | (w[j - 2] << 13)) ^ (w[j - 2] >>> 10)
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
    for (let j = 0; j < 64; j++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[j] + w[j]) | 0
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) | 0
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
  }

  const result = new Uint8Array(32)
  for (let i = 0; i < 4; i++) {
    result[i] = (h0 >>> (24 - i * 8)) & 0xff
    result[i + 4] = (h1 >>> (24 - i * 8)) & 0xff
    result[i + 8] = (h2 >>> (24 - i * 8)) & 0xff
    result[i + 12] = (h3 >>> (24 - i * 8)) & 0xff
    result[i + 16] = (h4 >>> (24 - i * 8)) & 0xff
    result[i + 20] = (h5 >>> (24 - i * 8)) & 0xff
    result[i + 24] = (h6 >>> (24 - i * 8)) & 0xff
    result[i + 28] = (h7 >>> (24 - i * 8)) & 0xff
  }
  return String.fromCharCode(...result)
}

// 纯JS HMAC-SHA256 实现（兼容微信/QQ内置浏览器，不依赖 crypto.subtle）
const hmacSha256 = async (key: string, message: string): Promise<string> => {
  const blockSize = 64
  const keyBytes = new TextEncoder().encode(key)
  let keyArray = new Uint8Array(blockSize)

  if (keyBytes.length > blockSize) {
    const hash = sha256Pure(key)
    for (let i = 0; i < hash.length; i++) keyArray[i] = hash.charCodeAt(i)
  } else {
    for (let i = 0; i < keyBytes.length; i++) keyArray[i] = keyBytes[i]
  }

  const ipad = new Uint8Array(blockSize)
  const opad = new Uint8Array(blockSize)
  for (let i = 0; i < blockSize; i++) {
    ipad[i] = keyArray[i] ^ 0x36
    opad[i] = keyArray[i] ^ 0x5c
  }

  const msgBytes = new TextEncoder().encode(message)
  const innerData = new Uint8Array(blockSize + msgBytes.length)
  innerData.set(ipad, 0)
  innerData.set(msgBytes, blockSize)

  const innerHash = sha256Pure(String.fromCharCode(...innerData))
  const outerData = new Uint8Array(blockSize + innerHash.length)
  outerData.set(opad, 0)
  for (let i = 0; i < innerHash.length; i++) outerData[blockSize + i] = innerHash.charCodeAt(i)

  const result = sha256Pure(String.fromCharCode(...outerData))
  return btoa(result)
}

// 讯飞星火助手 WebSocket 调用
const callSparkAssistant = (userMessage: string, context: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const url = new URL(SPARK_CONFIG.assistantUrl)
    const host = url.host
    const path = url.pathname
    const date = new Date().toUTCString()

    // 生成唯一用户ID，避免并发冲突
    const uid = `wiki_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const sign = async () => {
      const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`
      const signatureSha = await hmacSha256(SPARK_CONFIG.apiSecret, signatureOrigin)

      const authorizationOrigin = `api_key="${SPARK_CONFIG.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`
      const authorization = btoa(authorizationOrigin)

      return `${SPARK_CONFIG.assistantUrl}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`
    }

    sign().then(wsUrl => {
      let ws: WebSocket
      try {
        ws = new WebSocket(wsUrl)
      } catch (e) {
        reject(new Error('WebSocket创建失败'))
        return
      }

      let fullContent = ''
      let settled = false

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true
          ws.close()
          reject(new Error('讯飞助手响应超时'))
        }
      }, 25000)

      ws.onopen = () => {
        console.log('讯飞WebSocket已连接')

        // 系统提示词
        const systemPrompt = `你是"星辰AI助手"，是电子科技大学成都学院（简称"科成"）的官方校园AI助手。
学校信息：电子科技大学成都学院，民办普通本科高校，四川省教育厅主管，有成都校区（高新西区百叶路1号）和什邡校区（什邡市京什东路北段99号）。
回答要求：简洁明了（不超过200字）、准确专业、友好亲切、实用导向。如果没有相关信息，如实说明并给出通用建议。`

        const prompt = context
          ? `${systemPrompt}\n\n参考资料：\n${context}\n\n用户问题：${userMessage}`
          : `${systemPrompt}\n\n用户问题：${userMessage}`

        ws.send(JSON.stringify({
          header: { app_id: SPARK_CONFIG.appId, uid },
          parameter: {
            chat: { domain: 'general', temperature: 0.5, max_tokens: 1024 }
          },
          payload: {
            message: {
              text: [{ role: 'user', content: prompt }]
            }
          }
        }))
      }

      ws.onmessage = (event) => {
        if (settled) return
        try {
          const data = JSON.parse(event.data)
          const code = data.header?.code
          const status = data.header?.status

          if (code !== 0) {
            clearTimeout(timeout)
            settled = true
            ws.close()
            reject(new Error(`讯飞错误: ${code} - ${data.header?.message}`))
            return
          }

          const textList = data.payload?.choices?.text || []
          for (const item of textList) {
            if (item.content) fullContent += item.content
          }

          if (status === 2) {
            clearTimeout(timeout)
            settled = true
            ws.close()
            resolve(fullContent)
          }
        } catch (e) {
          console.error('解析消息失败:', e)
        }
      }

      ws.onerror = (err) => {
        console.error('讯飞WebSocket错误:', err)
        if (!settled) {
          clearTimeout(timeout)
          settled = true
          reject(new Error('讯飞WebSocket连接失败'))
        }
      }

      ws.onclose = () => {
        if (!settled) {
          clearTimeout(timeout)
          settled = true
          reject(new Error('讯飞连接已关闭'))
        }
      }
    }).catch(reject)
  })
}

// 知识库
const knowledgeBase = ref<Array<{ title: string; content: string; url: string }>>([])

// 加载知识库
const loadKnowledge = async () => {
  try {
    const res = await fetch('/knowledge.json')
    if (res.ok) {
      knowledgeBase.value = await res.json()
      console.log(`知识库加载完成: ${knowledgeBase.value.length} 条`)
    }
  } catch (e) {
    console.warn('知识库加载失败:', e)
  }
}

// 关键词匹配检索知识库，返回匹配结果（含链接）
interface KnowledgeResult {
  content: string
  links: Array<{ title: string; url: string }>
}

const searchKnowledge = (query: string): KnowledgeResult => {
  if (!knowledgeBase.value.length) return { content: '', links: [] }
  // 提取关键词：中文按2-4字切分，英文按空格切分
  const cleanQuery = query.replace(/[？，。！、\s\.\?\!]/g, '')
  const keywords: string[] = []
  // 中文关键词：2-4字的子串
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= cleanQuery.length - len; i++) {
      const sub = cleanQuery.substring(i, i + len)
      if (/[一-龥]/.test(sub)) keywords.push(sub)
    }
  }
  // 英文关键词
  query.split(/\s+/).filter(k => k.length > 1 && /[\da-z]/i.test(k)).forEach(k => keywords.push(k.toLowerCase()))
  if (!keywords.length) return { content: '', links: [] }

  const scored = knowledgeBase.value.map(item => {
    let score = 0
    const lowerContent = item.content.toLowerCase()
    const lowerTitle = item.title.toLowerCase()
    keywords.forEach(kw => {
      const lower = kw.toLowerCase()
      if (lowerContent.includes(lower)) score += 1
      if (lowerTitle.includes(lower)) score += 2
    })
    return { ...item, score }
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  // 去重链接
  const seen = new Set<string>()
  const links = scored
    .filter(item => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .map(item => ({ title: item.title, url: item.url }))

  return {
    content: scored.map(item => `【${item.title}】${item.content}`).join('\n\n'),
    links
  }
}

// 快速问题
const quickQuestions = [
  '宿舍条件怎么样？',
  '有哪些实验室可以加入？',
  '食堂好吃吗？',
  '如何选课？'
]

// 切换聊天窗口
const toggleChat = async () => {
  if (!isOpen.value) {
    // 打开：先等待按钮消失动画完成，再显示对话窗口
    await new Promise(resolve => setTimeout(resolve, 100))
    isOpen.value = true
    hasUnread.value = false
    await nextTick()
    setTimeout(() => {
      textareaRef.value?.focus()
    }, 300)
  } else {
    // 关闭：直接关闭
    isOpen.value = false
  }
}

// 频率限制：每30秒最多1次
const RATE_LIMIT_KEY = 'ai_chat_last_request'
const RATE_LIMIT_SECONDS = 30
const cooldownLeft = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

const checkRateLimit = (): boolean => {
  const last = localStorage.getItem(RATE_LIMIT_KEY)
  if (!last) return true
  const elapsed = (Date.now() - parseInt(last)) / 1000
  if (elapsed >= RATE_LIMIT_SECONDS) return true
  cooldownLeft.value = Math.ceil(RATE_LIMIT_SECONDS - elapsed)
  startCooldownTimer()
  return false
}

const recordRequest = () => {
  localStorage.setItem(RATE_LIMIT_KEY, Date.now().toString())
  cooldownLeft.value = RATE_LIMIT_SECONDS
  startCooldownTimer()
}

const startCooldownTimer = () => {
  if (cooldownTimer) clearInterval(cooldownTimer)
  cooldownTimer = setInterval(() => {
    cooldownLeft.value--
    if (cooldownLeft.value <= 0) {
      clearInterval(cooldownTimer!)
      cooldownTimer = null
    }
  }, 1000)
}

// 清空对话历史
const clearHistory = () => {
  messages.value = []
  suggestedQuestions.value = []
}

// 发送快速问题
const sendQuickQuestion = (question: string) => {
  currentInput.value = question
  sendMessage()
}

// 处理Enter键
const handleEnterKey = (event: KeyboardEvent) => {
  if (event.shiftKey) {
    // Shift + Enter 换行，允许默认行为
    return true
  }
  // 普通Enter发送消息
  event.preventDefault()
  sendMessage()
}

// 自动调整输入框高度
const adjustTextareaHeight = () => {
  const textarea = textareaRef.value
  if (textarea) {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
  }
}

// 发送消息
const sendMessage = async () => {
  const message = currentInput.value.trim()
  if (!message || isLoading.value) return

  // 频率限制检查（仅在有API时限制）
  if (isApiAvailable() && !checkRateLimit()) {
    messages.value.push({
      id: `rate_${Date.now()}`,
      content: `⏳ 操作过于频繁，请等待 ${cooldownLeft.value} 秒后再试。`,
      isUser: false,
      timestamp: Date.now()
    })
    scrollToBottom()
    return
  }

  // 添加用户消息
  const userMessage = {
    id: `user_${Date.now()}`,
    content: message,
    isUser: true,
    timestamp: Date.now()
  }
  messages.value.push(userMessage)

  // 清空输入
  currentInput.value = ''
  adjustTextareaHeight()
  scrollToBottom()
  isLoading.value = true

  // 先检索知识库，获取相关链接
  const knowledge = searchKnowledge(message)
  const context = knowledge.content
  const relatedLinks = knowledge.links

  // 如果 API 不可用，直接降级为纯推荐模式
  if (!isApiAvailable()) {
    const hasLinks = relatedLinks.length > 0
    const content = hasLinks
      ? '🔍 当前没有AI模型介入，以下是根据您的问题为您找到的相关页面：'
      : '🔍 当前没有AI模型介入，知识库中暂未找到相关页面。\n\n您可以尝试换个关键词，或直接浏览左侧菜单查找信息。'

    const aiMessage = {
      id: `ai_${Date.now()}`,
      content,
      isUser: false,
      timestamp: Date.now(),
      links: hasLinks ? relatedLinks : undefined
    }
    messages.value.push(aiMessage)
    isLoading.value = false
    scrollToBottom()
    return
  }

  // 三级降级：讯飞助手 → OpenAI → 纯推荐
  let answer = ''

  // 第一级：尝试讯飞星火助手
  try {
    console.log('尝试讯飞星火助手...')
    answer = await callSparkAssistant(message, context)
    console.log('讯飞助手调用成功')
    recordRequest()
  } catch (sparkError) {
    console.warn('讯飞助手失败，尝试OpenAI:', sparkError)

    // 第二级：尝试 OpenAI 兼容接口
    if (isApiAvailable()) {
      try {
        const systemPrompt = `你是"星辰AI助手"，是电子科技大学成都学院（简称"科成"）的官方校园AI助手。

## 你的身份
- 学校全称：电子科技大学成都学院
- 学校简称：科成
- 办学性质：民办普通本科高校
- 主管部门：四川省教育厅
- 校区分布：成都校区（四川省成都市高新西区百叶路1号）、什邡校区（四川省什邡市京什东路北段99号）
- 学校官网：https://www.cduestc.cn

## 回答要求
1. **简洁明了**：回答要简短直接，避免冗长，一般不超过200字
2. **准确专业**：基于提供的参考资料回答，确保信息准确
3. **友好亲切**：语气亲切自然，像学长学姐一样帮助新生
4. **实用导向**：给出具体可操作的建议，而不是空泛的回答
5. **诚实坦率**：如果资料中没有相关内容，如实说明并给出通用建议

## 特别注意
- 涉及具体政策、费用、时间等信息时，建议学生以学校官方最新通知为准
- 涉及专业选择、职业规划等问题时，可以给参考意见，但要提醒学生结合自身情况决定
- 涉及心理问题、人身安全等紧急情况时，建议学生及时联系学校相关部门或专业人士`

        const userPrompt = context
          ? `参考资料：\n${context}\n\n用户问题：${message}`
          : message

        const response = await fetch(`${API_CONFIG.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${API_CONFIG.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: API_CONFIG.model,
            messages: [
              { role: 'system', content: systemPrompt },
              ...messages.value.slice(-6).map(m => ({
                role: m.isUser ? 'user' as const : 'assistant' as const,
                content: m.content
              })),
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 1024
          })
        })

        if (response.ok) {
          const data = await response.json()
          answer = data.choices?.[0]?.message?.content || ''
          recordRequest()
          console.log('OpenAI调用成功')
        } else {
          console.warn('OpenAI响应错误:', response.status)
        }
      } catch (openaiError) {
        console.warn('OpenAI调用失败:', openaiError)
      }
    }
  }

  // 第三级：降级为纯推荐模式
  if (!answer) {
    const hasLinks = relatedLinks.length > 0
    answer = hasLinks
      ? '🔍 当前AI服务暂不可用，以下是根据您的问题为您找到的相关页面：'
      : '🔍 当前AI服务暂不可用，知识库中暂未找到相关页面。\n\n您可以尝试换个关键词，或直接浏览左侧菜单查找信息。'
  }

  const aiMessage = {
    id: `ai_${Date.now()}`,
    content: answer,
    isUser: false,
    timestamp: Date.now(),
    links: relatedLinks.length > 0 ? relatedLinks : undefined
  }
  messages.value.push(aiMessage)

  // 生成建议问题
  generateSuggestedQuestions(message, answer)

  if (!isOpen.value) {
    hasUnread.value = true
  }

  isLoading.value = false
  scrollToBottom()
}

// 根据上下文生成建议问题
const generateSuggestedQuestions = (question: string, answer: string) => {
  const topicKeywords: Record<string, string[]> = {
    '宿舍': ['宿舍怎么换？', '宿舍有空调吗？', '宿舍几点熄灯？'],
    '食堂': ['哪个食堂好吃？', '食堂营业时间？', '食堂价格怎么样？'],
    '选课': ['选课什么时候开始？', '怎么选体育课？', '选课系统打不开怎么办？'],
    '社团': ['有哪些社团？', '怎么加入社团？', '社团活动多吗？'],
    '实验室': ['怎么加入实验室？', '有哪些实验室？', '实验室招新条件？'],
    '军训': ['军训多长时间？', '军训要准备什么？', '军训可以请假吗？'],
    '校园网': ['校园网怎么连？', '校园卡怎么办？', '宽带怎么装？'],
    '快递': ['快递站在哪？', '快递怎么取？', '可以寄快递吗？'],
    '防骗': ['新生防骗指南', '怎么识别诈骗？', '校园贷是什么？'],
    '图书馆': ['图书馆开放时间？', '怎么借书？', '图书馆有WiFi吗？'],
  }

  const combined = question + answer
  for (const [keyword, questions] of Object.entries(topicKeywords)) {
    if (combined.includes(keyword)) {
      suggestedQuestions.value = questions
      return
    }
  }
  suggestedQuestions.value = []
}

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

// 格式化消息内容 - 增强的Markdown支持
const formatMessage = (content: string) => {
  let result = content
  
  // 先处理代码块，避免代码块内的内容被错误格式化
  const codeBlocks: string[] = []
  result = result.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const index = codeBlocks.length
    codeBlocks.push(`<pre><code class="${lang || ''}">${code.trim()}</code></pre>`)
    return `__CODE_BLOCK_${index}__`
  })
  
  // 处理行内代码，避免被其他格式化影响
  const inlineCodes: string[] = []
  result = result.replace(/`([^`]+)`/g, (match, code) => {
    const index = inlineCodes.length
    inlineCodes.push(`<code>${code}</code>`)
    return `__INLINE_CODE_${index}__`
  })
  
  // 按行处理，避免跨行匹配问题
  const lines = result.split('\n')
  const processedLines = lines.map(line => {
    // 跳过代码块占位符行
    if (line.includes('__CODE_BLOCK_') || line.includes('__INLINE_CODE_')) {
      return line
    }
    
    // 跳过标题格式，保持为普通文本
    
    // 有序列表 - 数字开头
    if (/^\d+\.\s/.test(line)) {
      const content = line.replace(/^\d+\.\s/, '')
      return `<li data-list-type="ol">${content}</li>`
    }
    // 无序列表 - 必须在行首
    else if (/^[-*+]\s/.test(line)) {
      const content = line.substring(2)
      return `<li data-list-type="ul">${content}</li>`
    }
    // 引用块
    else if (line.startsWith('> ')) {
      return `<blockquote>${line.substring(2)}</blockquote>`
    }
    
    return line
  })
  
  result = processedLines.join('\n')
  
  // 包装连续的列表项
  result = result.replace(/(<li data-list-type="ul">.*<\/li>\n?)+/g, (match) => {
    return `<ul>${match.replace(/\n/g, '').replace(/ data-list-type="ul"/g, '')}</ul>`
  })
  result = result.replace(/(<li data-list-type="ol">.*<\/li>\n?)+/g, (match) => {
    return `<ol>${match.replace(/\n/g, '').replace(/ data-list-type="ol"/g, '')}</ol>`
  })
  
  // 其他格式化
  result = result
    // 链接格式 [文本](链接)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    
    // 删除线
    .replace(/~~(.*?)~~/g, '<del>$1</del>')
    
    // 加粗和斜体 - 更精确的匹配
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    
    // 下划线加粗和斜体
    .replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    
    // 高亮文本
    .replace(/==([^=]+)==/g, '<mark>$1</mark>')
    
    // 换行
    .replace(/\n/g, '<br>')
  
  // 恢复代码块
  codeBlocks.forEach((block, index) => {
    result = result.replace(`__CODE_BLOCK_${index}__`, block)
  })
  
  // 恢复行内代码
  inlineCodes.forEach((code, index) => {
    result = result.replace(`__INLINE_CODE_${index}__`, code)
  })
  
  return result
}

// 格式化时间
const formatTime = (timestamp: number) => {
  const date = new Date(timestamp)
  const now = new Date()
  
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    })
  } else {
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
}

// 处理消息中的链接点击
const handleMessageClick = (event: Event) => {
  const target = event.target as HTMLElement
  
  // 处理Tip链接点击
  if (target.classList.contains('tip-link')) {
    event.preventDefault()
    const url = target.getAttribute('data-url')
    
    if (url) {
      // 复制链接到剪贴板
      navigator.clipboard?.writeText(url).then(() => {
        // 显示复制成功的提示
        target.setAttribute('data-tip', '链接已复制！')
        setTimeout(() => {
          target.setAttribute('data-tip', '点击复制链接')
        }, 2000)
      }).catch(() => {
        // 如果复制失败，直接打开链接
        window.open(url, '_blank')
      })
    }
  }
}

// 处理点击外部关闭
const handleClickOutside = (event: Event) => {
  const target = event.target as HTMLElement
  if (isOpen.value && !target.closest('.ai-chat-container')) {
    // 可以在这里添加点击外部关闭的逻辑
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
  loadKnowledge()
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.ai-chat-container {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 1000;
  font-family: var(--vp-font-family-base);
  width: 380px;
  height: 600px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  pointer-events: none;
}

.ai-chat-container > * {
  pointer-events: auto;
}

/* 悬浮按钮 */
.chat-float-button {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--vp-c-brand-1), var(--vp-c-brand-2));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
  position: relative;
  z-index: 1001;
}

.chat-float-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 25px rgba(0, 0, 0, 0.2);
}

.chat-icon {
  font-size: 24px;
}

.unread-dot {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 12px;
  height: 12px;
  background: #ff4757;
  border-radius: 50%;
  border: 2px solid white;
}

/* 对话窗口 */
.chat-window {
  width: 380px;
  height: 600px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 16px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: absolute;
  bottom: 0;
  right: 0;
  z-index: 1002;
}

/* 标题栏 */
.chat-header {
  padding: 12px 20px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  font-size: 20px;
  color: var(--vp-c-brand-1);
}

.header-title {
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin-bottom: 1px;
  font-size: 14px;
  line-height: 1.2;
}

.header-subtitle {
  font-size: 11px;
  color: var(--vp-c-text-2);
  line-height: 1.2;
}

.header-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-2);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 16px;
}

.action-btn:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  transform: scale(1.05);
}

/* 消息区域 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  scroll-behavior: smooth;
}

.welcome-message {
  text-align: center;
  padding: 20px;
  color: var(--vp-c-text-2);
}

.welcome-icon {
  font-size: 48px;
  color: var(--vp-c-brand-1);
  margin-bottom: 16px;
}

.welcome-text h3 {
  margin: 0 0 8px 0;
  color: var(--vp-c-text-1);
}

.welcome-text p {
  margin: 0 0 16px 0;
  line-height: 1.5;
}

.quick-questions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.quick-btn {
  padding: 8px 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 14px;
}

.quick-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

/* 消息样式 */
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.user-message {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.user-message .message-avatar {
  background: var(--vp-c-brand-1);
  color: white;
}

.ai-message .message-avatar {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}

.avatar-icon {
  font-size: 16px;
}

.message-content {
  max-width: 80%;
  min-width: 0;
}

.user-message .message-content {
  text-align: right;
}

.message-text {
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.5;
  word-wrap: break-word;
}

/* 只保留必要的消息布局样式，其他样式由 vp-doc 类提供 */

/* Tip链接样式 - 项目特有组件 */
.message-text .tip-link {
  position: relative;
  color: var(--vp-c-brand-1);
  text-decoration: underline dashed var(--vp-c-text-3);
  text-underline-offset: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.message-text .tip-link:hover {
  color: var(--vp-c-brand-2);
  text-decoration-color: var(--vp-c-brand-1);
}

.message-text .tip-link:active {
  transform: scale(0.98);
}


.user-message .message-text {
  background: var(--vp-c-brand-1);
  color: white;
  border-bottom-right-radius: 4px;
}

/* 用户消息样式（不使用VitePress样式） */
.user-message .message-text {
  color: white;
}

.user-message .message-text * {
  color: inherit;
}

.user-message .message-text strong {
  font-weight: 600;
}

.user-message .message-text em {
  font-style: italic;
}

.user-message .message-text code {
  background: rgba(255, 255, 255, 0.2);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.9em;
}

.user-message .message-text a {
  color: rgba(255, 255, 255, 0.9);
  text-decoration: underline;
}

.user-message .message-text a:hover {
  color: white;
}

.user-message .message-text .tip-link {
  color: rgba(255, 255, 255, 0.9);
  text-decoration-color: rgba(255, 255, 255, 0.5);
}

.user-message .message-text .tip-link:hover {
  color: white;
  text-decoration-color: rgba(255, 255, 255, 0.8);
}

.ai-message .message-text {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border-bottom-left-radius: 4px;
}

.message-time {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
  padding: 0 14px;
}

/* 相关页面链接 */
.message-links {
  margin-top: 8px;
  padding: 8px 12px;
  background: var(--vp-c-bg-mute);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.links-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--vp-c-text-2);
  margin-bottom: 6px;
  font-weight: 500;
}

.links-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.2s ease;
  background: var(--vp-c-bg);
  border: 1px solid transparent;
}

.link-item:hover {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-2);
}

/* 加载动画 */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 10px 14px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  border-bottom-left-radius: 4px;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background: var(--vp-c-text-3);
  border-radius: 50%;
  animation: typing 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typing {
  0%, 80%, 100% {
    transform: scale(0.8);
    opacity: 0.4;
  }
  40% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Dify建议问题 */
.suggested-questions {
  margin: 12px 0 8px 0;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
}

.suggested-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-bottom: 6px;
  font-weight: 500;
}

.suggested-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.suggested-btn {
  padding: 4px 8px;
  text-align: center;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 11px;
  line-height: 1.3;
  flex: 1;
  min-width: 80px;
  max-width: 120px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.suggested-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  transform: translateY(-1px);
}

/* 输入区域 */
.chat-input-area {
  padding: 16px 20px;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.input-container {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.chat-input {
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  padding: 10px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.4;
  resize: none;
  outline: none;
  transition: border-color 0.2s ease;
  overflow-y: hidden;
  vertical-align: top;
}

/* 隐藏textarea的上下箭头和滚动条 */
.chat-input::-webkit-scrollbar {
  display: none;
}

.chat-input {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.chat-input:focus {
  border-color: var(--vp-c-brand-1);
}

.chat-input::placeholder {
  color: var(--vp-c-text-3);
}

.send-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: var(--vp-c-brand-1);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.send-btn:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
  transform: scale(1.05);
}

.send-btn:disabled {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-3);
  cursor: not-allowed;
}

.input-tips {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 8px;
  text-align: center;
}

.cooldown-tip {
  color: var(--vp-c-warning-1, #f59e0b);
  font-weight: 500;
}

/* 动画效果 */
.float-button-enter-active {
  transition: all 0.25s ease;
  transition-delay: 0.2s;
}

.float-button-leave-active {
  transition: all 0.2s ease;
}

.float-button-enter-from,
.float-button-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

.chat-window-enter-active {
  transition: all 0.25s ease;
  transition-delay: 0.2s;
}

.chat-window-leave-active {
  transition: all 0.2s ease;
}

.chat-window-enter-from {
  opacity: 0;
  transform: translateY(20px) scale(0.9);
}

.chat-window-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.95);
}

/* 移动端适配 */
@media (max-width: 768px) {
  .ai-chat-container {
    bottom: 80px;
    right: 16px;
  }
  
  .chat-window {
    width: calc(100vw - 32px);
    height: calc(100vh - 200px);
    max-height: 600px;
  }
  
  .chat-float-button {
    width: 56px;
    height: 56px;
  }
  
  .chat-icon {
    font-size: 22px;
  }
}

/* 深色模式适配 */
@media (prefers-color-scheme: dark) {
  .chat-float-button {
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  }
  
  .chat-window {
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.3);
  }
}
</style>
