import type { KnowledgeEntry, SemanticIndex } from '../docs/.vitepress/ai/knowledge'
import fs from 'node:fs'
import { searchKnowledge, selectRelatedSources } from '../docs/.vitepress/ai/knowledge'
import { parseGroundedResponse } from '../docs/.vitepress/ai/prompts'

interface Case {
    query: string
    page: string
    pages?: string[]
}

interface Manifest {
    shards?: Record<string, string>
    file?: string
    semantic?: SemanticIndex
}

const manifest = JSON.parse(fs.readFileSync('docs/public/knowledge-manifest.json', 'utf8')) as Manifest
const shardFiles = manifest.shards ? Object.values(manifest.shards) : [manifest.file || 'knowledge.json']
const entries = shardFiles.flatMap(file => JSON.parse(fs.readFileSync(`docs/public/${file}`, 'utf8')) as KnowledgeEntry[])
const cases = JSON.parse(fs.readFileSync('scripts/retrieval-eval.json', 'utf8')) as Case[]
let hits = 0
let reciprocalRank = 0
let citationPrecision = 0
let citationCoverage = 0
let fallbackLinkRate = 0

for (const testCase of cases) {
    const results = searchKnowledge(entries, testCase.query, manifest.semantic)
    const expectedPages = new Set(testCase.pages || [testCase.page])
    const resultPages = new Set(results.map(result => result.url.split('#')[0]))
    const relevantCount = [...resultPages].filter(page => expectedPages.has(page)).length
    citationCoverage += relevantCount > 0 ? 1 : 0
    citationPrecision += results.length ? relevantCount / results.length : 0
    fallbackLinkRate += selectRelatedSources(results, []).length > 0 ? 1 : 0
    const rank = results.findIndex(result => expectedPages.has(result.url.split('#')[0]))
    if (rank >= 0) {
        hits++
        reciprocalRank += 1 / (rank + 1)
    }
}

const recallAt4 = hits / cases.length
const mrr = reciprocalRank / cases.length
const citationPrecisionAt4 = citationPrecision / cases.length
const citationCoverageAt4 = citationCoverage / cases.length
const fallbackLinks = fallbackLinkRate / cases.length
const parserProbe = parseGroundedResponse('可参考来源 [[sources:kb_test, kb_unknown]]')
const report = {
    cases: cases.length,
    hits,
    recallAt4: Number(recallAt4.toFixed(4)),
    mrr: Number(mrr.toFixed(4)),
    citationPrecisionAt4: Number(citationPrecisionAt4.toFixed(4)),
    citationCoverageAt4: Number(citationCoverageAt4.toFixed(4)),
    fallbackLinkRate: Number(fallbackLinks.toFixed(4)),
    parserProbe: parserProbe.citedSourceIds,
}
console.log(JSON.stringify(report, null, 2))

if (recallAt4 < 0.7 || mrr < 0.5 || citationPrecisionAt4 < 0.12 || citationCoverageAt4 < 0.7 || fallbackLinks < 0.8)
    throw new Error(`retrieval regression: Recall@4=${recallAt4.toFixed(3)}, MRR=${mrr.toFixed(3)}, citationPrecisionAt4=${citationPrecisionAt4.toFixed(3)}, citationCoverageAt4=${citationCoverageAt4.toFixed(3)}, fallbackLinkRate=${fallbackLinks.toFixed(3)}`)

if (parserProbe.citedSourceIds.join(',') !== 'kb_test,kb_unknown')
    throw new Error('citation parser regression: source markers were not normalized deterministically')
