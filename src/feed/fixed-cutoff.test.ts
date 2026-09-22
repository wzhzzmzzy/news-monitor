import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { feedConfigSchema } from './config.js'
import { editionRange, queryNews } from './news.js'
import { runFeed } from './pipeline.js'
import { localizeItems } from './localize.js'

let dir: string
const range = editionRange('morning', '2026-09-22')
afterEach(async () => { vi.useRealTimers(); if (dir) await fs.rm(dir, { recursive: true, force: true }) })
it('includes an 08:00 article collected at 10:45 without shifting the 10:00 publication cutoff', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixed-cutoff-'))
  const config = feedConfigSchema.parse({ archiveDir: dir, localization: { enabled: false }, sources: [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://news.example/feed' }] })
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T02:45:00Z'))
  const collect = async (cfg: typeof config) => runFeed(cfg, {}, async () => [
    ['within', '2026-09-22T00:00:00Z'], ['at-start', range.start.toISOString()],
    ['at-end', range.end.toISOString()], ['after', '2026-09-22T02:30:00Z'], ['old', '2026-09-21T01:59:59Z'],
  ].map(([id, publishedAt]) => ({ id, publishedAt, title: id, content: id, sourceId: 'rss', sourceName: 'RSS', category: '技术', url: `https://news.example/${id}`, fetchedAt: new Date().toISOString(), contentKind: 'feed-content' as const, raw: {} })), async (items, cfg) => { vi.setSystemTime(new Date('2026-09-22T02:46:00Z')); return localizeItems(items, cfg) })
  const result = await queryNews(config, { ...range, edition: 'morning', refresh: true }, localizeItems, collect)
  expect(result.window).toMatchObject({ start: range.start.toISOString(), end: range.end.toISOString() })
  expect(result.items.map(i => i.id)).toEqual(['at-start', 'within'])
  expect(result.coverage.observations).toContain('2026-09-22T02:45:00.000Z')
})

it('carries 10:30 news first fetched by the morning run into evening without repeating morning blog observations', async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fixed-cutoff-baseline-'))
  const config = feedConfigSchema.parse({ archiveDir: dir, localization: { enabled: false }, sources: [
    { id: 'rss', name: 'RSS', type: 'rss', url: 'https://news.example/feed' },
    { id: 'blog', name: 'Blog', type: 'rss', url: 'https://blog.example/feed', channel: 'blogs' },
  ] })
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T02:45:00Z'))
  let morningRun = true
  const collect = (cfg: typeof config, options: Parameters<typeof runFeed>[1]) => runFeed(cfg, options, async source => {
    if (!morningRun) return []
    return [{ id: source.id, publishedAt: source.id === 'blog' ? '2020-01-01T00:00:00Z' : '2026-09-22T02:30:00Z',
      title: source.name, content: source.name, sourceId: source.id, sourceName: source.name, category: '技术',
      channel: source.channel, url: `https://${source.id}.example/post`, fetchedAt: new Date().toISOString(), contentKind: 'feed-content' as const, raw: {} }]
  }, localizeItems)
  const before = await queryNews(config, { ...range, edition: 'morning', refresh: true }, localizeItems, collect)
  expect(before.items).toEqual([])
  expect(before.blogs.map(i => i.id)).toEqual(['blog'])
  const bytes = await fs.readFile(before.snapshotPath, 'utf8')
  morningRun = false
  vi.setSystemTime(new Date('2026-09-22T12:30:00Z'))
  const after = await queryNews(config, { ...editionRange('evening', '2026-09-22'), edition: 'evening', baseline: before.snapshotPath, refresh: true }, localizeItems, collect)
  expect(after.window).toMatchObject({ start: range.end.toISOString(), end: '2026-09-22T12:00:00.000Z', basis: 'publishedAt' })
  expect(after.items.map(i => i.id)).toEqual(['rss'])
  expect(after.blogs).toEqual([])
  expect(await fs.readFile(before.snapshotPath, 'utf8')).toBe(bytes)
})
