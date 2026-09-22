import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import Parser from 'rss-parser'
import { convert } from 'html-to-text'
import { z } from 'zod'
import type { FeedConfig, FeedSource } from './config.js'

export interface FeedItem {
  id: string
  sourceId: string
  sourceName: string
  category: string
  title: string
  url: string
  discussionUrl?: string
  author?: string
  publishedAt?: string
  fetchedAt: string
  content: string
  contentKind: 'feed-content' | 'feed-summary' | 'link-metadata' | 'title-only' | 'post'
  raw: unknown
  channel?: 'news' | 'blogs'
}
export interface SourceResult {
  sourceId: string
  sourceName: string
  status: 'ok' | 'failed' | 'disabled'
  count: number
  windowStartReached?: boolean
  coverage: 'feed-snapshot' | 'unknown'
  note: string
}

export function canonicalUrl(raw: string): string {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported item URL')
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key)
  }
  return url.toString()
}

export function stableId(url: string): string {
  const parsed = new URL(url)
  const tweetId = ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(parsed.hostname)
    ? parsed.pathname.match(/\/status\/(\d+)/)?.[1] : undefined
  return tweetId ? `x:${tweetId}` : `url:${createHash('sha256').update(canonicalUrl(url)).digest('hex')}`
}
function date(value?: string): string | undefined {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined
}
function optionalUrl(value: unknown, base: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try { return canonicalUrl(new URL(value, base).href) } catch { return undefined }
}

const parser = new Parser({ timeout: 20000, headers: { 'User-Agent': 'news-monitor/1.0 (personal RSS reader)' } })
export async function parseFeed(xml: string, source: Extract<FeedSource, { type: 'rss' }>, now: string, allEntries = false): Promise<FeedItem[]> {
  const feed = await parser.parseString(xml)
  // Blog subscriptions retain every entry present in the publisher's feed.
  return feed.items.slice(0, allEntries || source.channel === 'blogs' ? undefined : source.limit).map(item => {
    const url = item.link ? canonicalUrl(new URL(item.link, source.url).href) : ''
    const guid = item.guid || item.id
    if (!url && !guid) throw new Error('RSS item has neither a permalink nor a stable GUID')
    // A community submission describes the discussion, not the linked article.
    // Keep its identity separate so metadata cannot overwrite a publisher's body.
    const id = url && source.contentKind !== 'link-metadata'
      ? stableId(url) : `feed:${source.id}:${createHash('sha256').update(String(guid || url)).digest('hex')}`
    const full = item['content:encoded'] || item.content
    const html = full || item.summary || item.contentSnippet || ''
    return {
      id, sourceId: source.id, sourceName: source.name, category: source.category, channel: source.channel,
      title: convert(item.title || '(无标题)', { wordwrap: false }), url,
      discussionUrl: optionalUrl(item.comments, source.url),
      author: item.creator || item.author, publishedAt: date(item.isoDate || item.pubDate), fetchedAt: now,
      content: convert(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] }),
      // A feed's content field is not proof that the publisher supplied the complete article.
      contentKind: !html ? 'title-only' : source.contentKind || (full ? 'feed-content' : 'feed-summary'), raw: item,
    }
  })
}

const tweetSchema = z.object({
  id: z.string().regex(/^\d+$/), author: z.string(), text: z.string(), url: z.string().url(),
  created_at: z.string().optional(),
  quoted_tweet: z.object({ text: z.string().optional(), author: z.string().optional(), url: z.string().optional() }).passthrough().nullish(),
}).passthrough()

export function parseTweets(json: string, source: FeedSource, now: string): FeedItem[] {
  const tweets = z.array(tweetSchema).parse(JSON.parse(json))
  return tweets.slice(0, source.limit).map(tweet => {
    const url = canonicalUrl(tweet.url)
    if (stableId(url) !== `x:${tweet.id}`) throw new Error('X item ID does not match its permalink')
    const quoted = tweet.quoted_tweet
    const content = tweet.text + (quoted?.text ? `\n\n引用 @${quoted.author || 'unknown'}:\n${quoted.text}` : '')
    return {
      id: `x:${tweet.id}`, sourceId: source.id, sourceName: source.name, category: source.category,
      title: `@${tweet.author}: ${tweet.text.replace(/\s+/g, ' ').slice(0, 100)}`,
      url, author: tweet.author, publishedAt: date(tweet.created_at), fetchedAt: now,
      content, contentKind: 'post', raw: tweet,
    }
  })
}

export type OpenCliRunner = (args: string[], profile?: string) => Promise<string>
const exec = promisify(execFile)
const require = createRequire(import.meta.url)
export const runOpenCli: OpenCliRunner = async (args, profile) => {
  try {
    const { stdout } = await exec(process.execPath, [require.resolve('@jackwener/opencli'), ...args], {
      timeout: 120000, maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...(profile ? { OPENCLI_PROFILE: profile } : {}) },
    })
    return stdout
  } catch {
    // Child stderr can contain session details. Keep it out of reports and archives.
    throw new Error('OpenCLI failed; check Brave, X login and `pnpm exec opencli doctor`')
  }
}

async function fetchFeed(url: string): Promise<string> {
  // One bounded retry for network errors and upstream 5xx responses. Do not
  // retry invalid XML, authentication errors or rate limits as if they were news.
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'news-monitor/1.0 (personal RSS reader)' } })
    } catch (error) {
      if (attempt === 1) throw error
      await new Promise(resolve => setTimeout(resolve, 500))
      continue
    }
    if (response.ok) return response.text()
    await response.body?.cancel()
    if (attempt === 1 || response.status < 500) throw new Error(`RSS HTTP ${response.status}`)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

export interface PublicationWindow { start: Date; end: Date }

export async function collectSource(source: FeedSource, config: FeedConfig, now: string, run: OpenCliRunner = runOpenCli, window?: PublicationWindow): Promise<FeedItem[]> {
  if (source.type === 'rss' || source.type === 'rsshub') {
    const url = source.type === 'rss' ? source.url : `${(source.baseUrl || config.rsshub.baseUrl).replace(/\/$/, '')}${source.route}`
    return parseFeed(await fetchFeed(url), { ...source, type: 'rss', url }, now, !!window)
  }
  const args = source.type === 'x-list'
    ? ['twitter', 'list-tweets', source.listId]
    : ['twitter', 'tweets', source.username]
  if (!window) return parseTweets(await run([...args, '--limit', String(source.limit), '-f', 'json'], config.opencli.profile), source, now)
  // OpenCLI owns cursor pagination. Grow the requested prefix until it reaches
  // the report start; its array response cannot prove exhaustion or full coverage.
  const items = new Map<string, FeedItem>()
  let limit = Math.min(config.collection.xMaxItems, Math.max(100, source.limit))
  while (true) {
    let batch: FeedItem[]
    try {
      batch = parseTweets(await run([...args, '--limit', String(limit), '-f', 'json'], config.opencli.profile), { ...source, limit }, now)
    } catch (error) {
      if (!items.size) throw error
      // Preserve already fetched evidence if a larger paginated request fails.
      break
    }
    const size = items.size
    for (const item of batch) items.set(item.id, item)
    if (batch.some(item => item.publishedAt && Date.parse(item.publishedAt) < +window.start)
      || batch.length < limit || items.size === size || limit >= config.collection.xMaxItems) break
    limit = Math.min(limit * 2, config.collection.xMaxItems)
  }
  return [...items.values()]
}
