import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { feedConfigSchema, loadFeedConfig, type FeedConfig } from './config.js'
import { localizeItems, splitContent, summarySchema, type ReadingRequest } from './localize.js'
import { FeedStore, type StoredItem } from './store.js'
import { renderFeed } from './report.js'
import { runFeed } from './pipeline.js'
import { runFeedReport, validateSchedule } from './runtime.js'
import { requireLlm, resolveLlm } from './llm.js'

let dir: string
let config: FeedConfig
const now = '2026-09-21T10:00:00Z'
const item = (id = 'one', content = 'The product ships in October.') : StoredItem => ({
  id, sourceId: 'rss', sourceName: 'RSS', sourceIds: ['rss'], category: '技术',
  title: 'New product', url: `https://example.com/${id}`, fetchedAt: now,
  firstSeen: now, lastSeen: now, content, contentKind: 'feed-content', raw: { content }, change: 'new',
})
const translate = (request: ReadingRequest) => request.kind === 'summarize' ? { summaryZh: '综合各段：产品将于十月发布。' } : {
  titleLanguage: 'other', contentLanguage: request.payload.content ? 'other' : 'nonlinguistic',
  titleZh: '新产品', contentZh: request.payload.content ? `中文译文第 ${request.payload.part} 段。` : '', summaryZh: '产品将于十月发布。',
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-chinese-test-'))
  config = feedConfigSchema.parse({ archiveDir: dir, localization: { mode: 'full', chunkChars: 500, concurrency: 2 },
    sources: [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/feed' }],
    llm: { model: 'test', apiKeyEnv: 'NEWS_TEST_READING_KEY', maxItems: 1, maxCharsPerItem: 200 },
  })
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }) })

