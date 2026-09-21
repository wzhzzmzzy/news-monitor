import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { feedConfigSchema } from './config.js'
import { collectSource, parseFeed, parseTweets, stableId } from './collect.js'
import { FeedStore } from './store.js'
import { analyzeFeed, makeEvidencePack, renderFeed, validateEvidence } from './report.js'
import { runFeed } from './pipeline.js'
import { generateObject } from 'ai'

vi.mock('ai', () => ({ generateObject: vi.fn() }))

const now = '2026-09-21T08:00:00Z'
const config = feedConfigSchema.parse({ sources: [
  { id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/feed' },
  { id: 'x', name: 'X', type: 'x-user', username: 'simonw' },
] })
const rss = config.sources[0] as Extract<(typeof config.sources)[number], { type: 'rss' }>
const xml = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Test</title><link>https://example.com</link><item><title>Only a title</title><link>https://example.com/post?utm_source=test</link><description>Teaser</description><content:encoded><![CDATA[<p>Body with &amp; evidence beyond the title.</p>]]></content:encoded><pubDate>Mon, 21 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>`
const tweet = { id: '1234567890123456789', author: 'simonw', text: 'A long post '.repeat(100), url: 'https://x.com/simonw/status/1234567890123456789', created_at: 'Mon Sep 21 00:00:00 +0000 2026', quoted_tweet: { author: 'other', text: 'Quoted evidence', url: 'https://x.com/other/status/42' }, likes: 5 }
const directories: string[] = []
async function temp() { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-feed-test-')); directories.push(dir); return dir }
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('RSS/X collection pipeline', () => {
  it('accepts RSS-only and X-only configuration without NewsNow, SMTP or model keys', () => {
    expect(feedConfigSchema.parse({ sources: [config.sources[0]] }).sources).toHaveLength(1)
    expect(feedConfigSchema.parse({ sources: [config.sources[1]] }).sources).toHaveLength(1)
    expect(() => feedConfigSchema.parse({ sources: [rss, rss] })).toThrow('Source IDs must be unique')
  })

  it('retains RSS content, publication date and raw evidence', async () => {
    const [item] = await parseFeed(xml, rss, now)
    expect(item.content).toBe('Body with & evidence beyond the title.')
    expect(item.publishedAt).toBe('2026-09-21T00:00:00.000Z')
    expect(item.url).toBe('https://example.com/post')
    expect(item.raw).toHaveProperty('content:encoded')
  })

  it('reads Atom content and relative permalinks', async () => {
    const [item] = await parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>Atom post</title><link href="/atom-post"/><id>tag:example:1</id><updated>2026-09-20T00:00:00Z</updated><content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content></entry></feed>`, rss, now)
    expect(item.content).toBe('Atom body')
    expect(item.url).toBe('https://example.com/atom-post')
  })

  it('keeps community submission metadata separate from the linked article evidence', async () => {
    const source = { ...rss, id: 'hacker-news', name: 'Hacker News · 社区链接', contentKind: 'link-metadata' as const }
    const hnXml = '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>HN</title><item><title>Shared link</title><link>https://example.com/post</link><guid>https://news.ycombinator.com/item?id=123</guid><comments>https://news.ycombinator.com/item?id=123</comments><dc:creator>submitter</dc:creator><description>Points: 100</description><pubDate>Mon, 21 Sep 2026 00:00:00 GMT</pubDate></item></channel></rss>'
    const [submission] = await parseFeed(hnXml, source, now)
    const [article] = await parseFeed(xml, rss, now)
    expect(submission.url).toBe(article.url)
    expect(submission.id).not.toBe(article.id)
    expect(submission.discussionUrl).toBe('https://news.ycombinator.com/item?id=123')
    expect(submission.contentKind).toBe('link-metadata')
    const store = new FeedStore(await temp())
    const stored = await store.merge([article, submission])
    expect(stored).toHaveLength(2)
    expect(stored.find(i => i.id === article.id)?.content).toBe('Body with & evidence beyond the title.')
    const [updated] = await store.merge(await parseFeed(hnXml.replace('Points: 100', 'Points: 105'), source, now))
    expect(updated.id).toBe(submission.id)
    expect(updated.change).toBe('updated')
    const llm = feedConfigSchema.parse({ sources: [source], llm: { model: 'test' } }).llm!
    const [evidence] = makeEvidencePack([updated], llm)
    expect(evidence.contentKind).toBe('link-metadata')
    expect(evidence.discussionUrl).toBe(submission.discussionUrl)
    expect(evidence.content).toBe('Points: 105')
    const html = renderFeed([updated], [], now)
    expect(html).toContain('外链正文未采集')
    expect(html).toContain('提交者：submitter')
    expect(html).toContain('href="https://news.ycombinator.com/item?id=123"')
    const [unsafe] = await parseFeed(hnXml.replace('<comments>https://news.ycombinator.com/item?id=123</comments>', '<comments>javascript:alert(1)</comments>'), source, now)
    expect(unsafe.discussionUrl).toBeUndefined()
  })

  it('honors a known summary-only source without discarding its text or inventing a body', async () => {
    const source = { ...rss, contentKind: 'feed-summary' as const }
    const [summary] = await parseFeed(xml, source, now)
    expect(summary.contentKind).toBe('feed-summary')
    expect(summary.content).toBe('Body with & evidence beyond the title.')
    const [empty] = await parseFeed('<rss version="2.0"><channel><title>Summary</title><item><title>No body</title><link>https://example.com/empty</link></item></channel></rss>', source, now)
    expect(empty.contentKind).toBe('title-only')
    expect(feedConfigSchema.parse({ sources: [source] }).sources[0]).toHaveProperty('contentKind', 'feed-summary')
  })

  it('keeps linkless flash news by source-scoped GUID and labels missing bodies', async () => {
    const linkless = '<rss version="2.0"><channel><title>Flash</title><item><title>Headline is all the publisher supplied</title><guid isPermaLink="false">jin10:123</guid></item></channel></rss>'
    const [item] = await parseFeed(linkless, rss, now)
    expect(item.id).toMatch(/^feed:rss:/)
    expect(item.url).toBe('')
    expect(item.content).toBe('')
    expect(item.contentKind).toBe('title-only')
    const [differentSource] = await parseFeed(linkless, { ...rss, id: 'another-feed' }, now)
    expect(differentSource.id).not.toBe(item.id)
    const store = new FeedStore(await temp())
    expect((await store.merge([item]))[0].change).toBe('new')
    const [seen] = await store.merge((await parseFeed(linkless, rss, '2026-09-22T08:00:00Z')))
    expect(seen.change).toBe('seen')
    expect(renderFeed([seen], [], now)).toContain('来源未提供文章链接')
    await expect(parseFeed(linkless.replace('<guid isPermaLink="false">jin10:123</guid>', ''), rss, now)).rejects.toThrow('stable GUID')
  })

  it('resolves global and per-source RSSHub instances and rejects HTML error pages', async () => {
    const hub = feedConfigSchema.parse({ rsshub: { baseUrl: 'https://hub.example.com/' }, sources: [
      { id: 'global', name: 'Global', type: 'rsshub', route: '/cls/hot' },
      { id: 'override', name: 'Override', type: 'rsshub', route: '/thepaper/sidebar/hotNews', baseUrl: 'https://other.example.com' },
    ] })
    const fetcher = vi.fn().mockImplementation(async () => new Response(xml))
    vi.stubGlobal('fetch', fetcher)
    expect(await collectSource(hub.sources[0], hub, now)).toHaveLength(1)
    expect(await collectSource(hub.sources[1], hub, now)).toHaveLength(1)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['https://hub.example.com/cls/hot', 'https://other.example.com/thepaper/sidebar/hotNews'])
    fetcher.mockResolvedValueOnce(new Response('<html><body>upstream unavailable</body></html>'))
    await expect(collectSource(hub.sources[0], hub, now)).rejects.toThrow()
    fetcher.mockResolvedValueOnce(new Response('Rate limited', { status: 429 }))
    await expect(collectSource(hub.sources[0], hub, now)).rejects.toThrow('429')
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('retries transient RSS failures only once and preserves a successful response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('Temporary error', { status: 503 }))
      .mockResolvedValueOnce(new Response(xml))
    vi.stubGlobal('fetch', fetcher)
    expect(await collectSource(rss, config, now)).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockReset().mockRejectedValue(new Error('Network unreachable'))
    await expect(collectSource(rss, config, now)).rejects.toThrow('Network unreachable')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not collect disabled sources and exposes the reason in the preview', async () => {
    const disabled = feedConfigSchema.parse({ archiveDir: await temp(), sources: [{ ...rss, enabled: false, disabledReason: '实例待修复' }] })
    const collect = vi.fn()
    const result = await runFeed(disabled, {}, collect)
    expect(collect).not.toHaveBeenCalled()
    expect(result.results[0].status).toBe('disabled')
    expect(await fs.readFile(result.preview, 'utf8')).toContain('未启用；实例待修复')
  })

  it('preserves long X posts and quoted text and invokes only a read command', async () => {
    const run = vi.fn().mockResolvedValue(JSON.stringify([tweet]))
    const [item] = await collectSource(config.sources[1], { ...config, opencli: { profile: 'brave-context' } }, now, run)
    expect(run).toHaveBeenCalledWith(['twitter', 'tweets', 'simonw', '--limit', '10', '-f', 'json'], 'brave-context')
    expect(item.content).toContain(tweet.text)
    expect(item.content).toContain('Quoted evidence')
    expect(item.raw).toHaveProperty('likes', 5)
    expect(item.id).toBe(`x:${tweet.id}`)
    expect(stableId('https://twitter.com/someone/status/1234567890123456789?s=20')).toBe(item.id)
    expect(() => parseTweets(JSON.stringify([{ ...tweet, url: 'https://example.com/spoof' }]), config.sources[1], now)).toThrow()
  })

  it('supports list sources without shell interpolation', async () => {
    const listConfig = feedConfigSchema.parse({ sources: [{ id: 'list', name: 'List', type: 'x-list', listId: '123', limit: 5 }] })
    const run = vi.fn().mockResolvedValue('[]')
    await collectSource(listConfig.sources[0], listConfig, now, run)
    expect(run).toHaveBeenCalledWith(['twitter', 'list-tweets', '123', '--limit', '5', '-f', 'json'], undefined)
  })

  it('keeps stable identities across days and distinguishes edited content', async () => {
    const store = new FeedStore(await temp())
    const items = await parseFeed(xml, rss, now)
    expect((await store.merge(items))[0].change).toBe('new')
    const tomorrow = { ...items[0], fetchedAt: '2026-09-22T08:00:00Z' }
    const [seen] = await store.merge([tomorrow])
    expect(seen.change).toBe('seen')
    expect(seen.firstSeen).toBe(now)
    expect(seen.lastSeen).toBe(tomorrow.fetchedAt)
    expect((await store.merge([{ ...tomorrow, content: 'Edited body' }]))[0].change).toBe('updated')
    const duplicate = { ...tomorrow, sourceId: 'second-source' }
    const merged = await store.merge([tomorrow, duplicate])
    expect(merged).toHaveLength(1)
    expect(merged[0].sourceIds).toEqual(['rss', 'second-source'])
  })

  it('refuses concurrent collectors and preserves corrupt indexes for diagnosis', async () => {
    const dir = await temp()
    const store = new FeedStore(dir)
    await store.withLock(async () => { await expect(store.withLock(async () => null)).rejects.toThrow('locked') })
    await fs.writeFile(path.join(dir, 'index.json'), 'broken')
    await expect(store.merge([])).rejects.toThrow()
    expect(await fs.readFile(path.join(dir, 'index.json'), 'utf8')).toBe('broken')
  })

  it('feeds body text into the bounded model evidence pack and rejects invented citations', async () => {
    const store = new FeedStore(await temp())
    const items = await store.merge(parseTweets(JSON.stringify([tweet]), config.sources[1], now))
    const llm = feedConfigSchema.parse({ sources: [rss], llm: { model: 'test', maxCharsPerItem: 200 } }).llm!
    const pack = makeEvidencePack(items, llm)
    expect(pack[0].content).toBe(tweet.text.slice(0, 200))
    expect(pack[0].truncated).toBe(true)
    expect(items[0].content.length).toBeGreaterThan(200)
    expect(() => validateEvidence({ summary: 'test', topics: [{ title: 'test', category: '技术', analysis: 'test', evidenceIds: ['invented'] }] }, new Set([items[0].id]))).toThrow('unknown evidence')
  })

  it('writes a readable partial preview and shows source failure without leaking stderr', async () => {
    const dir = await temp()
    const collect = vi.fn().mockImplementation(async (source) => {
      if (source.type !== 'rss') throw new Error('cookie=secret')
      return parseFeed(xml, rss, now)
    })
    const result = await runFeed({ ...config, archiveDir: dir }, {}, collect)
    expect(result.count).toBe(1)
    expect(result.results[1].status).toBe('failed')
    const html = await fs.readFile(result.preview, 'utf8')
    expect(html).toContain('Body with &amp; evidence beyond the title.')
    expect(html).toContain('采集失败')
    expect(html).not.toContain('secret')
    const pack = JSON.parse(await fs.readFile(path.join(result.runDir, 'source-pack.json'), 'utf8'))
    expect(pack.items[0].content).toContain('Body with & evidence')
    expect(JSON.parse(await fs.readFile(path.join(dir, 'latest.json'), 'utf8')).analyzed).toBe(false)
    expect(generateObject).not.toHaveBeenCalled()
  })

  it('passes actual source text to the model and validates returned evidence IDs', async () => {
    vi.stubEnv('NEWS_FEED_LLM_API_KEY', 'test-key')
    const items = await new FeedStore(await temp()).merge(await parseFeed(xml, rss, now))
    const llm = feedConfigSchema.parse({ sources: [rss], llm: { model: 'test' } }).llm!
    const digest = { summary: '摘要', topics: [{ title: '正文事实', category: '技术', analysis: '原文事实的解释', evidenceIds: [items[0].id] }] }
    vi.mocked(generateObject).mockResolvedValue({ object: digest } as any)
    const result = await analyzeFeed(items, llm)
    const call = vi.mocked(generateObject).mock.calls[0][0]
    expect(JSON.parse(call.prompt as string)[0].content).toBe('Body with & evidence beyond the title.')
    expect(result.digest).toEqual(digest)
    vi.mocked(generateObject).mockResolvedValue({ object: { ...digest, topics: [{ ...digest.topics[0], evidenceIds: ['invented'] }] } } as any)
    await expect(analyzeFeed(items, llm)).rejects.toThrow('unknown evidence')
  })

  it('rejects removed internal editorial analysis before touching sources', async () => {
    const collect = vi.fn()
    await expect(runFeed({ ...config, archiveDir: await temp() }, { analyze: true }, collect)).rejects.toThrow('calling agent')
    expect(collect).not.toHaveBeenCalled()
  })

  it('escapes untrusted text and cannot emit a javascript link', async () => {
    const [item] = await new FeedStore(await temp()).merge(parseTweets(JSON.stringify([tweet]), config.sources[1], now))
    const html = renderFeed([{ ...item, title: '<script>alert(1)</script>', content: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }], [], now)
    expect(html.match(/<script>/g)).toHaveLength(1)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('&lt;img')
  })
})
