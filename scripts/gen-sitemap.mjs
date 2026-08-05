// Post-build sitemap + robots.txt generator (zero dependencies).
// Walks the VitePress build output and emits sitemap.xml / robots.txt into dist.
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const DIST = 'docs/.vitepress/dist'
const BASE_URL = 'https://wiki.kcos.club'

function walk(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const st = statSync(full)
        if (st.isDirectory())
            walk(full, acc)
        else if (name.endsWith('.html') && name !== '404.html')
            acc.push(full)
    }
    return acc
}

const htmlFiles = walk(DIST)
const routes = new Set()
for (const file of htmlFiles) {
    let route = '/' + relative(DIST, file).split('\\').join('/')
    route = route.replace(/index\.html$/, '').replace(/\.html$/, '')
    if (route.endsWith('/'))
        route = route.slice(0, -1) || '/'
    routes.add(route)
}

const urls = [...routes].sort()
const body = urls
    .map(u => `  <url>\n    <loc>${BASE_URL}${u}</loc>\n  </url>`)
    .join('\n')

const xml
    = `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
    + `${body}\n`
    + `</urlset>\n`

writeFileSync(join(DIST, 'sitemap.xml'), xml)
writeFileSync(
    join(DIST, 'robots.txt'),
    `User-agent: *\nAllow: /\n\nSitemap: ${BASE_URL}/sitemap.xml\n`,
)

console.log(`[gen-sitemap] wrote sitemap.xml with ${urls.length} urls`)
