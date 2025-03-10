import type { DefaultTheme } from 'vitepress'
import { defineConfig } from 'vitepress'

// https://vitepress.dev/zh/reference/site-config
export default defineConfig({
    lang: 'zh-Hans',
    title: '科成星球',
    description: '电子科技大学成都学院第三方公益校园生活百科',
    lastUpdated: true,
    cleanUrls: true,

    themeConfig: {
        // https://vitepress.dev/zh/reference/default-theme-config
        logo: '/logo.svg',
        // siteTitle: '',
        nav: nav(),
        sidebar: sidebar(),
        socialLinks: [
            { icon: 'github', link: 'https://github.com/kchub-dev/cduestc-wiki' },
        ],

        externalLinkIcon: true,
        langMenuLabel: '切换语言',
        darkModeSwitchLabel: '主题',
        lightModeSwitchTitle: '切换到浅色模式',
        darkModeSwitchTitle: '切换到深色模式',
        sidebarMenuLabel: '菜单',
        outline: { level: [2, 3], label: '目录' },
        returnToTopLabel: '返回顶部',
        editLink: {
            pattern: 'https://github.com/cduestc-wiki/cduestc-wiki/blame/main/docs/:path',
            text: '源代码',
        },
        lastUpdated: {
            text: '更新于',
            formatOptions: { dateStyle: 'short', timeStyle: 'medium' },
        },
        docFooter: { prev: '上一篇', next: '下一篇' },

        footer: {
            message: '公益项目。与任何组织无关。Made with ❤.',
            copyright: `© ${new Date().getFullYear()} <a href="https://github.com/xupt-wiki">科成星球项目组</a>`,
        },
    },

    head: [
        ['link', { rel: 'icon', href: '/logo.svg' }],
        ['link', { rel: 'stylesheet', href: 'https://lib.baomitu.com/font-awesome/6.5.1/css/all.min.css', media: 'none', onload: 'media="all"' }],
    ],
    markdown: {
        math: true,
    },

    vite: { server: { allowedHosts: true } },
})

function nav(): DefaultTheme.NavItem[] {
    return [
        { text: '实验室/码农频道', link: '/coder' },
        { text: '校园', link: '/campus/', activeMatch: '^/campus/' },
        { text: '学习', link: '/study/', activeMatch: '^/study/' },
        { text: '生活', link: '/life/', activeMatch: '^/life/' },
        { text: 'KC导航', link: 'https://cooo.site/' },
        {
            text: '关于',
            items: [
                { text: '友情链接', link: '/links' },
                { text: '贡献指南', link: '/contribute' },
                { text: '更新日志', link: '/changelog' },
                { text: '关于我们', link: '/about' },
            ],
        },
    ]
}

function sidebar(): DefaultTheme.Sidebar {
    return {
        '/': [
            {
                text: '科成星球',
                items: [
                    { text: '写在开头', link: '/overview' },
                    { text: '项目介绍', link: '/project' },
                    { text: '信息查询服务', link: '/info-services' },
                ],
            },
            {
                text: '校园',
                link: '/campus/',
                collapsed: true,
                items: [
                    { text: '本科专业列表', link: '/campus/major' },
                    { text: '住宿生活', link: '/campus/accommodation' },
                    { text: '入学准备与办理', link: '/campus/enrollment' },
                    { text: '防骗', link: '/campus/anti-fraud' },
                    { text: '手机必备APP', link: '/campus/apps' },
                    { text: '趣闻', link: '/campus/anecdote' },
                    { text: '反馈与舆论', link: '/campus/feedback' },
                ],
            },
            {
                text: '学习',
                link: '/study/',
                collapsed: true,
                items: [
                    {
                        text: '课内学业',
                        items: [
                            { text: '课程安排', link: '/study/curriculum' },
                            { text: '学业成绩', link: '/study/grades' },
                            { text: '学分绩点/综测评优', link: '/study/gpa' },
                            { text: '学号/学籍', link: '/study/status' },
                        ],
                    },
                    { text: '实验室/兴趣小组', link: '/study/labs' },
                    { text: '竞赛与证书', link: '/study/contest' },
                    { text: '社团与爱好(未写)', link: '/study/clubs' },
                ],
            },
            {
                text: '生活',
                link: '/life/',
                collapsed: true,
                items: [
                    { text: '校园墙/社区/二手交易', link: '/life/forum' },
                    { text: '快递和外卖', link: '/life/delivery' },
                    { text: '美食推荐', link: '/life/food' },
                    { text: '周边去处', link: '/life/nearby' },
                    { text: '生活服务', link: '/life/services' },
                ],
            },
            {
                text: '关于',
                items: [
                    { text: '友情链接', link: '/links' },
                    { text: '贡献指南', link: '/contributing' },
                    { text: '更新日志', link: '/changelog' },
                    { text: '关于我们', link: '/about' },
                ],
            },
        ],
    }
};