describe('per-item Chinese reading', () => {
  it('defaults to summaries and keeps full source evidence without asking for a translation', async () => {
    const summaryConfig = feedConfigSchema.parse({ ...config, localization: {} })
    const original = item()
    const runner = vi.fn(async (_r: ReadingRequest) => ({ titleZh: '新产品', summaryZh: '产品将于十月发布。' }))
    const result = await localizeItems([original], summaryConfig, runner)
    expect(result.stats).toMatchObject({ ready: 1, generated: 1 })
    expect(runner.mock.calls[0]?.[0]).toMatchObject({ kind: 'summary-part' })
    expect(result.items[0].content).toBe(original.content)
    expect(result.items[0].chinese).toMatchObject({ mode: 'summary', contentZh: '', titleZh: '新产品' })
    const html = renderFeed(result.items, [], now)
    expect(html).toContain('查看原文')
    expect(html).not.toContain('完整中文')
    expect(html).toContain(original.content)
  })

  it('summarizes every long-text segment including the tail, then combines summaries', async () => {
    const summaryConfig = feedConfigSchema.parse({ ...config, localization: { mode: 'summary', summaryChunkChars: 500 } })
    const body = 'A long paragraph. 🦀\n'.repeat(80) + 'FINAL EVIDENCE'
    const runner = vi.fn(async (r: ReadingRequest) => ({ titleZh: '新产品', summaryZh: r.kind === 'summarize' ? '合并所有段落的摘要。' : '当前段的中文摘要。' }))
    const result = await localizeItems([item('long-summary', body)], summaryConfig, runner)
    const requests = runner.mock.calls.map(([r]) => r)
    expect(result.stats.ready).toBe(1)
    expect(requests.every(r => r.kind !== 'translate')).toBe(true)
    expect(requests.filter(r => r.kind === 'summary-part').map(r => r.payload.content).join('')).toBe(body)
    expect(requests.at(-1)?.kind).toBe('summarize')
    expect(result.items[0].chinese?.contentZh).toBe('')
    const cached = vi.fn().mockRejectedValue(new Error('No model expected'))
    expect((await localizeItems([item('long-summary', body)], summaryConfig, cached)).stats.cached).toBe(1)
    expect(cached).not.toHaveBeenCalled()
  })

  it('reuses existing full-mode summaries without including old translated bodies or changing caches', async () => {
    const original = item('reuse-full')
    await localizeItems([original], config, async r => translate(r))
    const files = await fs.readdir(path.join(dir, 'chinese', 'items'))
    const file = path.join(dir, 'chinese', 'items', files[0])
    const before = await fs.readFile(file, 'utf8')
    const summaryConfig = feedConfigSchema.parse({ ...config, localization: { ...config.localization, mode: 'summary' } })
    const runner = vi.fn().mockRejectedValue(new Error('No model expected'))
    const result = await localizeItems([original], summaryConfig, runner)
    expect(result.stats.cached).toBe(1)
    expect(result.items[0].chinese).toMatchObject({ mode: 'summary', contentZh: '', summaryZh: '产品将于十月发布。' })
    expect(runner).not.toHaveBeenCalled()
    expect(await fs.readFile(file, 'utf8')).toBe(before)
  })

  it('resumes only failed summary parts and preserves Chinese titles', async () => {
    const summaryConfig = feedConfigSchema.parse({ ...config, localization: { mode: 'summary', summaryChunkChars: 500 } })
    const original = { ...item('summary-retry', '正文'.repeat(600)), title: '原始中文标题' }
    const runner = vi.fn(async (r: ReadingRequest) => {
      if (r.payload.part === 2) throw new Error('Failure')
      return { titleZh: '不应修改的标题', summaryZh: '该段摘要。' }
    })
    expect((await localizeItems([original], summaryConfig, runner)).stats.failed).toBe(1)
    const retry = vi.fn(async (_r: ReadingRequest) => ({ titleZh: '模型标题', summaryZh: '完整中文摘要。' }))
    const result = await localizeItems([original], summaryConfig, retry)
    expect(result.stats.ready).toBe(1)
    expect(retry.mock.calls.map(([r]) => r.payload.part).filter(Boolean)).toEqual([2, 3])
    expect(result.items[0].chinese?.titleZh).toBe(original.title)
  })

  it('translates every item beyond digest limits and preserves the source evidence', async () => {
    const original = [item('a'), item('b'), { ...item('c', '中文原文\n保留数字 123。'), title: '中文标题' }]
    const snapshot = structuredClone(original)
    const runner = vi.fn(async (request: ReadingRequest) => request.payload.title === '中文标题'
      ? { titleLanguage: 'zh', contentLanguage: 'zh', titleZh: '不应替换的标题', contentZh: '', summaryZh: '中文文章核心内容。' }
      : translate(request))
    const result = await localizeItems(original, config, runner)
    expect(result.stats).toMatchObject({ ready: 3, generated: 3, failed: 0 })
    expect(runner).toHaveBeenCalledTimes(3)
    expect(result.items[0].chinese).toMatchObject({ titleZh: '新产品', translated: true })
    expect(result.items[2].chinese).toMatchObject({ titleZh: '中文标题', contentZh: original[2].content, translated: false })
    expect(original).toEqual(snapshot)
    const noModel = vi.fn().mockRejectedValue(new Error('No model should run'))
    const cached = await localizeItems(original, config, noModel)
    expect(cached.stats.cached).toBe(3)
    expect(noModel).not.toHaveBeenCalled()
    expect((await localizeItems(original, config)).stats.cached).toBe(3)
    const changed = await localizeItems([{ ...original[0], content: 'Updated body.' }], config, runner)
    expect(changed.stats.generated).toBe(1)
    const otherModel = await localizeItems([original[0]], { ...config, llm: { ...config.llm!, model: 'other' } }, runner)
    expect(otherModel.stats.generated).toBe(1)
  })

  it('covers the entire long text and reduces all chunks without truncating Unicode characters', async () => {
    const body = ('Paragraph with an emoji 🦀.\n'.repeat(130)) + 'LAST PARAGRAPH'
    const chunks = splitContent(body, 500)
    expect(chunks.join('')).toBe(body)
    expect(chunks.every(chunk => Array.from(chunk).length <= 500)).toBe(true)
    const runner = vi.fn(async (request: ReadingRequest) => ({ ...translate(request), summaryZh: `${request.payload.part || (request.payload.summaries as string[]).map(s => s.split('核')[0]).join(',')}${'核'.repeat(170)}` }))
    const result = await localizeItems([item('long', body)], config, runner)
    expect(result.stats.ready).toBe(1)
    const requests = runner.mock.calls.map(call => call[0])
    expect(requests.filter(r => r.kind === 'translate').map(r => r.payload.content).join('')).toBe(body)
    expect(requests.filter(r => r.kind === 'summarize').length).toBeGreaterThan(2)
    expect(result.items[0].chinese?.contentZh).toContain(`第 ${chunks.length} 段`)
    expect(result.items[0].chinese?.chunks).toBe(chunks.length)
  })

  it('validates the 200-codepoint boundary including punctuation and retries invalid model output', async () => {
    expect(summarySchema.safeParse('中'.repeat(199) + '。').success).toBe(true)
    expect(summarySchema.safeParse('中'.repeat(199) + '🦀').success).toBe(true)
    expect(summarySchema.safeParse('中'.repeat(200) + '。').success).toBe(false)
    expect(summarySchema.safeParse('English only').success).toBe(false)
    const runner = vi.fn(async (request: ReadingRequest) => ({ ...translate(request), summaryZh: request.retry ? '合格的短摘要。' : '中'.repeat(201) }))
    const result = await localizeItems([item()], config, runner)
    expect(result.stats.ready).toBe(1)
    expect(runner.mock.calls.map(call => call[0].retry)).toEqual([false, true])
    expect(result.items[0].chinese?.summaryZh).toBe('合格的短摘要。')
  })

  it('preserves successful parts when another part fails and resumes from the failure', async () => {
    const original = item('long', 'a'.repeat(1100))
    const fail = vi.fn(async (request: ReadingRequest) => {
      if (request.payload.part === 2) throw new Error('API key=do-not-leak')
      return translate(request)
    })
    const first = await localizeItems([original], config, fail)
    expect(first.stats.failed).toBe(1)
    expect(first.items[0].chinese).toBeUndefined()
    expect(JSON.stringify(first)).not.toContain('do-not-leak')
    const retry = vi.fn(async (request: ReadingRequest) => translate(request))
    const second = await localizeItems([original], config, retry)
    expect(second.stats.ready).toBe(1)
    expect(retry.mock.calls.filter(call => call[0].kind === 'translate').map(call => call[0].payload.part)).toEqual([2, 3])
  })

  it('does not fabricate body text for title-only sources or accept untranslated English', async () => {
    const titleOnly = { ...item('empty', ''), contentKind: 'title-only' as const }
    const runner = vi.fn(async (request: ReadingRequest) => translate(request))
    const result = await localizeItems([titleOnly], config, runner)
    expect(result.items[0].chinese?.contentZh).toBe('')
    const invalid = vi.fn(async (request: ReadingRequest) => ({ ...translate(request), contentZh: 'Invented English body' }))
    expect((await localizeItems([{ ...titleOnly, id: 'another', title: 'Another title' }], config, invalid)).stats.failed).toBe(1)
    expect((await localizeItems([item('english')], config, invalid)).stats.failed).toBe(1)
  })

  it('keeps original text with explicit pending status when credentials are absent', async () => {
    vi.stubEnv('NEWS_TEST_READING_KEY', '')
    const result = await localizeItems([item()], config)
    expect(result.stats).toMatchObject({ pending: 1, ready: 0 })
    expect(result.items[0].content).toBe(item().content)
    expect(result.items[0].chineseStatus).toBe('pending')
    expect(renderFeed(result.items, [], now, undefined, result.stats)).toContain('中文翻译和摘要待处理')
    const disabled = await localizeItems([item()], { ...config, localization: { ...config.localization, enabled: false } })
    expect(disabled.stats.enabled).toBe(false)
    expect(() => validateSchedule(config)).toThrow('NEWS_TEST_READING_KEY')
  })

  it('renders a Chinese summary with escaped full translation and retained original', async () => {
    const result = await localizeItems([item()], config, async request => ({ ...translate(request), titleZh: '中文 <script>', contentZh: '中文 <img src=x>', summaryZh: '核心事实。' }))
    const html = renderFeed(result.items, [], now, undefined, result.stats)
    expect(html).toContain('核心事实。')
    expect(html).toContain('完整中文译文')
    expect(html).toContain(item().content)
    expect(html).toContain('&lt;img')
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('完成 1/1')
  })

  it('backfills all historical items through the report path, reuses collection cache and blocks incomplete mail', async () => {
    const localize = (items: StoredItem[], cfg: FeedConfig) => localizeItems(items, cfg, async request => translate(request))
    const collect = await runFeed(config, {}, async () => [item()], localize)
    const sourcePack = await fs.readFile(path.join(collect.runDir, 'source-pack.json'), 'utf8')
    const deliver = vi.fn()
    const report = await runFeedReport(config, { start: new Date('2000-01-01'), end: new Date('2000-01-02'), all: true }, deliver)
    expect(report.localization.cached).toBe(1)
    expect(report.count).toBe(1)
    expect(report.window.all).toBe(true)
    expect(deliver).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(collect.runDir, 'source-pack.json'), 'utf8')).toBe(sourcePack)
    expect(sourcePack).not.toContain('summaryZh')
    // Change the model to deliberately invalidate the cache and leave work pending.
    const changed = { ...config, llm: { ...config.llm!, model: 'unconfigured-new-model' }, email: {
      emailFrom: 'sender@example.com', emailTo: ['reader@example.com'], emailFromName: 'News Feed', passwordEnv: 'NEWS_TEST_SMTP_PASS',
    } }
    vi.stubEnv('NEWS_TEST_SMTP_PASS', 'test-only')
    const pending = await runFeedReport(changed, { start: new Date(0), end: new Date(), all: true, send: true }, deliver)
    expect(pending.sent).toBe(false)
    expect(pending.deliveryError).toContain('邮件未发送')
    expect(deliver).not.toHaveBeenCalled()
    // Raw store remains independently usable.
    expect((await new FeedStore(dir).merge([item()]))[0].content).toBe(item().content)
  })
})

