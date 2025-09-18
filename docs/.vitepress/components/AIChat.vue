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
              <div class="header-subtitle">为您解答校园生活问题</div>
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
              :disabled="!currentInput.trim() || isLoading"
              class="send-btn"
            >
              <Icon icon="ri:send-plane-2-fill" />
            </button>
          </div>
          <div class="input-tips">
            按 Enter 发送，Shift + Enter 换行
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
}>>([])
const suggestedQuestions = ref<string[]>([])
const lastMessageId = ref<string>('')

// DOM引用
const messagesContainer = ref<HTMLElement>()
const textareaRef = ref<HTMLTextAreaElement>()

// Dify配置 - 写死的配置
const DIFY_CONFIG = {
  apiKey: 'app-q4R3gQRoWLnkMveJMIvC62y9', // 直接写您的API Key
  baseUrl: 'https://chat.lzgzxs.xyz/v1', // 使用HTTPS
  user: 'cduestc-wiki-user' // 固定用户标识
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

// 清空对话历史
const clearHistory = () => {
  messages.value = []
  suggestedQuestions.value = []
  // 清空会话ID，开始新对话
  sessionStorage.removeItem('dify_conversation_id')
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

  // 添加用户消息
  const userMessage = {
    id: `user_${Date.now()}`,
    content: message,
    isUser: true,
    timestamp: Date.now()
  }
  messages.value.push(userMessage)
  
  // 清空输入和建议问题
  currentInput.value = ''
  suggestedQuestions.value = []
  adjustTextareaHeight()
  
  // 滚动到底部
  scrollToBottom()
  
  // 开始加载
  isLoading.value = true
  
  try {
    // 构建请求体，按照Dify官方文档规范
    const requestBody = {
      inputs: {},
      query: message,
      response_mode: 'blocking', // 使用blocking模式，streaming需要额外处理SSE
      user: DIFY_CONFIG.user,
      auto_generate_name: true
    }
    
    // 只有存在会话ID时才添加，避免传undefined
    const conversationId = getConversationId()
    if (conversationId) {
      requestBody.conversation_id = conversationId
    }
    
    console.log('发送聊天请求:', requestBody)
    
    // 调用Dify API
    const response = await fetch(`${DIFY_CONFIG.baseUrl}/chat-messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DIFY_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    if (!response.ok) {
      // 获取详细错误信息
      let errorMessage = '抱歉，服务暂时不可用'
      
      try {
        const errorData = await response.json()
        console.error('Dify API错误响应:', errorData)
        
        // 解析具体的错误类型
        if (errorData.code === 'invalid_param' && errorData.message) {
          const message = errorData.message
          
          // 检查是否是配额限制错误
          if (message.includes('exceeded your current quota') || message.includes('RESOURCE_EXHAUSTED')) {
            errorMessage = '🚫 AI服务配额已用完，请明天再试或联系管理员升级配额'
          } else if (message.includes('rate limit') || response.status === 429) {
            errorMessage = '⏳ 请求过于频繁，请稍后再试'
          } else if (message.includes('API request failed')) {
            errorMessage = '🔧 AI服务暂时不可用，请稍后重试'
          } else {
            errorMessage = `❌ 请求错误: ${errorData.message.substring(0, 100)}...`
          }
        } else {
          errorMessage = errorData.message || errorMessage
        }
      } catch (e) {
        const errorText = await response.text()
        console.error(`API错误 ${response.status}:`, errorText)
        
        // 根据HTTP状态码提供友好的错误信息
        switch (response.status) {
          case 400:
            errorMessage = '❌ 请求参数错误，请稍后重试'
            break
          case 401:
            errorMessage = '🔑 API密钥无效，请联系管理员'
            break
          case 404:
            errorMessage = '🔍 服务不存在，请检查配置'
            break
          case 429:
            errorMessage = '⏳ 请求过于频繁，请稍后重试'
            break
          case 500:
            errorMessage = '🛠️ 服务器内部错误，请稍后重试'
            break
        }
      }
      
      throw new Error(errorMessage)
    }

    const data = await response.json()
    console.log('Dify API响应:', data)
    
    // 按照官方文档验证响应格式
    if (data.event !== 'message') {
      console.error('意外的响应格式:', data)
      throw new Error('服务响应格式异常')
    }
    
    // 添加AI回复
    const aiMessage = {
      id: data.message_id || `ai_${Date.now()}`,
      content: data.answer || '抱歉，我现在无法回答这个问题。',
      isUser: false,
      timestamp: data.created_at ? data.created_at * 1000 : Date.now() // Dify返回Unix时间戳(秒)
    }
    messages.value.push(aiMessage)
    
    // 保存会话ID
    if (data.conversation_id) {
      sessionStorage.setItem('dify_conversation_id', data.conversation_id)
    }
    
    // 保存最后一个消息ID并获取建议问题
    if (data.message_id) {
      lastMessageId.value = data.message_id
      await fetchSuggestedQuestions(data.message_id)
    }
    
    // 如果窗口关闭，显示未读提示
    if (!isOpen.value) {
      hasUnread.value = true
    }
    
  } catch (error) {
    console.error('AI对话错误:', error)
    
    // 添加错误消息
    const errorMessage = {
      id: `error_${Date.now()}`,
      content: error instanceof Error ? error.message : '抱歉，服务暂时不可用，请稍后再试。',
      isUser: false,
      timestamp: Date.now()
    }
    messages.value.push(errorMessage)
  } finally {
    isLoading.value = false
    scrollToBottom()
  }
}

// 获取会话ID
const getConversationId = () => {
  return sessionStorage.getItem('dify_conversation_id') || undefined
}

// 获取建议问题 - 按照Dify官方API规范
const fetchSuggestedQuestions = async (messageId: string) => {
  try {
    // 构建查询参数 - 必须包含user参数
    const params = new URLSearchParams({
      user: DIFY_CONFIG.user
    })
    
    const url = `${DIFY_CONFIG.baseUrl}/messages/${messageId}/suggested?${params}`
    console.log('获取建议问题URL:', url)
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${DIFY_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      const result = await response.json()
      console.log('建议问题响应:', result)
      
      // 按照官方API规范检查响应格式
      if (result.result === 'success' && result.data && Array.isArray(result.data) && result.data.length > 0) {
        // data是字符串数组，直接使用
        suggestedQuestions.value = result.data
      } else {
        // 如果没有建议问题或返回错误，清空数组
        suggestedQuestions.value = []
      }
    } else {
      // API调用失败，打印详细错误信息
      const errorText = await response.text()
      console.error(`获取建议问题失败: HTTP ${response.status}`)
      console.error('错误响应:', errorText)
      suggestedQuestions.value = []
    }
  } catch (error) {
    console.error('获取建议问题失败:', error)
    // 如果API失败，不显示建议问题
    suggestedQuestions.value = []
  }
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
