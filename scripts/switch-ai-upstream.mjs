#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output, stderr } from 'node:process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const WRANGLER_PATH = resolve(ROOT, 'wrangler.jsonc')

export const UPSTREAM_PRESETS = {
    oaifree: {
        name: 'oaifree',
        url: 'https://hub.oaifree.com/v1/chat/completions',
        model: 'deepseek-ai/DeepSeek-V4-Flash',
        hint: 'LinuxDo HUB（oaifree），国内与 Workers 出口均可达。2026-10-14 实测可用模型 DeepSeek-V4-Flash；Kimi-K2.6/DeepSeek-V3.x/Qwen3-235B 渠道返回「参数错误」（渠道故障），切换前建议先用控制台探测。',
    },
    modelverse: {
        name: 'modelverse',
        url: 'https://api.modelverse.cn/v1/chat/completions',
        model: 'deepseek-v4.1-flash',
        hint: 'ModelVerse 单模型白名单（deepseek-v4.1-flash），额度永久有效。额度用尽返回 403 quota exceeded，会自动触发故障转移。',
    },
    siliconflow: {
        name: 'siliconflow',
        url: 'https://api.siliconflow.cn/v1/chat/completions',
        model: 'Qwen/Qwen2.5-7B-Instruct',
        hint: '硅基流动，国内节点，OpenAI 兼容。控制台创建 API Key 后即可。',
    },
    zhipu: {
        name: 'zhipu',
        url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        model: 'glm-5.3-flash',
        hint: '智谱 API 已无免费档，glm-5.3-flash 为普惠付费档，账户需有余额或资源包。',
    },
    groq: {
        name: 'groq',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        model: 'llama-3.3-70b-versatile',
        hint: 'Groq 速度很快，但会拦截 Cloudflare Workers 与中国大陆出口（实测裸 403），选它前先探测连通。',
    },
    spark: {
        name: 'spark-primary',
        url: 'https://spark-api-open.xf-yun.com/v1/chat/completions',
        model: 'generalv3.5',
        hint: '讯飞星火 HTTP 接口，需要 APIPassword。',
    },
}

export const SLOT_VARS = {
    fallback: {
        url: 'SPARK_FALLBACK_URL',
        model: 'SPARK_FALLBACK_MODEL',
        name: 'SPARK_FALLBACK_NAME',
        preset: 'SPARK_FALLBACK_PRESET',
        secret: 'SPARK_FALLBACK_API_PASSWORD',
        github: true,
    },
    primary: {
        url: 'SPARK_OPENAI_URL',
        model: 'SPARK_MODEL',
        name: 'SPARK_PRIMARY_NAME',
        preset: 'SPARK_PRIMARY_PRESET',
        secret: 'SPARK_API_PASSWORD',
        github: false,
    },
}

export function normalizeChatCompletionsUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/u, '')
    if (!raw)
        throw new Error('API 地址不能为空')
    let url
    try {
        url = new URL(raw)
    }
    catch {
        throw new Error('API 地址必须是 http(s) URL')
    }
    if (!/^https?:$/u.test(url.protocol))
        throw new Error('API 地址必须是 http(s) URL')
    if (/\/v1\/chat\/completions$/u.test(url.pathname) || /\/chat\/completions$/u.test(url.pathname))
        return url.toString().replace(/\/+$/u, '')
    if (/\/v1$/u.test(url.pathname) || /\/paas\/v4$/u.test(url.pathname))
        return `${url.toString().replace(/\/+$/u, '')}/chat/completions`
    throw new Error('请提供 OpenAI 兼容地址，例如 https://api.siliconflow.cn/v1 或完整的 /chat/completions')
}

export function resolvePreset(name) {
    if (!name)
        return null
    const preset = UPSTREAM_PRESETS[String(name).trim().toLowerCase()]
    if (!preset)
        throw new Error(`未知预设：${name}。可用：${Object.keys(UPSTREAM_PRESETS).join(', ')}`)
    return preset
}

