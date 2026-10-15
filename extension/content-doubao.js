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
//   -> { type: 'status', ... }   进度（调试用）
//   -> { type: 'delta', delta }  回答增量
//   -> { type: 'done', content } 回答完成（完整文本）
//   -> { type: 'error', message }失败

const RECEIVE_SEL = '[data-testid="receive_message"]'
const SEND_SEL = '[data-testid="send_message"]'
const TEXT_SEL = '[data-testid="message_text_content"]'
const ACTION_BAR_SEL = '[data-testid="message_action_bar"]'
const CHAT_INPUT_SEL = '[data-testid="chat_input"]'

// 单次会话状态（同一时间只允许一轮，避免把两条提问串在一起）
let session = null

function findComposer() {
    const input = document.querySelector(CHAT_INPUT_SEL)
    const scoped = input?.querySelector('[contenteditable="true"]')
    if (scoped)
        return scoped
    return document.querySelector('.tiptap.ProseMirror') || document.querySelector('[contenteditable="true"]')
}

function insertPrompt(composer, text) {
    composer.focus()
    let inserted = false
    try {
        inserted = document.execCommand('insertText', false, text)
    }
    catch {
        inserted = false
    }
    if (!inserted || !(composer.textContent || '').includes(text.slice(0, 8))) {
        // 兜底：直接写 DOM 并派发输入事件（ProseMirror 会通过 MutationObserver 同步状态）
        composer.textContent = text
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
    }
    return (composer.textContent || '').includes(text.slice(0, 8))
}

function triggerEnter(composer) {
    const options = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }
    composer.dispatchEvent(new KeyboardEvent('keydown', options))
    composer.dispatchEvent(new KeyboardEvent('keypress', options))
    composer.dispatchEvent(new KeyboardEvent('keyup', options))
}

function clickSendButton() {
    const input = document.querySelector(CHAT_INPUT_SEL)
    const scopes = [input, document].filter(Boolean)
    for (const scope of scopes) {
        // 优先找带「发送」语义的按钮
        const labeled = Array.from(scope.querySelectorAll('button, [role="button"]'))
            .filter(el => /发送|send/i.test(el.getAttribute('aria-label') || ''))
        if (labeled.length) {
            labeled[labeled.length - 1].click()
            return true
        }
    }
    if (!input)
        return false
    // 兜底：输入框内最右侧的可用按钮（输入文字后麦克风会变成发送键）
    const buttons = Array.from(input.querySelectorAll('button'))
        .filter(el => !el.disabled && el.getBoundingClientRect().width > 0)
        .sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left)
    if (buttons.length) {
        buttons[0].click()
        return true
    }
    return false
}

function startRun(prompt, port) {
    if (session) {
        port.postMessage({ type: 'error', message: '豆包的上一轮回答还没有结束，请稍候重试' })
        return
    }

    const state = {
        port,
        prompt,
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

    function tick() {
        if (state.finished)
            return
        const elapsed = Date.now() - state.phaseAt
        if (state.phase === 'wait-composer') {
            const composer = findComposer()
            if (!composer) {
                if (elapsed > 20000)
                    finishError('豆包页面未就绪：请确认该浏览器已登录 www.doubao.com（扩展会在后台打开一个豆包标签页）')
                return
            }
            state.sentBefore = document.querySelectorAll(SEND_SEL).length
            state.recvBefore = document.querySelectorAll(RECEIVE_SEL).length
            if (!insertPrompt(composer, prompt)) {
                finishError('无法写入豆包输入框，请在豆包标签页刷新后重试')
                return
            }
            triggerEnter(composer)
            state.phase = 'confirm-send'
            state.phaseAt = Date.now()
            return
        }
        if (state.phase === 'confirm-send') {
            if (document.querySelectorAll(SEND_SEL).length > state.sentBefore) {
                state.phase = 'wait-reply'
                state.phaseAt = Date.now()
                return
            }
            if (elapsed > 2500) {
                clickSendButton()
                state.phase = 'confirm-send-click'
                state.phaseAt = Date.now()
            }
            return
        }
        if (state.phase === 'confirm-send-click') {
            if (document.querySelectorAll(SEND_SEL).length > state.sentBefore) {
                state.phase = 'wait-reply'
                state.phaseAt = Date.now()
                return
            }
            if (elapsed > 6000)
                finishError('豆包消息未能发送（可能输入框被占用），请刷新豆包标签页后重试')
            return
        }
        if (state.phase === 'wait-reply') {
            const nodes = document.querySelectorAll(RECEIVE_SEL)
            if (nodes.length > state.recvBefore) {
                state.replyEl = nodes[state.recvBefore]
                state.phase = 'stream'
                state.phaseAt = Date.now()
                return
            }
            if (elapsed > 90000)
                finishError('豆包没有开始回答：可能需要在豆包标签页里完成安全验证（如有滑块）后重试')
            return
        }
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
                    // 文本被重写（少见）：增量协议无法回退，靠 done 的完整文本兜底
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
            if (Date.now() - state.startedAt > 180000) {
                finishDone()
            }
        }
    }
    state.tick = tick
    observer = new MutationObserver(() => tick())
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    tick()
    // 兜底：即使页面完全没有 DOM 变化，也用本地定时器（前 5 分钟不被节流）推进
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
            startRun(message.prompt, port)
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