describe('Pi gateway credentials', () => {
  it('reads only the selected provider without changing or archiving its credential', async () => {
    const file = path.join(dir, 'models.json')
    const data = JSON.stringify({ providers: { gateway: { api: 'openai-completions', baseUrl: 'https://gateway.example/v1', apiKey: 'secret-value', models: [{ id: 'test' }] } } })
    await fs.writeFile(file, data)
    const llm = { ...config.llm!, piProvider: 'gateway', piModelsPath: file }
    expect(requireLlm(llm)).toEqual({ model: 'test', baseURL: 'https://gateway.example/v1', apiKey: 'secret-value' })
    expect(await fs.readFile(file, 'utf8')).toBe(data)
    const feedFile = path.join(dir, 'feed.yaml')
    await fs.writeFile(feedFile, JSON.stringify({ sources: config.sources, llm: { model: 'test', piProvider: 'gateway', piModelsPath: './models.json' } }))
    expect(requireLlm((await loadFeedConfig(feedFile)).llm).baseURL).toBe('https://gateway.example/v1')
    await fs.writeFile(file, data.replace('secret-value', 'PI_GATEWAY_TEST_KEY'))
    vi.stubEnv('PI_GATEWAY_TEST_KEY', 'environment-secret')
    expect(resolveLlm(llm).apiKey).toBe('environment-secret')
    await fs.writeFile(file, data.replace('secret-value', '!echo never-execute'))
    expect(() => requireLlm(llm)).toThrow('commands are unsupported')
    await fs.writeFile(file, data.replace('openai-completions', 'anthropic-messages'))
    expect(() => requireLlm(llm)).toThrow('openai-completions')
    await fs.writeFile(file, data)
    expect(() => requireLlm({ ...llm, model: 'missing' })).toThrow('does not exist')
  })
})
