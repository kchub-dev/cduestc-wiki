// 豆包「页面驱动」脚本（运行在 www.doubao.com 上）。
//
// 为什么不用接口：豆包的 /chat/completion 接口要求强校验的 a_bogus 签名
// （实测：把签名改成等长随机串会立刻触发风控拦截 + 滑块验证挑战）。
// 因此改为驱动用户自己已登录的真实页面——问题注入输入框、读取回答节点，
// 真实请求由豆包页面自己签名发出，与人工使用完全一致，不伪造任何签名。
//
// 驱动协议（由 background 通过 chrome.tabs.connect 建立端口）：
//   <- { type: 'run', prompt }   开始一次提问
//   <- { type: 'poke' }          周期心跳（后台标签页定时器被节流，由扩展侧驱动检查）
//   <- { type: 'abort' }         取消
//   -> { type: 'delta', delta }  回答增量
//   -> { type: 'done', content } 回答完成（完整文本）
//   -> { type: 'error', message }失败

const RECEIVE_SEL = '[data-testid="receive_message"]'
const SEND_SEL = '[data-testid="send_message"]'
const TEXT_SEL = '[data-testid="message_text_content"]'
const ACTION_BAR_SEL = '[data-testid="message_action_bar"]'
const CHAT_INPUT_SEL = '[data-testid="chat_input"]'

let session = null

/**
 * 定位豆包输入框（ProseMirror / tiptap）。
 *
 * 参考社区实测（掘金《用浏览器扩展自动化采集 AI 平台回答》）：
 * 改版后 aria-label="发消息" 已消失，placeholder 移到了内部 <p> 的
 * data-placeholder 上，因此按以下优先级定位：
 *   1. [data-testid="chat_input"] 内的 contenteditable
 *   2. 含 data-placeholder*="发消息" 的元素，取其最近的 contenteditable 祖先
 *   3. 页面上唯一可见的 .ProseMirror[contenteditable="true"]
 */
function findComposer() {
    const input = document.querySelector(CHAT_INPUT_SEL)
    const scoped = input?.querySelector('[contenteditable="true"]')
    if (scoped)
        return scoped

    for (const node of document.querySelectorAll('[data-placeholder]')) {
        const text = node.dataset?.placeholder || ''
        if (text.includes('发消息') || text.includes('输入')) {
            const editable = node.closest('[contenteditable="true"]')
            if (editable)
                return editable
        }
    }

    const candidates = Array.from(document.querySelectorAll('.ProseMirror[contenteditable="true"]'))
        .filter((el) => {
            const rect = el.getBoundingClientRect()
            return rect.width > 0 && rect.height > 0
        })
    if (candidates.length === 1)
        return candidates[0]
    if (candidates.length > 1) {
        // 取最靠下（输入框通常在页面底部）且可见的那个
        return candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0]
    }
    return document.querySelector('[contenteditable="true"]')
}

/** 清空编辑器残留草稿 */
function clearComposer(composer) {
    composer.focus()
    try {
        document.execCommand('selectAll', false, null)
        document.execCommand('delete', false, null)
    }
    catch {}
    if ((composer.textContent || '').trim()) {
        composer.textContent = ''
        composer.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }
}

/**
 * 同步写入文本到 ProseMirror 编辑器。
 *
 * 关键（社区实测踩坑）：execCommand('insertText') 之后必须补发 InputEvent，
 * 否则 React 内部状态不更新，导致「发送按钮可用性判断出错」——
 * 表现为按钮一直处于禁用态、点了没反应，流程静默卡死。
 *
 * 策略：
 * 1. execCommand('selectAll' + 'insertText') + 补发 InputEvent
 * 2. 直接 textContent 赋值 + InputEvent（ProseMirror MutationObserver 会同步）
 */
function insertText(composer, text) {
    composer.focus()
    try {
        document.execCommand('selectAll', false, null)
        document.execCommand('insertText', false, text)
    }
    catch {}
    // 无论走哪条路径都补发 InputEvent，让 React 感知内容变化
    try {
        composer.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            inputType: 'insertText',
            data: text,
        }))
    }
    catch {}

    if ((composer.textContent || '').includes(text.slice(0, Math.min(10, text.length))))
        return 'execCommand'

    // 兜底：直接 DOM 写入
    composer.textContent = text
    try {
        composer.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            cancelable: false,
            inputType: 'insertText',
            data: text,
        }))
    }
    catch {}

    if ((composer.textContent || '').includes(text.slice(0, Math.min(10, text.length))))
        return 'dom'
    return null
}

