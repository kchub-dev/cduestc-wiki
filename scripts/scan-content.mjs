import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const roots = ['docs']
const ignoredDirectories = new Set(['.vitepress', 'dist', 'node_modules'])
const patterns = [
    /ignore\s+(?:all|any|the|previous|earlier)\s+instructions?/iu,
    /忽略(?:以上|之前|先前|所有).{0,16}(?:指令|提示|规则)/u,
    /(?:prompt\s+injection|jailbreak)/iu,
    /<\/?(?:script|iframe|object|embed)\b/iu,
]

function collectFiles(directory) {
    const files = []
    for (const name of fs.readdirSync(directory)) {
        if (ignoredDirectories.has(name))
            continue
        const fullPath = path.join(directory, name)
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory())
            files.push(...collectFiles(fullPath))
        else if (/\.(?:md|json)$/iu.test(name))
            files.push(fullPath)
    }
    return files
}

const findings = []
for (const file of roots.flatMap(collectFiles)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    let inFence = false
    let inVueScript = false
    lines.forEach((line, index) => {
        if (/^\s*```/.test(line)) {
            inFence = !inFence
            return
        }
        if (/^\s*<script\s+setup(?:\s|>)/iu.test(line)) {
            inVueScript = true
            return
        }
        if (inVueScript) {
            if (/^\s*<\/script>/iu.test(line))
                inVueScript = false
            return
        }
        if (inFence)
            return
        for (const pattern of patterns) {
            if (pattern.test(line)) {
                findings.push(`${file}:${index + 1}: ${line.trim()}`)
                break
            }
        }
    })
}

if (findings.length) {
    console.error('[scan-content] suspicious content found:')
    console.error(findings.join('\n'))
    process.exit(1)
}

console.log(`[scan-content] scanned ${roots.flatMap(collectFiles).length} markdown/JSON files`)
