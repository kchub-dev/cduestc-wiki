// https://vitepress.dev/zh/guide/custom-theme
import type { Theme } from 'vitepress'
import { Icon } from '@iconify/vue'
import { createPinia } from 'pinia'
import DefaultTheme from 'vitepress/theme-without-fonts'
import { h } from 'vue'
import VueTippy, { roundArrow } from 'vue-tippy'

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
import AMapView from '../components/AMapView.vue'
import AppList from '../components/AppList.vue'

import 'tippy.js/dist/svg-arrow.css'
import './theme-enhanced.css'
import './style.css'

export default {
    extends: DefaultTheme,
    Layout: () => {
        return h(DefaultTheme.Layout, null, {
            // https://vitepress.dev/zh/guide/extending-default-theme#layout-slots
            'doc-before': () => h(Header),
            'doc-after': () => h(Footer),
            'doc-footer-before': () => h(Author),
            'not-found': () => h(NotFound),
        })
    },
    enhanceApp({ app }) {
        app.component('Disclaimer', Disclaimer)
        app.component('Dropdown', Dropdown)
        app.component('Icon', Icon)
        app.component('Logo', Logo)
        app.component('TableAutoSpan', TableAutoSpan)
        app.component('Tip', Tip)
        app.component('QRCode', QRCode)
        app.component('AMapView', AMapView)
        app.component('AppList', AppList)

        const pinia = createPinia()

        app.use(pinia)
        app.use(VueTippy, {
            component: 'Tooltip',
            directive: 'tip',
            defaultProps: {
                arrow: roundArrow,
            },
        })
    },
} satisfies Theme