function dispatchEnter(el) {
    const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
    el.dispatchEvent(new KeyboardEvent('keydown', opts))
    el.dispatchEvent(new KeyboardEvent('keypress', opts))
    el.dispatchEvent(new KeyboardEvent('keyup', opts))
}

/**
 * 查找「发送」按钮。
 *
 * 社区实测的关键坑（掘金《用浏览器扩展自动化采集 AI 平台回答》）：
 * 豆包的发送按钮和语音按钮外观几乎一样（都是圆形、无文字、无 aria-label），
 * 区别是发送按钮带高亮底色类名 `bg-dbx-fill-highlight`，空输入时显示的是
 * `bg-transparent` 的语音按钮。点错语音按钮既不发送也不报错，流程静默卡死。
 *
 * 因此这里按以下优先级识别，且**要求按钮真的可用**（有字后才出现/可用）：
 *   1. 带「发送/send」aria-label 的按钮
 *   2. 类名含 bg-dbx-fill-highlight 的按钮（豆包发送键的高亮底色）
 *   3. 输入区内最右侧、未禁用、可见的按钮
 * 找不到时返回 null（调用方继续轮询等待，而不是乱点）。
 */
function findSendButton(composer) {
    const input = document.querySelector(CHAT_INPUT_SEL)
    const scopes = [input, composer?.closest('div[class*="input"], div[class*="editor"]'), document].filter(Boolean)

    for (const scope of scopes) {
        // 1) aria-label 语义锚点
        for (const btn of scope.querySelectorAll('button, [role="button"]')) {
            if (btn.disabled)
                continue
            if (/发送|send/i.test(btn.getAttribute('aria-label') || ''))
                return btn
        }
        // 2) 豆包发送键的高亮底色类名
        for (const btn of scope.querySelectorAll('button, [role="button"]')) {
            if (btn.disabled)
                continue
            if (btn.className && typeof btn.className === 'string' && btn.className.includes('bg-dbx-fill-highlight'))
                return btn
        }
    }

    // 3) 兜底：输入区内最右侧可用按钮
    if (!input)
        return null
    const buttons = Array.from(input.querySelectorAll('button'))
        .filter(el => !el.disabled && el.getBoundingClientRect().width > 0)
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)
    return buttons[0] || null
}

function injectAttachments(attachments) {
    const input = document.querySelector('input[type="file"]')
    if (!input)
        return false
    const transfer = new DataTransfer()
    for (const item of attachments) {
        try {
            const binary = atob(item.data || '')
            const bytes = new Uint8Array(binary.length)
            for (let index = 0; index < binary.length; index++)
                bytes[index] = binary.charCodeAt(index)
            transfer.items.add(new File([bytes], item.name || 'attachment', { type: item.mime || 'application/octet-stream' }))
        }
        catch {}
    }
    if (!transfer.items.length)
        return false
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
}

function attachmentsVisible(names) {
    const area = document.querySelector(CHAT_INPUT_SEL)?.closest('div')?.parentElement || document.body
    try {
        if (area.querySelector('img[src^="blob:"]'))
            return true
        const text = area.textContent || ''
        return names.some(name => name && text.includes(name))
    }
    catch {
        return false
    }
}