export function parseArgs(argv) {
    const args = {
        slot: 'fallback',
        preset: '',
        url: '',
        model: '',
        name: '',
        fromStdin: false,
        skipSecret: false,
        skipGithub: false,
        dryRun: false,
        list: false,
        selfTest: false,
        help: false,
    }
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index]
        const next = argv[index + 1]
        if (item === '--slot' && next) {
            args.slot = next
            index += 1
        }
        else if (item === '--preset' && next) {
            args.preset = next
            index += 1
        }
        else if (item === '--url' && next) {
            args.url = next
            index += 1
        }
        else if (item === '--model' && next) {
            args.model = next
            index += 1
        }
        else if (item === '--name' && next) {
            args.name = next
            index += 1
        }
        else if (item === '--from-stdin') {
            args.fromStdin = true
        }
        else if (item === '--skip-secret') {
            args.skipSecret = true
        }
        else if (item === '--skip-github') {
            args.skipGithub = true
        }
        else if (item === '--dry-run') {
            args.dryRun = true
        }
        else if (item === '--list') {
            args.list = true
        }
        else if (item === '--self-test') {
            args.selfTest = true
        }
        else if (item === '--help' || item === '-h') {
            args.help = true
        }
        else {
            throw new Error(`未知参数：${item}`)
        }
    }
    if (!['fallback', 'primary'].includes(args.slot))
        throw new Error('slot 只能是 fallback 或 primary')
    return args
}

export function upsertJsoncString(text, key, value) {
    const pattern = new RegExp(`("${key}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`)
    const encoded = JSON.stringify(value)
    if (pattern.test(text))
        return text.replace(pattern, `$1${encoded}`)
    const varsClose = text.lastIndexOf('}', text.indexOf('analytics_engine_datasets'))
    if (varsClose === -1)
        throw new Error('wrangler.jsonc 缺少 vars')
    return `${text.slice(0, varsClose).replace(/\s*$/u, '')},
    "${key}": ${encoded}
  ${text.slice(varsClose)}`
}

function printHelp() {
    stderr.write(`切换 Worker 的 OpenAI 兼容上游。前端不用改。\n\n`)
    stderr.write(`用法：\n`)
    stderr.write(`  pnpm switch:ai-upstream --preset siliconflow\n`)
    stderr.write(`  pnpm switch:ai-upstream --preset zhipu\n`)
    stderr.write(`  pnpm switch:ai-upstream --preset groq\n`)
    stderr.write(`  pnpm switch:ai-upstream --url https://api.example.com/v1 --model my-model\n\n`)
    stderr.write(`只改三要素：API 地址、模型名、API 密钥。密钥走 wrangler secret / GitHub Secret，不会写入仓库。\n`)
    stderr.write(`默认写入 fallback 槽，讯飞主上游可继续留着。下次再挂了，换 URL/模型/密钥即可。\n`)
}

function listPresets() {
    for (const [key, preset] of Object.entries(UPSTREAM_PRESETS))
        stderr.write(`${key}\t${preset.model}\t${preset.url}\n  ${preset.hint}\n`)
}

