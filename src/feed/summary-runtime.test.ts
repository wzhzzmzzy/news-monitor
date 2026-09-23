import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateObject } from 'ai'
import { parseFeedConfig, type FeedConfig } from './config.js'
import { localizeItems } from './localize.js'
import type { StoredItem } from './store.js'

vi.mock('ai', () => ({ generateObject: vi.fn() }))
let dir: string
let config: FeedConfig
const now = '2026-09-23T02:00:00.000Z'
const item: StoredItem = { id: 'test', sourceId: 'rss', sourceName: 'RSS', sourceIds: ['rss'], category: '技术', title: 'News', url: 'https://example.com/news', content: 'Full source text', contentKind: 'feed-content', raw: {}, fetchedAt: now, firstSeen: now, lastSeen: now, change: 'new' }
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'summary-runtime-'))
  config = parseFeedConfig({ archiveDir: dir, sources: [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/feed' }], llm: { model: 'test', apiKeyEnv: 'SUMMARY_TEST_KEY' } })
  vi.stubEnv('SUMMARY_TEST_KEY', 'test-key')
  vi.mocked(generateObject).mockReset().mockResolvedValue({ object: { titleZh: '新闻', summaryZh: '这是中文摘要。' }, finishReason: 'stop' } as any)
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }) })

it('makes one summary call per normal article with configured prompts and generation controls', async () => {
  Object.assign(config.llm!, { summaryMaxTokens: 512, temperature: 0.3, maxRetries: 0, timeoutMs: 5000 })
  config.prompts.summaryPart = '自定义摘要要求。'
  const result = await localizeItems([item], config)
  expect(result.stats.generated).toBe(1)
  expect(generateObject).toHaveBeenCalledTimes(1)
  expect(vi.mocked(generateObject).mock.calls[0][0]).toMatchObject({ maxTokens: 512, temperature: 0.3, maxRetries: 0 })
  expect(vi.mocked(generateObject).mock.calls[0][0].system).toContain('自定义摘要要求。')
  expect(result.items[0].chinese).toMatchObject({ mode: 'summary', contentZh: '', translated: false })
  expect(result.items[0].content).toBe(item.content)
  await localizeItems([item], config)
  expect(generateObject).toHaveBeenCalledTimes(1)
  config.prompts.summaryPart = '修改后的摘要要求。'
  await localizeItems([item], config)
  expect(generateObject).toHaveBeenCalledTimes(2)
  config.llm!.summaryMaxTokens = 768
  await localizeItems([item], config)
  expect(generateObject).toHaveBeenCalledTimes(3)
})

it('respects validation retry budget and records failure without a body translation', async () => {
  config.llm!.validationRetries = 0
  vi.mocked(generateObject).mockResolvedValue({ object: { titleZh: '新闻', summaryZh: 'not Chinese' }, finishReason: 'stop' } as any)
  const result = await localizeItems([item], config)
  expect(result.stats.failed).toBe(1)
  expect(generateObject).toHaveBeenCalledTimes(1)
  expect(result.items[0].chinese).toBeUndefined()
})

it('reuses historical full caches only with compatible prompts and preserves cache files', async () => {
  const identity = { version: 'zh-reading-v1', model: 'test', baseUrl: '', piProvider: '', mode: 'json', id: item.id,
    context: { title: item.title, source: item.sourceName, category: item.category, contentKind: item.contentKind }, content: item.content, chunkChars: config.localization.chunkChars }
  const fingerprint = createHash('sha256').update(JSON.stringify(identity)).digest('hex')
  const file = path.join(dir, 'chinese/items', `${fingerprint}.json`)
  await fs.mkdir(path.dirname(file), { recursive: true })
  const cache = JSON.stringify({ version: 'zh-reading-v1', model: 'test', processedAt: now, fingerprint, titleZh: '旧标题', contentZh: '旧译文', summaryZh: '旧摘要。', translated: true, chunks: 1 })
  await fs.writeFile(file, cache)
  const result = await localizeItems([item], config)
  expect(result.stats.cached).toBe(1)
  expect(result.items[0].chinese).toMatchObject({ titleZh: '旧标题', contentZh: '', summaryZh: '旧摘要。' })
  expect(generateObject).not.toHaveBeenCalled()
  expect(await fs.readFile(file, 'utf8')).toBe(cache)
  config.prompts.common += '新的要求。'
  expect((await localizeItems([item], config)).stats.generated).toBe(1)
  expect(generateObject).toHaveBeenCalledTimes(1)
})
