import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { collectSource, type FeedItem } from './collect.js'
import { feedConfigSchema } from './config.js'
import { runFeed } from './pipeline.js'
import { localizeItems } from './localize.js'
import { editionRange, queryNews } from './news.js'

const window = editionRange('morning', '2026-09-22')
const now = '2026-09-22T02:45:00.000Z'
const dirs: string[] = []
async function config(type: 'rss' | 'x-user' = 'rss') {
  const archiveDir = await fs.mkdtemp(path.join(os.tmpdir(), 'collection-window-')); dirs.push(archiveDir)
  return feedConfigSchema.parse({ archiveDir, localization: { enabled: false }, collection: { xMaxItems: 200 }, sources: [
    type === 'rss' ? { id: 'rss', name: 'RSS', type, url: 'https://news.example/feed', limit: 1 } : { id: 'x', name: 'X', type, username: 'example', limit: 5 },
  ] })
}
const tweet = (id: number, created_at = '2026-09-22T01:00:00.000Z') => ({ id: String(id), author: 'example', text: `post ${id}`, url: `https://x.com/example/status/${id}`, created_at })
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) await fs.rm(dir, { recursive: true, force: true }) })

it('archives every returned RSS entry for reports but translates only eligible news', async () => {
  const cfg = await config()
  const feed = '<rss version="2.0"><channel><title>News</title>' + [
    ['too-new', '2026-09-22T02:15:00Z'], ['eligible', '2026-09-22T01:00:00Z'], ['old', '2020-01-01T00:00:00Z'],
  ].map(([id, time]) => `<item><title>${id}</title><link>https://news.example/${id}</link><description>${id}</description><pubDate>${new Date(time).toUTCString()}</pubDate></item>`).join('') + '</channel></rss>'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(feed)))
  const localize = vi.fn(localizeItems)
  const result = await runFeed(cfg, { publicationWindow: window }, collectSource, localize)
  const raw = JSON.parse(await fs.readFile(path.join(result.runDir, 'source-pack.json'), 'utf8'))
  expect(raw.items.map((i: FeedItem) => i.title)).toEqual(['too-new', 'eligible', 'old'])
  expect(localize.mock.calls[0][0].map(i => i.title)).toEqual(['eligible'])
})

it.each(['x-user', 'x-list'] as const)('expands %s requests past the small source limit and preserves all returned posts', async type => {
  const cfg = await config('x-user')
  const source = type === 'x-user' ? cfg.sources[0] : { ...cfg.sources[0], type, listId: '123' }
  const run = vi.fn(async (args: string[]) => JSON.stringify(Array.from({ length: Number(args[args.indexOf('--limit') + 1]) }, (_, i) => tweet(i + 1, i === 150 ? '2026-09-20T00:00:00Z' : undefined))))
  const items = await collectSource(source, cfg, now, run, window)
  expect(run.mock.calls.map(([args]) => args[args.indexOf('--limit') + 1])).toEqual(['100', '200'])
  expect(items).toHaveLength(200)
  expect(run.mock.calls[0][0].slice(0, 3)).toEqual(type === 'x-user' ? ['twitter', 'tweets', 'example'] : ['twitter', 'list-tweets', '123'])
})

it('preserves successful X pages when expansion fails and marks an unconfirmed window as partial', async () => {
  const cfg = await config('x-user')
  vi.useFakeTimers(); vi.setSystemTime(new Date(now))
  const run = vi.fn().mockResolvedValueOnce(JSON.stringify(Array.from({ length: 100 }, (_, i) => tweet(i + 1)))).mockRejectedValueOnce(new Error('pagination failed'))
  const collect = (c: typeof cfg, options: Parameters<typeof runFeed>[1]) => runFeed(c, options, (source, config, time, _run, range) => collectSource(source, config, time, run, range), localizeItems)
  const snapshot = await queryNews(cfg, { ...window, edition: 'morning', refresh: true }, localizeItems, collect)
  expect(snapshot.items).toHaveLength(100)
  expect(snapshot.coverage.incompleteSources).toEqual(['x'])
  expect(snapshot.status).toBe('partial')
  expect(run).toHaveBeenCalledTimes(2)
})

it('stops at the configured X cap or short result without claiming exhaustion', async () => {
  const cfg = await config('x-user')
  const run = vi.fn(async (args: string[]) => JSON.stringify(Array.from({ length: Number(args[args.indexOf('--limit') + 1]) }, (_, i) => tweet(i + 1))))
  expect(await collectSource(cfg.sources[0], cfg, now, run, window)).toHaveLength(200)
  expect(run).toHaveBeenCalledTimes(2)
  run.mockReset().mockResolvedValue(JSON.stringify([tweet(1)]))
  expect(await collectSource(cfg.sources[0], cfg, now, run, window)).toHaveLength(1)
  expect(run).toHaveBeenCalledTimes(1)
})