function runSelfTest() {
    const silicon = normalizeChatCompletionsUrl('https://api.siliconflow.cn/v1')
    if (silicon !== 'https://api.siliconflow.cn/v1/chat/completions')
        throw new Error(`silicon url: ${silicon}`)
    const groq = normalizeChatCompletionsUrl('https://api.groq.com/openai/v1/chat/completions')
    if (groq !== 'https://api.groq.com/openai/v1/chat/completions')
        throw new Error(`groq url: ${groq}`)
    const zhipu = normalizeChatCompletionsUrl('https://open.bigmodel.cn/api/paas/v4/')
    if (zhipu !== 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
        throw new Error(`zhipu url: ${zhipu}`)
    const sample = '{\n  "vars": {\n    "SPARK_FALLBACK_URL": "https://old.example/v1/chat/completions"\n  },\n  "analytics_engine_datasets": []\n}\n'
    const updated = upsertJsoncString(sample, 'SPARK_FALLBACK_URL', 'https://api.siliconflow.cn/v1/chat/completions')
    if (!updated.includes('api.siliconflow.cn/v1/chat/completions'))
        throw new Error('jsonc upsert failed')
    resolvePreset('zhipu')
    console.log('[switch-ai-upstream] self-test passed')
}

async function prompt(question, fallback = '') {
    const rl = createInterface({ input, output })
    try {
        const answer = (await rl.question(question)).trim()
        return answer || fallback
    }
    finally {
        rl.close()
    }
}

function readSecret(label) {
    stderr.write(`${label}`)
    const result = spawnSync('bash', ['-lc', 'IFS= read -r -s value; printf %s "$value"'], {
        stdio: ['inherit', 'pipe', 'inherit'],
        encoding: 'utf8',
    })
    stderr.write('\n')
    if (result.status !== 0)
        throw new Error('读取密钥失败')
    const value = String(result.stdout || '').trim()
    if (!value)
        throw new Error('API 密钥不能为空')
    return value
}

function readStdinSecret() {
    const value = readFileSync(0, 'utf8').trim()
    if (!value)
        throw new Error('stdin 里没有 API 密钥')
    return value
}

function run(command, args, { inputText } = {}) {
    const result = spawnSync(command, args, {
        cwd: ROOT,
        encoding: 'utf8',
        input: inputText,
        stdio: inputText === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    })
    if (result.status !== 0)
        throw new Error(`${command} ${args.join(' ')} 失败`)
}

async function main() {
    const args = parseArgs(process.argv.slice(2))
    if (args.help) {
        printHelp()
        return
    }
    if (args.list) {
        listPresets()
        return
    }
    if (args.selfTest) {
        runSelfTest()
        return
    }

    const slot = SLOT_VARS[args.slot]
    const preset = args.preset ? resolvePreset(args.preset) : null
    let url = args.url || preset?.url || ''
    let model = args.model || preset?.model || ''
    let name = args.name || preset?.name || args.preset || args.slot

    if (!args.url && !args.preset && input.isTTY)
        url = await prompt('OpenAI 兼容 API 地址（可用预设名 siliconflow / zhipu / groq）：')
    if (url && UPSTREAM_PRESETS[url.trim().toLowerCase()] && !args.preset) {
        const chosen = resolvePreset(url)
        url = chosen.url
        model = model || chosen.model
        name = args.name || chosen.name
    }
    if (!model && input.isTTY)
        model = await prompt('模型名：', preset?.model || '')
    if (!url || !model)
        throw new Error('需要 API 地址和模型名。也可用 --preset siliconflow|zhipu|groq')

    url = normalizeChatCompletionsUrl(url)
    const wrangler = readFileSync(WRANGLER_PATH, 'utf8')
    let next = wrangler
    next = upsertJsoncString(next, slot.url, url)
    next = upsertJsoncString(next, slot.model, model)
    next = upsertJsoncString(next, slot.name, name)
    next = upsertJsoncString(next, slot.preset, args.preset || name)

    stderr.write(`槽位：${args.slot}\n`)
    stderr.write(`名称：${name}\n`)
    stderr.write(`地址：${url}\n`)
    stderr.write(`模型：${model}\n`)
    stderr.write(`密钥：${slot.secret}（不会写入仓库）\n`)

    if (args.dryRun) {
        stderr.write('dry-run：不写文件、不注入密钥\n')
        return
    }

    if (next !== wrangler)
        writeFileSync(WRANGLER_PATH, next)

    if (!args.skipSecret) {
        const secret = args.fromStdin ? readStdinSecret() : readSecret('API 密钥（输入时不回显）：')
        run('pnpm', ['exec', 'wrangler', 'secret', 'put', slot.secret, '--config', 'wrangler.jsonc'], { inputText: secret })
        if (slot.github && !args.skipGithub) {
            run('gh', ['secret', 'set', slot.secret], { inputText: secret })
        }
    }

    stderr.write('已写入 wrangler.jsonc。提交这个文件后推送 main，CI 会部署 Worker。\n')
    stderr.write('不要把密钥写进 .env、Markdown 或 Git。前端不用改。\n')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        stderr.write(`${error instanceof Error ? error.message : error}\n`)
        process.exit(1)
    })
}