function startRun(prompt, port, attachments = []) {
    if (session) {
        port.postMessage({ type: 'error', message: '豆包的上一轮回答还没有结束，请稍候重试' })
        return
    }

    const attachmentList = Array.isArray(attachments) ? attachments.slice(0, 3) : []
    const state = {
        port,
        prompt,
        attachmentList,
        attachmentNames: attachmentList.map(item => item.name).filter(Boolean),
        phase: 'wait-composer',
        startedAt: Date.now(),
        phaseAt: Date.now(),
        sentBefore: 0,
        recvBefore: 0,
        replyEl: null,
        last: '',
        lastChangeAt: 0,
        sawText: false,
        finished: false,
    }
    session = state

    let observer = null

    const finishError = (message) => {
        if (state.finished)
            return
        state.finished = true
        session = null
        observer?.disconnect()
        // 失败时清掉残留草稿，避免污染下一轮
        try {
            const composer = findComposer()
            if (composer)
                clearComposer(composer)
        }
        catch {}
        port.postMessage({ type: 'error', message })
    }
    const finishDone = () => {
        if (state.finished)
            return
        state.finished = true
        session = null
        observer?.disconnect()
        port.postMessage({ type: 'done', content: state.last })
    }
    state.finishError = finishError
    state.finishDone = finishDone

    // 发送成功的判据：用户消息节点数增加（比 SEND_SEL 更可靠，
    // 因为豆包的发送键在发送后会被移除/替换，计数可能不变）
    const userMsgCount = () => document.querySelectorAll(SEND_SEL).length
    const replyCount = () => document.querySelectorAll(RECEIVE_SEL).length
    const sent = () => userMsgCount() > state.sentBefore || replyCount() > state.recvBefore

    function tick() {
        if (state.finished)
            return
        const elapsed = Date.now() - state.phaseAt

        // ---- 等待编辑器就绪 ----
        if (state.phase === 'wait-composer') {
            const composer = findComposer()
            if (!composer) {
                if (elapsed > 20000)
                    finishError('豆包页面未就绪：请确认已登录 www.doubao.com（扩展会自动打开豆包标签页）')
                return
            }
            if (state.attachmentList.length) {
                if (!injectAttachments(state.attachmentList)) {
                    finishError('无法向豆包添加附件，请刷新豆包标签页后重试')
                    return
                }
                state.phase = 'wait-upload'
                state.phaseAt = Date.now()
                return
            }
            // 无附件：写入文本并触发发送
            clearComposer(composer)
            const method = insertText(composer, state.prompt)
            if (!method) {
                finishError('无法写入豆包输入框，请刷新豆包标签页后重试')
                return
            }
            // 发送按钮是输入文字后由 React 动态插入的节点（社区实测约 400ms 就位），
            // 因此不在这里立刻点，而是进入 confirm-send 阶段轮询等待它出现。
            state.sentBefore = document.querySelectorAll(SEND_SEL).length
            state.recvBefore = document.querySelectorAll(RECEIVE_SEL).length
            state.phase = 'confirm-send'
            state.phaseAt = Date.now()
            return
        }

        // ---- 附件上传中：等缩略图/文件名出现（或超时）后再写入问题 ----
        if (state.phase === 'wait-upload') {
            const uploaded = attachmentsVisible(state.attachmentNames)
            if (!uploaded && elapsed < 8000)
                return
            const composer = findComposer()
            if (!composer) {
                finishError('豆包页面未就绪：找不到输入框')
                return
            }
            clearComposer(composer)
            if (!insertText(composer, state.prompt)) {
                finishError('无法写入豆包输入框，请刷新豆包标签页后重试')
                return
            }
            state.sentBefore = document.querySelectorAll(SEND_SEL).length
            state.recvBefore = document.querySelectorAll(RECEIVE_SEL).length
            state.phase = 'confirm-send'
            state.phaseAt = Date.now()
            return
        }

        // ---- 确认消息已发出 ----
        // 社区实测：发送按钮是输入文字后由 React 动态插入的节点（约 400ms 就位），
        // 必须轮询等待它出现再点击，不能一次性查询后盲点（会点到语音按钮）。
        if (state.phase === 'confirm-send') {
            // 已发出（出现新的用户消息节点）
            if (sent()) {
                state.phase = 'wait-reply'
                state.phaseAt = Date.now()
                return
            }
            const composer = findComposer()
            const btn = composer ? findSendButton(composer) : null
            if (btn) {
                btn.click()
                state.clickedAt = Date.now()
                state.phase = 'confirm-send-btn'
                state.phaseAt = Date.now()
                return
            }
            // 按钮还没出现：等（最多 6 秒，超过说明输入框状态异常）
            if (elapsed > 6000) {
                // 最后手段：模拟 Enter
                if (composer) {
                    composer.focus()
                    dispatchEnter(composer)
                    state.phase = 'confirm-send-retry'
                    state.phaseAt = Date.now()
                }
                else {
                    finishError('豆包消息未能发送（找不到输入框），请刷新豆包标签页后重试')
                }
            }
            return
        }
        if (state.phase === 'confirm-send-btn') {
            if (sent()) {
                state.phase = 'wait-reply'
                state.phaseAt = Date.now()
                return
            }
            // 点过一次但没发出：再等按钮可用后重试一次
            if (elapsed > 2000) {
                const composer = findComposer()
                const btn = composer ? findSendButton(composer) : null
                if (btn && Date.now() - (state.clickedAt || 0) > 800) {
                    btn.click()
                    state.clickedAt = Date.now()
                    state.phaseAt = Date.now()
                    return
                }
                if (elapsed > 5000) {
                    if (composer) {
                        composer.focus()
                        dispatchEnter(composer)
                        state.phase = 'confirm-send-retry'
                        state.phaseAt = Date.now()
                    }
                    else {
                        finishError('豆包消息未能发送（页面异常），请刷新豆包标签页后重试')
                    }
                }
            }
            return
        }
        if (state.phase === 'confirm-send-retry') {
            if (sent()) {
                state.phase = 'wait-reply'
                state.phaseAt = Date.now()
                return
            }
            if (elapsed > 8000)
                finishError('豆包消息未能发送（可能输入框被占用），请刷新豆包标签页后重试')
            return
        }

        // ---- 等待回答节点出现 ----
        if (state.phase === 'wait-reply') {
            const nodes = document.querySelectorAll(RECEIVE_SEL)
            if (nodes.length > state.recvBefore) {
                state.replyEl = nodes[state.recvBefore]
                state.phase = 'stream'
                state.phaseAt = Date.now()
                return
            }
            if (elapsed > 90000)
                finishError('豆包没有开始回答：可能需要在豆包标签页里完成安全验证后重试')
            return
        }

        // ---- 流式读取回答 ----
        if (state.phase === 'stream') {
            const el = state.replyEl
            if (!el || !el.isConnected) {
                state.replyEl = document.querySelectorAll(RECEIVE_SEL)[state.recvBefore] || null
                if (!state.replyEl) {
                    if (elapsed > 15000)
                        finishError('豆包的回答节点消失了，请重试')
                    return
                }
            }
            const textEl = state.replyEl.querySelector(TEXT_SEL) || state.replyEl
            const text = (textEl.textContent || '').trim()
            if (text && text !== state.last) {
                if (text.startsWith(state.last)) {
                    const delta = text.slice(state.last.length)
                    if (delta)
                        port.postMessage({ type: 'delta', delta })
                }
                else {
                    port.postMessage({ type: 'status', note: 'reply-rewritten' })
                }
                state.last = text
                state.lastChangeAt = Date.now()
                state.sawText = true
            }
            const hasActionBar = Boolean(state.replyEl.querySelector(ACTION_BAR_SEL))
            const quietMs = Date.now() - (state.lastChangeAt || state.phaseAt)
            if (state.sawText && hasActionBar && quietMs > 600) {
                finishDone()
                return
            }
            if (state.sawText && quietMs > 5000) {
                finishDone()
                return
            }
            if (Date.now() - state.startedAt > 180000)
                finishDone()
        }
    }
    state.tick = tick
    observer = new MutationObserver(() => tick())
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    tick()
    const localTimer = setInterval(() => {
        if (state.finished) {
            clearInterval(localTimer)
            return
        }
        tick()
    }, 1000)
}

chrome.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith('doubao-run'))
        return
    port.onMessage.addListener((message) => {
        if (message?.type === 'run' && typeof message.prompt === 'string') {
            startRun(message.prompt, port, message.attachments)
        }
        else if (message?.type === 'poke') {
            session?.tick?.()
        }
        else if (message?.type === 'abort') {
            if (session && !session.finished) {
                session.finished = true
                session = null
                try {
                    port.postMessage({ type: 'error', message: '本地直连请求已取消' })
                }
                catch {}
            }
        }
    })
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'doubao-ping') {
        sendResponse({
            ok: true,
            url: location.href,
            hasComposer: Boolean(findComposer()),
        })
    }
    return false
})
