// Offscreen 文档：承担 DeepSeek PoW 求解等 CPU 密集计算。
//
// 为什么放到这里：MV3 Service Worker 线程被浏览器大幅降频（实测同样计算
// 比普通页面线程慢约 300 倍），PoW 求解在 SW 里要几十秒，在这里只需不到一秒。
// offscreen 文档是扩展自带的隐藏页面，任何平台都不可见。

import { solveDeepSeekChallenge } from './src/deepseek-hash.js'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'kcos-pow-solve' && message.challenge) {
        try {
            const startedAt = Date.now()
            const nonce = solveDeepSeekChallenge(message.challenge)
            sendResponse({ ok: true, nonce, solveMs: Date.now() - startedAt })
        }
        catch (error) {
            sendResponse({ ok: false, message: error instanceof Error ? error.message : String(error) })
        }
        return false
    }
    if (message?.type === 'kcos-pow-bench') {
        const started = performance.now()
        let x = 123456789
        for (let index = 0; index < 200000; index++) {
            x = (x ^ (x << 13)) >>> 0
            x = (x ^ (x >>> 17)) >>> 0
            x = (x ^ (x << 5)) >>> 0
        }
        sendResponse({ elapsedMs: performance.now() - started, x })
        return false
    }
    return false
})
