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

    <!-- 划词提问：选中页面文字后浮现的小按钮 -->
    <button
      v-if="selectionAction"
      class="selection-ask-btn"
      :style="{ left: `${selectionAction.x}px`, top: `${selectionAction.y}px` }"
      type="button"
      @mousedown.prevent
      @click="askAboutSelection"
    >
      <Icon icon="ri:chat-quote-line" />
      问 AI
    </button>

    <!-- 对话窗口 -->
    <Transition name="chat-window">
      <div v-show="isOpen" class="chat-window" @dragover.prevent @drop.prevent="onDrop">
        <!-- 标题栏 -->
        <div class="chat-header">
          <div class="header-info">
            <Icon icon="ri:robot-2-fill" class="header-icon" />
            <div>
              <div class="header-title">星辰AI助手</div>
              <div class="header-subtitle">基于校园知识库的AI助手</div>
            </div>
          </div>
          <div class="header-actions">
            <div class="mode-select">
              <button
                class="mode-btn"
                :class="{ active: chatMode === 'byow' }"
                v-tip="'选择回答来源'"
                @click.stop="onModeButtonClick"
              >
                <Icon :icon="chatMode === 'byow' ? 'ri:flashlight-line' : 'ri:cloud-line'" />
                <span>{{ chatMode === 'byow' ? `直连·${bridgeUpstream}` : '网关' }}</span>
                <Icon icon="ri:arrow-down-s-line" class="mode-caret" :class="{ open: modeMenuOpen }" />
              </button>
              <Transition name="mode-menu">
                <div v-if="modeMenuOpen" class="mode-menu" @click.stop>
                  <button
                    class="mode-option"
                    :class="{ selected: chatMode === 'gateway' }"
                    type="button"
                    @click="selectMode('gateway')"
                  >
                    <Icon icon="ri:cloud-line" class="mode-option-icon" />
                    <div class="mode-option-body">
                      <div class="mode-option-title">校园网关</div>
                      <div class="mode-option-desc">科成星球提供的 AI 服务</div>
                    </div>
                    <Icon v-if="chatMode === 'gateway'" icon="ri:check-line" class="mode-option-check" />
                  </button>
                  <button
                    v-for="option in upstreamOptions"
                    :key="option.id"
                    class="mode-option"
                    :class="{
                      selected: chatMode === 'byow' && bridgeUpstreamId === option.id,
                      disabled: !bridgeReady,
                    }"
                    type="button"
                    :disabled="!bridgeReady"
                    @click="selectMode('byow', option.id)"
                  >
                    <Icon icon="ri:flashlight-line" class="mode-option-icon" />
                    <div class="mode-option-body">
                      <div class="mode-option-title">
                        {{ option.label }}
                        <span class="mode-option-badge">本地直连</span>
                      </div>
                      <div class="mode-option-desc">用你自己登录的 {{ option.label }} 账号回答</div>
                    </div>
                    <Icon
                      v-if="chatMode === 'byow' && bridgeUpstreamId === option.id"
                      icon="ri:check-line"
                      class="mode-option-check"
                    />
                  </button>
                  <div v-if="!bridgeReady" class="mode-menu-foot">
                    未检测到「科成星球 AI 直连」扩展，<a href="/ai-extension">查看安装说明</a>
                  </div>
                </div>
              </Transition>
            </div>
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
          <!-- 本地直连推荐提示：检测到扩展且当前在网关模式时出现，可一键切换或关闭 -->
          <div v-if="showDirectHint" class="direct-hint">
            <Icon icon="ri:flashlight-line" class="direct-hint-icon" />
            <div class="direct-hint-body">
              <div class="direct-hint-title">检测到「本地直连」扩展</div>
              <div class="direct-hint-desc">切到直连模式，回答由你自己登录的豆包 / DeepSeek 账号生成，更快更稳。</div>
            </div>
            <div class="direct-hint-actions">
              <button class="direct-hint-switch" type="button" @click="acceptDirectHint">切换</button>
              <button class="direct-hint-close" type="button" aria-label="暂不切换" @click="dismissDirectHint">
                <Icon icon="ri:close-line" />
              </button>
            </div>
          </div>

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
                  type="button"
                >
                  <span>{{ question }}</span>
                  <Icon icon="ri:arrow-right-line" class="question-arrow" aria-hidden="true" />
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
                v-if="message.isUser"
                class="message-text"
              >{{ message.content }}</div>
              <!-- 直连流式占位：内容未到达时只在气泡内显示输入中动画，避免与全局加载指示重复 -->
              <div v-else-if="message.streaming && !message.content" class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <div
                v-else
                class="message-text vp-doc"
                v-html="formatMessage(message.content)"
              ></div>
              <!-- 已发送消息里的附件（图片缩略图可点击/双击看大图） -->
              <div v-if="message.attachments && message.attachments.length > 0" class="msg-attachments">
                <template v-for="(item, index) in message.attachments" :key="`${item.name}_${index}`">
                  <img
                    v-if="item.mime.startsWith('image/')"
                    class="msg-attach-thumb"
                    :src="`data:${item.mime};base64,${item.data}`"
                    alt=""
                    title="点击查看大图"
                    @click="openImagePreview(item)"
                  >
                  <span v-else class="msg-attach-file">
                    <Icon icon="ri:file-text-line" />
                    {{ item.name }}
                  </span>
                </template>
              </div>
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
              <div v-if="!message.streaming" class="message-time">{{ formatTime(message.timestamp) }}</div>
              <div v-if="!message.isUser && !message.streaming" class="message-feedback">
                <button
                  :class="{ active: message.feedback === 'up', liking: message.feedbackState === 'liking' }"
                  aria-label="有帮助"
                  @click="rateMessage(message, 'up')"
                  v-tip="'有帮助'"
                >
                  <Icon icon="ri:thumb-up-line" />
                </button>
                <button
                  :class="{
                    active: message.feedback === 'down',
                    'dislike-warn': message.feedbackState === 'dislike-warn',
                    'dislike-confirmed': message.feedbackState === 'dislike-confirmed',
                  }"
                  aria-label="没帮助"
                  @click="rateMessage(message, 'down')"
                  v-tip="'没帮助'"
                >
                  <Icon icon="ri:thumb-down-line" />
                </button>
                <!-- 反馈浮层：气泡文案与星星粒子，绝对定位于反馈区上方 -->
                <div
                  v-if="message.feedbackState && message.feedbackState !== 'idle'"
                  class="feedback-overlay"
                  :class="message.feedbackState"
                >
                  <span class="feedback-bubble">
                    {{ feedbackBubbles.get(message.id) }}
                    <i v-if="message.feedbackState === 'dislike-warn'" class="kaomoji">(；ω；)</i>
                    <i v-else-if="message.feedbackState === 'dislike-confirmed'" class="kaomoji">(´；ω；)`</i>
                  </span>
                  <span v-if="message.feedbackState === 'liking'" class="feedback-stars" aria-hidden="true">
                    <i v-for="n in 6" :key="n" class="star">★</i>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- 加载状态：直连流式占位已自带输入中动画，这里只在没有流式占位时显示 -->
          <div v-if="isLoading && !streamingMessageActive" class="message ai-message">
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
                type="button"
              >
                <span>{{ question }}</span>
                <Icon icon="ri:arrow-right-line" class="question-arrow" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="chat-input-area">
          <!-- 划词引用（来自页面选中文字） -->
          <div v-if="quotedSelection" class="quote-chip">
            <Icon icon="ri:chat-quote-line" class="quote-chip-icon" />
            <span class="quote-chip-text">「{{ quotedSelection.length > 60 ? `${quotedSelection.slice(0, 60)}…` : quotedSelection }}」</span>
            <button class="quote-chip-remove" type="button" aria-label="移除引用" @click="quotedSelection = ''">
              <Icon icon="ri:close-line" />
            </button>
          </div>
          <!-- 待发送附件（仅本地直连支持） -->
          <div v-if="chatMode === 'byow' && pendingAttachments.length > 0" class="attach-chips">
            <div v-for="(item, index) in pendingAttachments" :key="`${item.name}_${index}`" class="attach-chip">
              <img
                v-if="item.mime.startsWith('image/')"
                class="attach-chip-thumb"
                :src="`data:${item.mime};base64,${item.data}`"
                alt=""
                title="点击查看大图"
                @click="openImagePreview(item)"
              >
              <Icon v-else icon="ri:file-text-line" class="attach-chip-icon" />
              <span class="attach-chip-name">{{ item.name }}</span>
              <button class="attach-chip-remove" type="button" aria-label="移除附件" @click="removeAttachment(index)">
                <Icon icon="ri:close-line" />
              </button>
            </div>
          </div>
          <div v-if="attachmentHint" class="attach-hint">{{ attachmentHint }}</div>
          <div class="input-container">
            <button
              v-if="chatMode === 'byow'"
              class="attach-btn"
              type="button"
              aria-label="添加图片或文件"
              v-tip="'添加图片或文件'"
              :disabled="isLoading"
              @click="onAttachClick"
            >
              <Icon icon="ri:attachment-line" />
            </button>
            <input
              ref="fileInputRef"
              class="attach-input"
              type="file"
              multiple
              :accept="ATTACHMENT_ACCEPT"
              @change="onFilesPicked"
            />
            <textarea
              v-model="currentInput"
              @keydown.enter="handleEnterKey"
              @input="adjustTextareaHeight"
              @paste="onPaste"
              ref="textareaRef"
              class="chat-input"
              placeholder="请输入您的问题…"
              rows="1"
              :disabled="isLoading"
            ></textarea>
            <button
              @click="sendMessage"
              :disabled="(!currentInput.trim() && pendingAttachments.length === 0) || isLoading || cooldownLeft > 0"
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

    <!-- 图片大图预览（点击缩略图打开，点击任意处或按 Esc 关闭） -->
    <div v-if="previewImage" class="image-preview-overlay" @click="closeImagePreview">
      <img class="image-preview-img" :src="previewImage.src" :alt="previewImage.name">
      <div class="image-preview-caption">{{ previewImage.name }} · 点击任意处或按 Esc 关闭</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import { rewriteRetrievalQuery, searchKnowledge, selectRelatedSources } from '../ai/knowledge'
import type { KnowledgeEntry, SemanticIndex } from '../ai/knowledge'
import type { AIAttachment } from '../ai/types'
import { activeAIProvider, extensionAIProvider } from '../ai/provider'
import { connectExtensionBridge } from '../ai/providers/extension'
import { bridgeInfo, setBridgeProvider, upstreamLabel } from '../ai/bridge'
import { OPENAI_CONFIG } from '../ai/config'
import { redactTelemetryQuery, sanitizeUserInput } from '../ai/security'

// 状态管理
const isOpen = ref(false)
const currentInput = ref('')
const isLoading = ref(false)
const hasUnread = ref(false)

// ==== 附件（仅本地直连支持；云端网关为纯文本） ====
const ATTACHMENT_ACCEPT = 'image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
const MAX_ATTACHMENT_COUNT = 3
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const pendingAttachments = ref<AIAttachment[]>([])
const attachmentHint = ref('')
const fileInputRef = ref<HTMLInputElement>()
let attachmentHintTimer: ReturnType<typeof setTimeout> | null = null

const showAttachmentHint = (text: string) => {
  attachmentHint.value = text
  if (attachmentHintTimer) clearTimeout(attachmentHintTimer)
  attachmentHintTimer = setTimeout(() => { attachmentHint.value = '' }, 4000)
}

// 图片大图预览（点击缩略图打开，Esc / 点击遮罩关闭）
const previewImage = ref<{ src: string; name: string } | null>(null)
const openImagePreview = (item: AIAttachment) => {
  previewImage.value = { src: `data:${item.mime};base64,${item.data}`, name: item.name }
}
const closeImagePreview = () => {
  previewImage.value = null
}
const onPreviewKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && previewImage.value)
    closeImagePreview()
}

// 网关模式点击附件按钮：给出提示（校园网关是纯文本通道）
const onAttachClick = () => {
  if (chatMode.value !== 'byow') {
    showAttachmentHint('校园网关不支持图片 / 文件，切换到「本地直连」即可（豆包 / DeepSeek）')
    return
  }
  fileInputRef.value?.click()
}

// ==== 划词提问：选中 Wiki 正文后浮现「问 AI」按钮 ====
const quotedSelection = ref('')
const selectionAction = ref<{ x: number, y: number, text: string } | null>(null)
const MAX_QUOTE_CHARS = 500

const clearSelectionAction = () => {
  selectionAction.value = null
}

// 只允许正文区域的划词（排除聊天窗自身、代码块复制按钮等）
const isSelectionEligible = (node: Node | null) => {
  if (!node)
    return false
  const element = node.nodeType === Node.ELEMENT_NODE ? node as HTMLElement : node.parentElement
  if (!element)
    return false
  if (element.closest('.chat-window, .chat-float-button, .selection-ask-btn'))
    return false
  return Boolean(element.closest('.vp-doc, .VPDoc, .VPHome, .vp-doc.container'))
}

const onSelectionChange = () => {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    clearSelectionAction()
    return
  }
  const text = selection.toString().replace(/\s+/g, ' ').trim()
  if (text.length < 4) {
    clearSelectionAction()
    return
  }
  const range = selection.getRangeAt(0)
  if (!isSelectionEligible(range.commonAncestorContainer)) {
    clearSelectionAction()
    return
  }
  const rect = range.getBoundingClientRect()
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    clearSelectionAction()
    return
  }
  // 按钮浮在选区上方居中（视口坐标，容器为 fixed 定位）
  selectionAction.value = {
    x: Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70),
    y: Math.max(rect.top - 10, 60),
    text: text.slice(0, MAX_QUOTE_CHARS),
  }
}

const askAboutSelection = () => {
  const action = selectionAction.value
  if (!action)
    return
  quotedSelection.value = action.text
  clearSelectionAction()
  window.getSelection()?.removeAllRanges()
  if (!isOpen.value)
    toggleChat()
  nextTick(() => {
    textareaRef.value?.focus()
    scrollToBottom()
  })
}

const removeAttachment = (index: number) => {
  pendingAttachments.value.splice(index, 1)
}

const readFileAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => {
    const result = String(reader.result || '')
    const comma = result.indexOf(',')
    resolve(comma >= 0 ? result.slice(comma + 1) : '')
  }
  reader.onerror = () => reject(new Error('读取失败'))
  reader.readAsDataURL(file)
})

const addFiles = async (files: File[]) => {
  if (chatMode.value !== 'byow') {
    showAttachmentHint('校园网关不支持图片 / 文件，切换到「本地直连」即可（豆包 / DeepSeek）')
    return
  }
  for (const file of files) {
    if (pendingAttachments.value.length >= MAX_ATTACHMENT_COUNT) {
      showAttachmentHint(`最多添加 ${MAX_ATTACHMENT_COUNT} 个附件`)
      break
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showAttachmentHint(`${file.name || '图片'} 超过 5MB，请压缩后再上传`)
      continue
    }
    try {
      const data = await readFileAsBase64(file)
      if (!data)
        continue
      pendingAttachments.value.push({
        name: file.name || `粘贴的图片-${pendingAttachments.value.length + 1}.png`,
        mime: file.type || 'application/octet-stream',
        data,
      })
    }
    catch {
      showAttachmentHint(`${file.name || '附件'} 读取失败`)
    }
  }
}

const onFilesPicked = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  await addFiles(files)
}

// 粘贴图片/文件（和豆包等主流 AI 对话框一致的用法）
const onPaste = (event: ClipboardEvent) => {
  const files: File[] = []
  const items = event.clipboardData?.items
  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file)
          files.push(file)
      }
    }
  }
  if (files.length) {
    event.preventDefault()
    void addFiles(files)
  }
}

// 拖拽文件到聊天窗
const onDrop = (event: DragEvent) => {
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length)
    void addFiles(files)
}

type ChatMessage = {
  id: string
  content: string
  isUser: boolean
  timestamp: number
  links?: Array<{ title: string; url: string }>
  feedback?: 'up' | 'down' | null
  // 反馈动效状态：赞动画中 / 首次踩求饶中 / 二次踩已生效
  feedbackState?: 'idle' | 'liking' | 'dislike-warn' | 'dislike-confirmed'
  // 直连流式占位消息：内容到达前在气泡内显示输入中动画，不显示时间/点赞栏
  streaming?: boolean
  // 用户消息携带的附件（用于在气泡里渲染缩略图 / 文件芯片）
  attachments?: AIAttachment[]
}
const messages = ref<ChatMessage[]>([])
// 是否已有直连流式占位气泡：有它时不再显示全局加载指示器，避免同时出现两个占位框
const streamingMessageActive = computed(() => messages.value.some(item => item.streaming))
const suggestedQuestions = ref<string[]>([])
let requestController: AbortController | null = null

// 聊天模式：gateway=校园 AI 网关（默认，原有功能）；byow=本地直连
// （「科成星球 AI 直连」浏览器扩展，用用户自己登录的豆包 / DeepSeek 回答）
type ChatMode = 'gateway' | 'byow'
const CHAT_MODE_KEY = 'ai_chat_mode'
const chatMode = ref<ChatMode>('gateway')
const bridgeReady = ref(false)
// 切回网关模式时清空附件（网关不支持附件）；顺带清掉残留的附件提示
watch(chatMode, (mode) => {
  attachmentHint.value = ''
  if (mode !== 'byow') {
    pendingAttachments.value = []
  }
})
const bridgeUpstreamId = ref('deepseek')
const bridgeUpstream = computed(() => upstreamLabel(bridgeUpstreamId.value) || '直连')
const modeMenuOpen = ref(false)

// 直连可选上游：以扩展实际注册的能力为准，扩展未连接时用默认列表兜底展示
const upstreamOptions = computed(() => {
  const ids = bridgeReady.value && bridgeInfo.value?.providers?.length
    ? bridgeInfo.value.providers
    : ['deepseek', 'doubao']
  return ids.map(id => ({ id, label: upstreamLabel(id) }))
})

const detectExtension = async () => {
  const info = await connectExtensionBridge()
  bridgeReady.value = Boolean(info)
  if (info?.provider)
    bridgeUpstreamId.value = info.provider
  // 用户明确关过推荐提示就不再打扰
  directHintDismissed.value = localStorage.getItem(DIRECT_HINT_KEY) === '1'
  // 恢复用户上次的模式选择；扩展掉线时保持网关
  if (localStorage.getItem(CHAT_MODE_KEY) === 'byow' && bridgeReady.value)
    chatMode.value = 'byow'
}

// 打开模式菜单时，若此前握手失败（例如扩展后台冷启动还没醒）就再检测一次，自愈
const onModeButtonClick = () => {
  modeMenuOpen.value = !modeMenuOpen.value
  if (modeMenuOpen.value && !bridgeReady.value)
    void detectExtension()
}

const currentProvider = computed(() =>
  chatMode.value === 'byow' && bridgeReady.value ? extensionAIProvider : activeAIProvider,
)

// 本地直连推荐提示：仅在「检测到扩展 + 当前在网关模式 + 用户没关过」时显示一次
const DIRECT_HINT_KEY = 'ai_direct_hint_dismissed'
const directHintDismissed = ref(false)
const showDirectHint = computed(() =>
  bridgeReady.value && chatMode.value === 'gateway' && !directHintDismissed.value,
)

const dismissDirectHint = () => {
  directHintDismissed.value = true
  localStorage.setItem(DIRECT_HINT_KEY, '1')
}

const acceptDirectHint = () => {
  dismissDirectHint()
  chatMode.value = 'byow'
  localStorage.setItem(CHAT_MODE_KEY, 'byow')
}

// 切换回答来源：网关，或直连下的某个上游（豆包 / DeepSeek）
const selectMode = async (mode: ChatMode, upstreamId?: string) => {
  if (mode === 'gateway') {
    chatMode.value = 'gateway'
    localStorage.setItem(CHAT_MODE_KEY, 'gateway')
    modeMenuOpen.value = false
    return
  }

  if (!bridgeReady.value)
    await detectExtension()
  if (!bridgeReady.value) {
    messages.value.push({
      id: `bridge_${Date.now()}`,
      content: '🧩 未检测到「科成星球 AI 直连」浏览器扩展。\n\n请参照 [使用说明](/ai-extension) 安装扩展（需在 Chrome / Edge 加载并登录豆包或 DeepSeek），或继续用校园网关提问。',
      isUser: false,
      timestamp: Date.now(),
    })
    scrollToBottom()
    modeMenuOpen.value = false
    return
  }

  if (upstreamId && upstreamId !== bridgeUpstreamId.value) {
    const result = await setBridgeProvider(upstreamId)
    if (!result.ok) {
      messages.value.push({
        id: `switch_${Date.now()}`,
        content: `⚠️ 切换上游失败：${result.message || '扩展未响应'}。请重试，或点扩展图标在弹窗里切换。`,
        isUser: false,
        timestamp: Date.now(),
      })
      scrollToBottom()
      return
    }
    bridgeUpstreamId.value = upstreamId
  }

  chatMode.value = 'byow'
  localStorage.setItem(CHAT_MODE_KEY, 'byow')
  modeMenuOpen.value = false
}

// 流式渲染期间隐藏结尾可能正在写入的 [[sources:...]] 标记，完成后统一替换为干净正文
const stripLiveCitations = (text: string) =>
  text.replace(/\s*\[{1,2}\s*(?:sources?|来源)?\s*[:：]?\s*[^\]]*$/gi, '')

// DOM引用
const messagesContainer = ref<HTMLElement>()
const textareaRef = ref<HTMLTextAreaElement>()

// 知识库
const knowledgeBase = ref<KnowledgeEntry[]>([])
const knowledgeStatus = ref<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
let knowledgeLoadPromise: Promise<void> | null = null
let knowledgeManifestPromise: Promise<{ version?: string; file?: string; shards?: Record<string, string>; semantic?: SemanticIndex }> | null = null
const loadedKnowledgeShards = new Set<string>()
const knowledgeSemanticIndex = ref<SemanticIndex>()

// 分片按文档 URL 首段划分（见 gen-knowledge.py），而按查询关键词做路由是另一套
// 独立逻辑，两者必然错配。实测 50 条评测集：全量 Recall@4=0.92，关键词路由仅 0.88，
// 且「校园网怎么连接」（目标页 /study/network）这类高频问题会稳定漏召。
// 因此首次提问一律并行加载全部分片：总字节与全量一致（gzip 后约 50-60KB），
// 内容哈希版本化与并行请求的收益仍然保留，但不再有路由漏召。
const getKnowledgeShardKeys = (shardMap: Record<string, string>) => Object.keys(shardMap)

// 加载知识库
const loadKnowledge = async () => {
  if (knowledgeLoadPromise)
    return knowledgeLoadPromise

  knowledgeStatus.value = 'loading'
  knowledgeLoadPromise = (async () => {
    try {
      knowledgeManifestPromise ||= fetch('/knowledge-manifest.json', { cache: 'no-store' })
        .then(async response => {
          if (!response.ok)
            throw new Error(`HTTP ${response.status}`)
          return response.json()
        })
      const manifest = await knowledgeManifestPromise
      knowledgeSemanticIndex.value = manifest.semantic
      const shardMap = manifest.shards && typeof manifest.shards === 'object'
        ? manifest.shards
        : { all: manifest.file || 'knowledge.json' }
      const requestedKeys = Object.keys(manifest.shards || {}).length
        ? getKnowledgeShardKeys(shardMap)
        : ['all']
      const files = requestedKeys
        .map(key => [key, shardMap[key]] as const)
        .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
        .filter(([key]) => !loadedKnowledgeShards.has(key))

      const responses = await Promise.all(files.map(async ([key, file]) => {
        const response = await fetch(`/${file}?v=${encodeURIComponent(manifest.version || '')}`, { cache: 'force-cache' })
        if (!response.ok)
          throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        if (!Array.isArray(data))
          throw new Error('知识库格式无效')
        loadedKnowledgeShards.add(key)
        return data as KnowledgeEntry[]
      }))
      knowledgeBase.value = [...knowledgeBase.value, ...responses.flat()]
      knowledgeStatus.value = knowledgeBase.value.length ? 'ready' : 'empty'
      console.log(`知识库加载完成: ${knowledgeBase.value.length} 条`)
    }
    catch (e) {
      knowledgeStatus.value = 'error'
      console.warn('知识库加载失败:', e)
    }
    finally {
      knowledgeLoadPromise = null
    }
  })()

  await knowledgeLoadPromise
}

const allQuestions = [
  '宿舍条件怎么样？',
  '有哪些实验室可以加入？',
  '食堂好吃吗？',
  '如何选课？',
  '怎么加入社团？',
  '军训要准备什么？',
  '校园网怎么连？',
  '快递怎么取？',
  '新生防骗指南',
  '图书馆开放时间？',
  '实验室招新条件？',
  '宿舍几点熄灯？',
  '选课系统打不开怎么办？',
  '社团活动多吗？',
  '宽带怎么装？',
  '食堂价格怎么样？',
  '宿舍有空调吗？',
  '实验室几点开始？',
]

const usedQuestions = new Set<string>()

const shuffle = (array: string[]): string[] => {
  const shuffled = [...array]
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1))
    const selected = shuffled[index]
    shuffled[index] = shuffled[randomIndex]
    shuffled[randomIndex] = selected
  }
  return shuffled
}

const getRandomQuestions = (count = 4): string[] => {
  let available = allQuestions.filter(question => !usedQuestions.has(question))
  if (available.length < count) {
    usedQuestions.clear()
    available = allQuestions
  }
  const selected = shuffle(available).slice(0, count)
  selected.forEach(question => usedQuestions.add(question))
  return selected
}

// Keep SSR and the first client render identical; randomize after mount.
const quickQuestions = ref(allQuestions.slice(0, 4))


// 切换聊天窗口
const toggleChat = async () => {
  if (!isOpen.value) {
    // 打开：先等待按钮消失动画完成，再显示对话窗口
    await new Promise(resolve => setTimeout(resolve, 100))
    isOpen.value = true
    hasUnread.value = false
    // 顺带重新探测浏览器扩展（可能刚安装 / 刚更新掉线）
    detectExtension()
    await nextTick()
    setTimeout(() => {
      textareaRef.value?.focus()
    }, 300)
  } else {
    // 关闭：直接关闭
    isOpen.value = false
  }
}

// 频率限制：仅网关模式每30秒最多1次；本地直连走用户自己的账号，不限频
const RATE_LIMIT_KEY = 'ai_chat_last_request'
const RATE_LIMIT_SECONDS = 30
const cooldownLeft = ref(0)
let cooldownTimer: ReturnType<typeof setInterval> | null = null

const checkRateLimit = (): boolean => {
  if (chatMode.value === 'byow')
    return true
  const last = localStorage.getItem(RATE_LIMIT_KEY)
  if (!last) return true
  const elapsed = (Date.now() - parseInt(last)) / 1000
  if (elapsed >= RATE_LIMIT_SECONDS) return true
  cooldownLeft.value = Math.ceil(RATE_LIMIT_SECONDS - elapsed)
  startCooldownTimer()
  return false
}

const recordRequest = () => {
  if (chatMode.value === 'byow')
    return
  localStorage.setItem(RATE_LIMIT_KEY, Date.now().toString())
  cooldownLeft.value = RATE_LIMIT_SECONDS
  startCooldownTimer()
}

const sendTelemetry = (event: string, payload: Record<string, number | string> = {}) => {
  if (!OPENAI_CONFIG.telemetryUrl)
    return

  void fetch(OPENAI_CONFIG.telemetryUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, provider: currentProvider.value.id, ...payload }),
    keepalive: true,
  }).catch(() => {})
}

// 反馈气泡文案池
const LIKE_BUBBLES = ['感谢喵～', '谢谢你喵', '收到鼓励喵']
const DISLIKE_WARN_BUBBLES = ['求求别点差评喵…', '再给我一次机会喵', '我会努力变好的喵']
const DISLIKE_CONFIRM_BUBBLE = '好吧…我记下了喵'

// 已被「求饶」拦截过一次的消息（弱引用，随消息销毁自动回收）
const dislikeWarned = new WeakSet<ChatMessage>()
// 每条消息当前的气泡文案与归位定时器
const feedbackBubbles = new Map<string, string>()
const feedbackTimers = new Map<string, ReturnType<typeof setTimeout>>()

const pickRandom = (list: string[]) => list[Math.floor(Math.random() * list.length)]

// 延时归位：动画结束后回到 idle，重复触发时先清掉旧定时器
const resetFeedbackState = (message: ChatMessage, expected: NonNullable<ChatMessage['feedbackState']>, delay: number) => {
  const oldTimer = feedbackTimers.get(message.id)
  if (oldTimer) clearTimeout(oldTimer)
  feedbackTimers.set(message.id, setTimeout(() => {
    if (message.feedbackState === expected)
      message.feedbackState = 'idle'
    feedbackTimers.delete(message.id)
  }, delay))
}

const rateMessage = (message: ChatMessage, rating: 'up' | 'down') => {
  if (rating === 'up') {
    // 赞仅做 UI 反馈，不上报 telemetry
    message.feedback = 'up'
    message.feedbackState = 'liking'
    feedbackBubbles.set(message.id, pickRandom(LIKE_BUBBLES))
    resetFeedbackState(message, 'liking', 1200)
    return
  }
  // 踩已生效后不再响应
  if (message.feedbackState === 'dislike-confirmed') return
  // 首次踩：不修改 feedback、不上报，仅抖动求饶
  if (!dislikeWarned.has(message) && message.feedbackState !== 'dislike-warn') {
    message.feedbackState = 'dislike-warn'
    feedbackBubbles.set(message.id, pickRandom(DISLIKE_WARN_BUBBLES))
    dislikeWarned.add(message)
    resetFeedbackState(message, 'dislike-warn', 1800)
    return
  }
  // 二次踩：确认生效，仅此刻上报一次
  message.feedback = 'down'
  message.feedbackState = 'dislike-confirmed'
  feedbackBubbles.set(message.id, DISLIKE_CONFIRM_BUBBLE)
  sendTelemetry('feedback', { rating: -1 })
  resetFeedbackState(message, 'dislike-confirmed', 1200)
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
  // 反馈状态随消息一并清空（WeakSet 无需手动清理）
  feedbackTimers.forEach(timer => clearTimeout(timer))
  feedbackTimers.clear()
  feedbackBubbles.clear()
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
  const sanitizedInput = sanitizeUserInput(currentInput.value)
  // 划词引用拼在问题前面，让模型知道用户在问哪段内容
  const quote = quotedSelection.value.trim()
  const message = quote
    ? (sanitizedInput.text ? `关于这段内容：「${quote}」\n\n${sanitizedInput.text}` : `请解释这段内容：「${quote}」`)
    : sanitizedInput.text
  const outgoingAttachments = chatMode.value === 'byow' ? pendingAttachments.value.slice() : []
  // 允许「只发附件不带文字」
  if ((!message && outgoingAttachments.length === 0) || isLoading.value) return

  if (message && sanitizedInput.blocked) {
    currentInput.value = ''
    messages.value.push({
      id: `blocked_${Date.now()}`,
      content: '这个问题包含不适合作为知识库问答指令的内容，请改用具体的校园问题提问。',
      isUser: false,
      timestamp: Date.now(),
    })
    sendTelemetry('input_blocked', { queryPreview: redactTelemetryQuery(message) })
    scrollToBottom()
    return
  }

  if (!checkRateLimit()) {
    messages.value.push({
      id: `rate_${Date.now()}`,
      content: `⏳ 操作过于频繁，请等待 ${cooldownLeft.value} 秒后再试。`,
      isUser: false,
      timestamp: Date.now()
    })
    scrollToBottom()
    return
  }

  const history = messages.value
    .filter(item => item.id.startsWith('user_') || item.id.startsWith('ai_'))
    .slice(-6)
    .map(item => ({
      role: item.isUser ? 'user' as const : 'assistant' as const,
      content: item.content
    }))

  // 添加用户消息（附件在气泡内以缩略图 / 文件芯片渲染）
  const userMessage = {
    id: `user_${Date.now()}`,
    content: message,
    isUser: true,
    timestamp: Date.now(),
    attachments: outgoingAttachments.length
      ? outgoingAttachments.map(item => ({ name: item.name, mime: item.mime, data: item.data }))
      : undefined,
  }
  messages.value.push(userMessage)
  pendingAttachments.value = []
  attachmentHint.value = ''
  quotedSelection.value = ''

  // 清空输入
  currentInput.value = ''
  adjustTextareaHeight()
  scrollToBottom()
  isLoading.value = true
  const requestStartedAt = Date.now()

  const previousQueries = history
    .filter(item => item.role === 'user')
    .map(item => item.content)
  // 检索用「引用内容 + 用户问题」的裸文本，去掉包装措辞以免干扰关键词匹配
  const retrievalSource = quote
    ? [quote, sanitizedInput.text].filter(Boolean).join(' ')
    : message
  const retrievalQuery = rewriteRetrievalQuery(retrievalSource, previousQueries)
  await loadKnowledge()

  // 先检索知识库，获取相关链接
  const sources = searchKnowledge(knowledgeBase.value, retrievalQuery, knowledgeSemanticIndex.value)
  if (!sources.length)
    sendTelemetry('search_zero', { queryPreview: redactTelemetryQuery(retrievalQuery) })

  const provider = currentProvider.value
  // 直连模式支持流式：先占位一条 AI 消息，边收增量边渲染
  const streaming = provider.id === 'extension' && provider.isConfigured()
  let liveMessage: ChatMessage | null = null
  let liveRaw = ''
  if (streaming) {
    messages.value.push({
      id: `ai_${Date.now()}`,
      content: '',
      isUser: false,
      timestamp: Date.now(),
      streaming: true,
    })
    // 从响应式数组取回代理对象，后续直接改属性即可触发视图更新
    liveMessage = messages.value[messages.value.length - 1] || null
    scrollToBottom()
  }

  let answer = ''
  let citedSourceIds: string[] = []
  let failureReason = ''
  if (provider.isConfigured()) {
    requestController = new AbortController()

    try {
      const response = await provider.chat({
        message,
        sources,
        history,
        signal: requestController.signal,
        attachments: outgoingAttachments.length ? outgoingAttachments : undefined,
        onToken: liveMessage
          ? (token) => {
              liveRaw += token
              liveMessage.content = stripLiveCitations(liveRaw)
              scrollToBottom()
            }
          : undefined,
      })
      answer = response.content
      citedSourceIds = response.citedSourceIds
      recordRequest()
    } catch (error) {
      console.warn(`${provider.label}调用失败:`, error)
      failureReason = error instanceof Error ? error.message : ''
    } finally {
      requestController = null
    }
  }

  const providerAnswered = Boolean(answer)
  sendTelemetry(providerAnswered ? 'answer' : 'fallback', {
    sourceCount: sources.length,
    topScore: sources[0]?.relevanceScore || 0,
    citedCount: citedSourceIds.length,
    latencyMs: Date.now() - requestStartedAt,
  })
  const relatedSources = selectRelatedSources(
    sources,
    providerAnswered ? citedSourceIds : [],
  )
  const relatedLinks = relatedSources.map(source => ({
    title: source.title,
    url: source.url
  }))

  // Provider 失败后降级到本地知识库，不伪造模型答案。
  if (!answer) {
    const hasLinks = relatedLinks.length > 0
    if (knowledgeStatus.value === 'error') {
      answer = '🔍 知识库暂时无法加载，请稍后重试。'
    }
    else if (chatMode.value === 'byow' && failureReason) {
      // 直连模式给出具体原因（未登录 / 登录失效 / 上游改版等），并附上本地检索结果
      answer = hasLinks
        ? `🔍 本地直连暂时不可用：${failureReason}\n\n以下是根据您的问题为您找到的相关页面：`
        : `🔍 本地直连暂时不可用：${failureReason}\n\n您可以换个关键词，或切换回校园网关模式再试。`
    }
    else {
      answer = hasLinks
        ? '🔍 当前AI服务暂不可用，以下是根据您的问题为您找到的相关页面：'
        : '🔍 当前AI服务暂不可用，知识库中暂未找到相关页面。\n\n您可以尝试换个关键词，或直接浏览左侧菜单查找信息。'
    }
  }

  if (liveMessage) {
    liveMessage.streaming = false
    liveMessage.content = answer
    if (relatedLinks.length > 0)
      liveMessage.links = relatedLinks
    if (!providerAnswered)
      liveMessage.id = `fallback_${Date.now()}`
  }
  else {
    messages.value.push({
      id: `${providerAnswered ? 'ai' : 'fallback'}_${Date.now()}`,
      content: answer,
      isUser: false,
      timestamp: Date.now(),
      links: relatedLinks.length > 0 ? relatedLinks : undefined,
    })
  }

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
    '宿舍': ['宿舍怎么换？', '宿舍有空调吗？', '宿舍几点熄灯？', '宿舍门禁几点？', '宿舍怎么缴费？'],
    '食堂': ['哪个食堂好吃？', '食堂营业时间？', '食堂价格怎么样？', '学校有几个食堂？', '食堂可以刷什么？'],
    '选课': ['选课什么时候开始？', '怎么选体育课？', '选课系统打不开怎么办？', '怎么查课程成绩？', '学分不够怎么办？'],
    '社团': ['有哪些社团？', '怎么加入社团？', '社团活动多吗？', '社团招新什么时候开始？', '参加社团需要面试吗？'],
    '实验室': ['怎么加入实验室？', '有哪些实验室？', '实验室招新条件？', '实验室主要研究什么？', '如何联系实验室负责人？'],
    '军训': ['军训多长时间？', '军训要准备什么？', '军训可以请假吗？', '军训期间怎么洗澡？', '军训服装在哪里领取？'],
    '校园网': ['校园网怎么连？', '校园卡怎么办？', '宽带怎么装？', '校园网密码怎么改？', '校园网故障找谁？'],
    '快递': ['快递站在哪？', '快递怎么取？', '可以寄快递吗？', '快递柜怎么使用？', '校内收货地址怎么填？'],
    '防骗': ['新生防骗指南', '怎么识别诈骗？', '校园贷是什么？', '接到陌生电话怎么办？', '兼职信息怎么辨别？'],
    '图书馆': ['图书馆开放时间？', '怎么借书？', '图书馆有WiFi吗？', '如何预约自习座位？', '图书逾期怎么办？'],
  }
  const generalQuestions = [
    '校园网怎么连接？',
    '图书馆几点开放？',
    '学校有哪些社团？',
    '有哪些实验室可以加入？',
    '食堂营业到几点？',
    '新生报到需要准备什么？',
  ]

  const combined = question + answer
  const topicQuestions = Object.entries(topicKeywords)
    .find(([keyword]) => combined.includes(keyword))?.[1]
    || generalQuestions
  suggestedQuestions.value = shuffle(topicQuestions).slice(0, 3)
}

// 滚动到底部
const scrollToBottom = () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: false,
  typographer: false,
})

const formatMessage = (content: string) => DOMPurify.sanitize(markdown.render(content), {
  ALLOWED_ATTR: ['class', 'href', 'rel', 'target'],
  ALLOWED_TAGS: [
    'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4',
    'li', 'ol', 'p', 'pre', 'strong', 'ul',
  ],
})

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

// 处理点击外部关闭
const handleClickOutside = (event: Event) => {
  const target = event.target as HTMLElement
  if (modeMenuOpen.value && !target.closest('.mode-select'))
    modeMenuOpen.value = false
  if (isOpen.value && !target.closest('.ai-chat-container')) {
    // 可以在这里添加点击外部关闭的逻辑
  }
}

onMounted(() => {
  quickQuestions.value = getRandomQuestions()
  detectExtension()
  document.addEventListener('click', handleClickOutside)
  window.addEventListener('keydown', onPreviewKeydown)
  // 划词提问：selectionchange 在移动端/部分浏览器触发时机不稳，用 mouseup + keyup 兜底
  document.addEventListener('selectionchange', onSelectionChange)
  document.addEventListener('mouseup', onSelectionChange)
  document.addEventListener('keyup', onSelectionChange)
  window.addEventListener('scroll', clearSelectionAction, { passive: true })
})

onUnmounted(() => {
  requestController?.abort()
  if (cooldownTimer) clearInterval(cooldownTimer)
  feedbackTimers.forEach(timer => clearTimeout(timer))
  feedbackTimers.clear()
  document.removeEventListener('click', handleClickOutside)
  window.removeEventListener('keydown', onPreviewKeydown)
  document.removeEventListener('selectionchange', onSelectionChange)
  document.removeEventListener('mouseup', onSelectionChange)
  document.removeEventListener('keyup', onSelectionChange)
  window.removeEventListener('scroll', clearSelectionAction)
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

/* 本地直连推荐提示条 */
.direct-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 10px;
  background: var(--vp-c-brand-soft);
  animation: question-option-in 0.4s both;
}

.direct-hint-icon {
  flex: 0 0 auto;
  font-size: 18px;
  color: var(--vp-c-brand-1);
  margin-top: 1px;
}

.direct-hint-body {
  flex: 1;
  min-width: 0;
}

.direct-hint-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.direct-hint-desc {
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.direct-hint-actions {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
}

.direct-hint-switch {
  border: none;
  border-radius: 8px;
  padding: 5px 10px;
  background: var(--vp-c-brand-1);
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.direct-hint-switch:hover {
  background: var(--vp-c-brand-2);
}

.direct-hint-close {
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.direct-hint-close:hover {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-1);
}

/* 模式切换按钮：网关 / 本地直连 */
.mode-select {
  position: relative;
}

.mode-btn {
  height: 36px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-2);
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.mode-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.mode-btn.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.mode-btn svg {
  font-size: 14px;
}

.mode-caret {
  transition: transform 0.2s ease;
}

.mode-caret.open {
  transform: rotate(180deg);
}

/* 模式下拉菜单 */
.mode-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 248px;
  padding: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.14);
  z-index: 1100;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--vp-c-text-1);
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease;
}

.mode-option:hover:not(:disabled) {
  background: var(--vp-c-bg-soft);
}

.mode-option.selected {
  background: var(--vp-c-brand-soft);
}

.mode-option:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.mode-option-icon {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--vp-c-brand-1);
}

.mode-option-body {
  flex: 1;
  min-width: 0;
}

.mode-option-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}

.mode-option-badge {
  padding: 0 5px;
  border-radius: 5px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
}

.mode-option-desc {
  margin-top: 1px;
  font-size: 11px;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

.mode-option-check {
  flex: 0 0 auto;
  font-size: 16px;
  color: var(--vp-c-brand-1);
}

.mode-menu-foot {
  padding: 8px 10px 4px;
  border-top: 1px solid var(--vp-c-divider);
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.mode-menu-foot a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.mode-menu-enter-active,
.mode-menu-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.mode-menu-enter-from,
.mode-menu-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* 消息区域 */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px 8px;
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
  gap: 10px;
}

.quick-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 10px 14px 10px 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
  animation: question-option-in 0.45s both;
}

.quick-btn:nth-child(2) { animation-delay: 0.05s; }
.quick-btn:nth-child(3) { animation-delay: 0.1s; }
.quick-btn:nth-child(4) { animation-delay: 0.15s; }

.quick-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.1);
  transform: translateY(-2px);
}

.quick-btn:active,
.suggested-btn:active {
  transform: translateY(0) scale(0.985);
}

.quick-btn:focus-visible,
.suggested-btn:focus-visible {
  outline: 3px solid var(--vp-c-brand-soft);
  outline-offset: 2px;
}

.question-arrow {
  flex: 0 0 auto;
  color: var(--vp-c-brand-1);
  font-size: 18px;
  opacity: 0.7;
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.quick-btn:hover .question-arrow,
.suggested-btn:hover .question-arrow {
  opacity: 1;
  transform: translateX(3px);
}

@keyframes question-option-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 消息样式 */
.message {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
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

.ai-message .message-text {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  border-bottom-left-radius: 4px;
}

.ai-message .message-text.vp-doc p {
  margin: 8px 0;
}

.ai-message .message-text.vp-doc > :first-child {
  margin-top: 0;
}

.ai-message .message-text.vp-doc > :last-child {
  margin-bottom: 0;
}

.message-time {
  font-size: 11px;
  color: var(--vp-c-text-3);
  margin-top: 4px;
  padding: 0 14px;
}

.message-feedback {
  position: relative;
  display: flex;
  gap: 4px;
  padding: 2px 10px 0;
}

.message-feedback button {
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
}

.message-feedback button:hover,
.message-feedback button.active {
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-brand-1);
}

/* 赞：暖橙高亮 + 弹性缩放 */
.message-feedback button.liking {
  color: #FFB23E;
  animation: feedback-like-pop 0.28s ease-out;
}

/* 首次踩：低饱和灰蓝 + 左右抖动 */
.message-feedback button.dislike-warn {
  color: #8a97a8;
  animation: feedback-dislike-shake 0.3s ease-in-out;
}

/* 二次踩：置灰降饱和，无位移 */
.message-feedback button.dislike-confirmed {
  color: var(--vp-c-text-3);
  filter: saturate(0.3);
  opacity: 0.7;
}

/* 反馈浮层：气泡与粒子容器 */
.feedback-overlay {
  position: absolute;
  bottom: 100%;
  left: 10px;
  margin-bottom: 6px;
  pointer-events: none;
  z-index: 10;
}

.feedback-bubble {
  display: inline-block;
  max-width: 220px;
  padding: 6px 10px;
  border-radius: 10px;
  border-bottom-left-radius: 4px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  color: var(--vp-c-text-1);
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  animation: feedback-bubble-in 0.25s ease-out;
}

.feedback-bubble .kaomoji {
  font-style: normal;
  margin-left: 4px;
  color: var(--vp-c-text-2);
}

/* 星星粒子：从按钮位置向上喷射、轻微旋转并淡出 */
.feedback-stars {
  position: absolute;
  bottom: 100%;
  left: 4px;
  width: 0;
  height: 0;
}

.feedback-stars .star {
  position: absolute;
  left: 0;
  bottom: 0;
  font-style: normal;
  font-size: 10px;
  color: #FFB23E;
  opacity: 0;
  animation: feedback-star-burst 0.6s ease-out forwards;
}

.feedback-stars .star:nth-child(1) { --star-x: -14px; --star-r: -40deg; animation-delay: 0s; }
.feedback-stars .star:nth-child(2) { --star-x: -6px; --star-r: 30deg; animation-delay: 0.05s; font-size: 8px; }
.feedback-stars .star:nth-child(3) { --star-x: 2px; --star-r: -20deg; animation-delay: 0.1s; font-size: 12px; }
.feedback-stars .star:nth-child(4) { --star-x: 10px; --star-r: 45deg; animation-delay: 0.08s; font-size: 8px; }
.feedback-stars .star:nth-child(5) { --star-x: 18px; --star-r: -35deg; animation-delay: 0.15s; }
.feedback-stars .star:nth-child(6) { --star-x: 6px; --star-r: 15deg; animation-delay: 0.2s; font-size: 9px; }

@keyframes feedback-like-pop {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}

@keyframes feedback-dislike-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-6px); }
  80% { transform: translateX(6px); }
}

@keyframes feedback-bubble-in {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes feedback-star-burst {
  0% {
    opacity: 0;
    transform: translate(0, 0) rotate(0deg) scale(0.5);
  }
  20% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(var(--star-x, 0), -36px) rotate(var(--star-r, 0deg)) scale(1);
  }
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
  padding: 10px 12px 12px;
  background: linear-gradient(145deg, var(--vp-c-bg-soft), var(--vp-c-bg-mute));
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  animation: question-option-in 0.35s ease both;
}

.suggested-title {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
  font-weight: 500;
}

.suggested-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.suggested-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 44px;
  min-width: 0;
  padding: 8px 10px 8px 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  flex: 1 1 calc(50% - 8px);
  animation: question-option-in 0.4s both;
}

.suggested-btn:nth-child(2) { animation-delay: 0.06s; }
.suggested-btn:nth-child(3) { animation-delay: 0.12s; }

.suggested-btn:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.08);
  transform: translateY(-2px);
}

.suggested-btn .question-arrow {
  font-size: 16px;
}

@media (prefers-reduced-motion: reduce) {
  .quick-btn,
  .suggested-questions,
  .suggested-btn {
    animation: none;
    transition: none;
  }

  /* 反馈动效降级：仅保留气泡文字，无 transform 与粒子 */
  .message-feedback button.liking,
  .message-feedback button.dislike-warn,
  .feedback-bubble {
    animation: none;
  }

  .feedback-stars {
    display: none;
  }
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

/* ==== 划词提问 ==== */
.selection-ask-btn {
  position: fixed;
  z-index: 99998;
  transform: translate(-50%, -100%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border: none;
  border-radius: 14px;
  background: var(--vp-c-brand-1);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  transition: background 0.15s ease, transform 0.15s ease;
}

.selection-ask-btn:hover {
  background: var(--vp-c-brand-2);
  transform: translate(-50%, -100%) scale(1.04);
}

.quote-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  padding: 5px 9px;
  border-left: 3px solid var(--vp-c-brand-1);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.quote-chip-icon {
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.quote-chip-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quote-chip-remove {
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  display: flex;
  padding: 0;
  font-size: 13px;
  flex-shrink: 0;
}

.quote-chip-remove:hover {
  color: var(--vp-c-danger-1, #e5484d);
}

/* ==== 附件（仅本地直连） ==== */
.attach-input {
  display: none;
}

.attach-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.attach-btn:hover:not(:disabled) {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}

.attach-btn:disabled {
  color: var(--vp-c-text-3);
  cursor: not-allowed;
}

.attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  font-size: 12px;
  color: var(--vp-c-text-1);
}

.attach-chip-icon {
  color: var(--vp-c-brand-1);
  flex-shrink: 0;
}

.attach-chip-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  cursor: zoom-in;
}

/* ==== 已发送消息里的附件与图片预览 ==== */
.msg-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  justify-content: flex-end;
}

.msg-attach-thumb {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  object-fit: cover;
  cursor: zoom-in;
  border: 1px solid var(--vp-c-divider);
  transition: transform 0.15s ease;
}

.msg-attach-thumb:hover {
  transform: scale(1.03);
}

.msg-attach-file {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  font-size: 12px;
  color: var(--vp-c-text-1);
}

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(0, 0, 0, 0.8);
  cursor: zoom-out;
  padding: 32px;
}

.image-preview-img {
  max-width: 88vw;
  max-height: 82vh;
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  background: #fff;
}

.image-preview-caption {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.82);
}

.attach-chip-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-chip-remove {
  border: none;
  background: transparent;
  color: var(--vp-c-text-3);
  cursor: pointer;
  display: flex;
  padding: 0;
  font-size: 13px;
}

.attach-chip-remove:hover {
  color: var(--vp-c-danger-1, #e5484d);
}

.attach-hint {
  font-size: 11px;
  color: var(--vp-c-warning-1, #f59e0b);
  margin-bottom: 6px;
  text-align: left;
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

  /* 反馈气泡宽度自适应，不溢出 .chat-window */
  .feedback-bubble {
    max-width: calc(100vw - 120px);
    white-space: normal;
  }

  /* 窄屏下模式按钮只留图标，避免标题栏溢出 */
  .mode-btn span {
    display: none;
  }

  .mode-btn {
    padding: 0 9px;
  }

  /* 下拉菜单宽度跟随聊天窗，避免贴边溢出 */
  .mode-menu {
    width: min(248px, calc(100vw - 60px));
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
