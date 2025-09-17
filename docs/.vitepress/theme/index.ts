// https://vitepress.dev/zh/guide/custom-theme
import type { Theme } from 'vitepress'
import { Icon } from '@iconify/vue'
import { createPinia } from 'pinia'
import DefaultTheme from 'vitepress/theme-without-fonts'
import { h } from 'vue'
import VueTippy, { roundArrow } from 'vue-tippy'

import AIChat from '../components/AIChat.vue'
import AMapView from '../components/AMapView.vue'
import AppList from '../components/AppList.vue'
import Author from '../components/Author.vue'
import Disclaimer from '../components/Disclaimer.vue'
import Dropdown from '../components/Dropdown.vue'
import Footer from '../components/Footer.vue'
import Header from '../components/Header.vue'
import Logo from '../components/Logo.vue'
import NotFound from '../components/NotFound.vue'
import QRCode from '../components/QRCode.vue'
import TableAutoSpan from '../components/TableAutoSpan.vue'
import Tip from '../components/Tip.vue'

import 'tippy.js/dist/svg-arrow.css'
import './theme-enhanced.css'
import './style.css'

/**
 * 统一给文档正文容器添加 data-pagefind-body
 * - Pagefind 检测到站内存在 data-pagefind-body 时，只会索引带该属性的区域
 * - 为避免遗漏页面，这里在每次路由切换后确保正文容器都有该属性
 */
function markDocBody() {
    if (typeof document === 'undefined') {
        return
    }
    // VitePress 1.x 默认类名 .VPDoc（有时主题会变体，做多兜底一些选择器）
    const candidates = [
        'main .VPDoc',
        'main .vp-doc',
        'main .VPContent .content',
        'article.VPDoc',
    ]
    for (const sel of candidates) {
        const el = document.querySelector<HTMLElement>(sel)
        if (el) {
            if (!el.hasAttribute('data-pagefind-body')) {
                el.setAttribute('data-pagefind-body', '')
            }
            break
        }
    }
}

export default {
    extends: DefaultTheme,
    Layout: () => {
        return h(DefaultTheme.Layout, null, {
            // https://vitepress.dev/zh/guide/extending-default-theme#layout-slots
            'doc-before': () => h(Header),
            'doc-after': () => h(Footer),
            'doc-footer-before': () => h(Author),
            'not-found': () => h(NotFound),
            'layout-bottom': () => h(AIChat), // AI聊天组件放在布局底部
        })
    },
    enhanceApp({ app, router }) {
        // 全局组件
        app.component('Disclaimer', Disclaimer)
        app.component('Dropdown', Dropdown)
        app.component('Icon', Icon)
        app.component('Logo', Logo)
        app.component('TableAutoSpan', TableAutoSpan)
        app.component('Tip', Tip)
        app.component('QRCode', QRCode)
        app.component('AMapView', AMapView)
        app.component('AppList', AppList)
        app.component('AIChat', AIChat)

        // 状态管理 & 提示
        const pinia = createPinia()
        app.use(pinia)
        app.use(VueTippy, {
            component: 'Tooltip',
            directive: 'tip',
            defaultProps: {
                arrow: roundArrow,
            },
        })

        // 仅在浏览器侧打标，避免 SSR 报错
        if (typeof window !== 'undefined') {
            // 初次加载
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', markDocBody, { once: true })
            }
            else {
                markDocBody()
            }
            // 路由切换后再次打标（VitePress 提供的钩子）
            router?.onAfterRouteChanged?.(() => {
                // 等待下一帧，确保 DOM 已更新
                requestAnimationFrame(markDocBody)
            })
        }
    }
} satisfies Theme
