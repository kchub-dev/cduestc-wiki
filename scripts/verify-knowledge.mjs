import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'

const distRoot = path.resolve('docs/.vitepress/dist')
const canonicalKnowledgePath = path.join(distRoot, 'knowledge.json')
const manifestPath = path.join(distRoot, 'knowledge-manifest.json')
for (const requiredFile of ['index.html', 'knowledge.json', 'knowledge-manifest.json', 'sitemap.xml', 'robots.txt', 'CNAME']) {
    if (!fs.existsSync(path.join(distRoot, requiredFile)))
        throw new Error(`missing required build artifact: ${requiredFile}`)
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest.semantic?.model !== 'lsa-v1'
    || manifest.semantic?.dimension !== 64
    || !manifest.semantic?.tokens
    || Object.keys(manifest.semantic.tokens).length < 100) {
    throw new Error('knowledge manifest is missing the corpus semantic index')
}
const manifestFiles = manifest.shards && typeof manifest.shards === 'object'
    ? Object.entries(manifest.shards)
    : [['all', manifest.file]]
if (!manifestFiles.length || manifestFiles.some(([, file]) => typeof file !== 'string' || !/^[\w.-]+\.json$/.test(file)))
    throw new Error('knowledge manifest has invalid shard file names')
const shardEntries = manifestFiles.map(([shard, file]) => {
    const knowledgePath = path.join(distRoot, file)
    if (!fs.existsSync(knowledgePath))
        throw new Error(`knowledge manifest points to missing ${shard} file: ${file}`)
    const values = JSON.parse(fs.readFileSync(knowledgePath, 'utf8'))
    if (!Array.isArray(values))
        throw new Error(`knowledge shard is not an array: ${file}`)
    return values
})
const entries = shardEntries.flat()
const canonicalEntries = JSON.parse(fs.readFileSync(canonicalKnowledgePath, 'utf8'))
const entryKeys = entries.map(entry => `${entry.url}\n${entry.content}`)
if (manifest.entries !== entries.length || entries.length !== canonicalEntries.length
    || new Set(entryKeys).size !== entries.length
    || new Set(entryKeys).size !== new Set(canonicalEntries.map(entry => `${entry.url}\n${entry.content}`)).size
    || entryKeys.some(key => !canonicalEntries.some(entry => `${entry.url}\n${entry.content}` === key))) {
    throw new Error('knowledge shards do not match canonical knowledge.json')
}

if (!Array.isArray(entries) || entries.length === 0)
    throw new Error('knowledge.json must contain at least one entry')

for (const entry of entries) {
    if (typeof entry.embedding !== 'string'
        || Buffer.from(entry.embedding, 'base64').length !== manifest.semantic.dimension) {
        throw new Error(`knowledge entry has an invalid semantic embedding: ${entry.url}`)
    }
}

const pageCache = new Map()

function resolvePage(pageUrl) {
    const normalizedPath = decodeURIComponent(pageUrl || '/').replace(/\/$/, '') || '/'
    const candidates = normalizedPath === '/'
        ? [path.join(distRoot, 'index.html')]
        : [
                path.join(distRoot, `${normalizedPath}.html`),
                path.join(distRoot, normalizedPath, 'index.html'),
            ]

    const pagePath = candidates.find(candidate => fs.existsSync(candidate))
    if (!pagePath)
        throw new Error(`knowledge entry points to missing page: ${pageUrl}`)
    return pagePath
}

function getPageIds(pagePath) {
    if (pageCache.has(pagePath))
        return pageCache.get(pagePath)

    const html = fs.readFileSync(pagePath, 'utf8')
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]))
    pageCache.set(pagePath, ids)
    return ids
}

for (const entry of entries) {
    if (!entry || typeof entry.url !== 'string')
        throw new Error('knowledge entry is missing a URL')

    const [pageUrl, anchor] = entry.url.split('#')
    const pagePath = resolvePage(pageUrl)
    if (anchor && !getPageIds(pagePath).has(decodeURIComponent(anchor)))
        throw new Error(`knowledge entry points to missing anchor: ${entry.url}`)
}

console.log(`[verify-knowledge] verified ${entries.length} entries across ${pageCache.size} pages`)
