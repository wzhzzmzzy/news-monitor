import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { feedConfigSchema, type FeedConfig } from './config.js'
import { curateItems, validateRatings, validateSelection, type CurationRunner } from './curate.js'
import type { ReadingItem } from './localize.js'

let dir: string
let config: FeedConfig
const item = (id: number): ReadingItem => ({
  id: String(id).padStart(3, '0'), title: `Article ${id}`, sourceId: 'source', sourceName: 'Source', category: '技术', content: `Body ${id}`,
  contentKind: 'feed-content', url: `https://example.com/${id}`, fetchedAt: '2026-09-21T10:00:00Z', firstSeen: '', lastSeen: '', sourceIds: ['source'], change: 'new', raw: {}, chineseStatus: 'ready',
  chinese: { version: 'zh-reading-v1', titleZh: `文章 ${id}`, contentZh: `正文 ${id}`, summaryZh: `核心摘要 ${id}`, fingerprint: String(id), model: 'test', processedAt: '', translated: true, chunks: 1 },
})
const runner: CurationRunner = async (kind, input) => kind === 'rate'
  ? { ratings: (input as { id: number }[]).map(e => ({ id: e.id, score: e.id === 2 ? 40 : 85, topic: '技术', reason: '包含对读者有价值的具体变化。' })) }
  : { picks: [0], groups: [{ primary: 0, related: [1] }] }
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-editor-test-'))
  config = feedConfigSchema.parse({ archiveDir: dir, curation: { enabled: true }, sources: [{ id: 'source', name: 'Source', type: 'rss', url: 'https://example.com/rss' }], llm: { model: 'test', apiKeyEnv: 'NEWS_CURATE_TEST_KEY' } })
  vi.stubEnv('NEWS_CURATE_TEST_KEY', '')
})
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true }) })

it('rates all items, selects a bounded shortlist and retains lower priorities and duplicate events', async () => {
  const run = vi.fn(runner)
  const items = Array.from({ length: 50 }, (_, i) => item(i))
  const result = await curateItems(items, config, run)
  expect(result).toMatchObject({ status: 'ready', total: 50, selected: 1, reading: 47, other: 2 })
  expect(Object.keys(result.entries)).toHaveLength(50)
  expect(result.entries['001'].duplicateOf).toBe('000')
  expect(run.mock.calls.filter(c => c[0] === 'rate')).toHaveLength(3)
  expect(run.mock.calls.find(c => c[0] === 'select')![1]).toHaveLength(50)
  const noNetwork = vi.fn().mockRejectedValue(new Error('Must use cache'))
  expect((await curateItems([...items].reverse(), config, noNetwork)).cached).toBe(50)
  expect(noNetwork).not.toHaveBeenCalled()
  const changed = { ...config, curation: { ...config.curation, interests: '更关注人文' } }
  expect((await curateItems(items, changed, run)).cached).toBe(0)
})

it('rejects missing/unknown IDs and contradictory or overlapping duplicate groups', () => {
  expect(() => validateRatings({ ratings: [] }, [0])).toThrow()
  const rate = { id: 9, score: 80, topic: '技术', reason: '阅读理由。' }
  expect(() => validateRatings({ ratings: [rate] }, [0])).toThrow()
  expect(() => validateSelection({ picks: [0, 1], groups: [] }, [0, 1], 1)).toThrow()
  expect(() => validateSelection({ picks: [0], groups: [{ primary: 1, related: [0] }] }, [0, 1], 2)).toThrow()
  expect(() => validateSelection({ picks: [], groups: [{ primary: 0, related: [1] }, { primary: 1, related: [2] }] }, [0, 1, 2], 2)).toThrow()
  expect(() => validateSelection({ picks: [4], groups: [] }, [0, 1], 2)).toThrow()
})

it('keeps all items available on model failure and reuses successful batch ratings', async () => {
  let batches = 0
  const run: CurationRunner = async (kind, input) => {
    if (kind === 'rate' && ++batches > 1) throw new Error('secret must not appear')
    return runner(kind, input)
  }
  const items = Array.from({ length: 30 }, (_, i) => item(i))
  const failed = await curateItems(items, config, run)
  expect(failed).toMatchObject({ status: 'failed', entries: {}, reading: 30 })
  expect(JSON.stringify(failed)).not.toContain('secret')
  const resume = vi.fn(runner)
  const result = await curateItems(items, config, resume)
  expect(result.status).toBe('ready')
  expect(result.cached).toBe(24)
  expect(resume.mock.calls.filter(c => c[0] === 'rate')).toHaveLength(1)
})

it('does not quietly discard untranslated items or claim a shortlist without model decisions', async () => {
  const run = vi.fn(runner)
  expect((await curateItems([{ ...item(0), chinese: undefined }], config, run)).status).toBe('pending')
  expect(run).not.toHaveBeenCalled()
  expect((await curateItems([item(0)], config)).status).toBe('pending')
  expect((await curateItems([item(0)], { ...config, curation: { ...config.curation, enabled: false } }, run)).status).toBe('disabled')
})
