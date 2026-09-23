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
  failure?: CollectionFailure
}

const failureNotes = {
  rss_http: 'RSS 返回 HTTP 错误', rss_timeout: 'RSS 请求或正文读取超时',
  rss_network: 'RSS 网络连接失败', rss_parse: 'RSS 内容无法解析为有效条目', rss_failed: 'RSS 采集失败，具体原因未知',
  x_timeout: 'OpenCLI 采集超时', x_navigation: 'OpenCLI 浏览器导航被拒绝',
  x_rate_limited: 'OpenCLI 返回限流错误', x_auth: 'OpenCLI 要求登录或授权',
  x_connection: 'OpenCLI 无法连接浏览器或扩展', x_invalid_response: 'OpenCLI 返回的数据不符合新闻格式',
  x_failed: 'OpenCLI 采集失败，具体原因未知',
} as const
export interface CollectionFailure { code: keyof typeof failureNotes; httpStatus?: number; exitCode?: number }
class CollectionError extends Error {
  constructor(readonly failure: CollectionFailure) { super(collectionFailureNote(failure)) }
}
export function collectionFailureNote(failure: CollectionFailure): string {
  return failureNotes[failure.code] + (failure.httpStatus ? ` ${failure.httpStatus}` : '')
}
// Only fixed categories and numeric statuses leave this boundary. Never retain
// child stderr, source response bodies, URLs, cookies or arbitrary exceptions.
export function classifyCollectionFailure(error: unknown, isFeed: boolean): CollectionFailure {
  if (error instanceof CollectionError) return error.failure
  const e = error as { name?: string; message?: string; stderr?: string; killed?: boolean; code?: string | number; cause?: { code?: string } } | null
  if (isFeed) {
    const status = String(e?.message || '').match(/^RSS HTTP ([1-5]\d\d)$/)?.[1]
    if (status) return { code: 'rss_http', httpStatus: Number(status) }
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || e?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') return { code: 'rss_timeout' }
    if (e?.message === 'fetch failed' || ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(String(e?.cause?.code || e?.code))) return { code: 'rss_network' }
    return { code: 'rss_failed' }
  }
  const diagnostic = String(e?.stderr || e?.message || '')
  const exitCode = typeof e?.code === 'number' && Number.isInteger(e.code) ? e.code : undefined
  const code: CollectionFailure['code'] = e?.killed || e?.name === 'TimeoutError' ? 'x_timeout'
    : /Navigation rejected|Pre-navigation.*failed/i.test(diagnostic) ? 'x_navigation'
    : /rate.?limit|too many requests|\b429\b/i.test(diagnostic) ? 'x_rate_limited'
    : /not logged in|login required|authentication required|unauthorized|\b401\b/i.test(diagnostic) ? 'x_auth'
    : /extension.*(?:not connected|disconnected)|connection refused|ECONNREFUSED|no browser/i.test(diagnostic) ? 'x_connection'
    : error instanceof z.ZodError || e?.name === 'SyntaxError' ? 'x_invalid_response' : 'x_failed'
  return { code, ...(exitCode !== undefined ? { exitCode } : {}) }
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

const parser = new Parser()
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
export const runOpenCli = async (args: string[], profile?: string, options?: FeedConfig['opencli']): Promise<string> => {
  try {
    const { stdout } = await exec(process.execPath, [require.resolve('@jackwener/opencli'), ...args], {
      timeout: options?.timeoutMs ?? 120000, maxBuffer: options?.maxBufferBytes ?? 10485760,
      env: { ...process.env, ...(profile ? { OPENCLI_PROFILE: profile } : {}) },
    })
    return stdout
  } catch (error) {
    // Child stderr can contain session details. Keep it out of reports and archives.
    throw new CollectionError(classifyCollectionFailure(error, false))
  }
}

async function fetchFeed(url: string, options: FeedConfig['collection']): Promise<string> {
  // Configured bounded retries for network errors and upstream 5xx responses. Do not
  // retry invalid XML, authentication errors or rate limits as if they were news.
  for (let attempt = 0; ; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(options.rssTimeoutMs), headers: { 'User-Agent': options.userAgent } })
    } catch (error) {
      if (attempt >= options.rssRetries) throw error
      await new Promise(resolve => setTimeout(resolve, options.retryDelayMs))
      continue
    }
    if (response.ok) return response.text()
    await response.body?.cancel()
    if (attempt >= options.rssRetries || response.status < 500) throw new Error(`RSS HTTP ${response.status}`)
    await new Promise(resolve => setTimeout(resolve, options.retryDelayMs))
  }
}

export interface PublicationWindow { start: Date; end: Date }

export async function collectSource(source: FeedSource, config: FeedConfig, now: string, run: OpenCliRunner = (args, profile) => runOpenCli(args, profile, config.opencli), window?: PublicationWindow): Promise<FeedItem[]> {
  if (source.type === 'rss' || source.type === 'rsshub') {
    const url = source.type === 'rss' ? source.url : `${(source.baseUrl || config.rsshub.baseUrl).replace(/\/$/, '')}${source.route}`
    const xml = await fetchFeed(url, config.collection)
    try { return await parseFeed(xml, { ...source, type: 'rss', url }, now, !!window) }
    catch { throw new CollectionError({ code: 'rss_parse' }) }
  }
  if (!config.opencli.enabled) throw new Error('OpenCLI is disabled in configuration')
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
