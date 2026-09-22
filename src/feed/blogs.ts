import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { FeedSource } from './config.js'

const url = z.string().url().refine(value => /^https?:\/\//.test(value))
export const blogCatalogSchema = z.object({
  version: z.literal(1), rankingUrl: url, start: z.string(), end: z.string(), limit: z.number().int().positive(),
  entries: z.array(z.object({
    rank: z.number().int().positive(), domain: z.string().min(1), author: z.string(), siteUrl: url,
    feedUrl: url.nullable(), status: z.enum(['available', 'unresolved']), note: z.string(), aliasOf: z.string().optional(),
  })).refine(entries => new Set(entries.map(e => e.domain)).size === entries.length, 'Duplicate blog domains'),
})

export async function withBlogCatalog(sources: FeedSource[], file: string): Promise<FeedSource[]> {
  const catalog = blogCatalogSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')))
  if (catalog.entries.length !== catalog.limit) throw new Error('Blog catalog does not contain the requested ranking count')
  const result = sources.map(source => ({ ...source }))
  const normalized = (value: string) => value.replace(/^http:/, 'https:').replace(/\/$/, '')
  for (const entry of catalog.entries) {
    if (entry.aliasOf) {
      const primary = result.find(source => source.type === 'rss' && entry.feedUrl && normalized(source.url) === normalized(entry.feedUrl))
      if (!primary) throw new Error(`Missing primary feed for blog alias ${entry.domain}`)
      primary.siteAliases = [...(primary.siteAliases || []), entry.siteUrl]
      continue
    }
    const existing = result.find(source => source.type === 'rss' && entry.feedUrl && (normalized(source.url) === normalized(entry.feedUrl) || new URL(source.url).hostname.replace(/^www\./, '') === new URL(entry.siteUrl).hostname.replace(/^www\./, '') && new URL(source.url).pathname.startsWith(new URL(entry.siteUrl).pathname)))
    if (existing && existing.type === 'rss') {
      existing.channel = 'blogs'
      existing.siteUrl = entry.siteUrl
      existing.url = entry.feedUrl!
      if (entry.status !== 'available') { existing.enabled = false; existing.disabledReason = entry.note }
      continue
    }
    result.push({
      id: `blog-${createHash('sha256').update(entry.domain).digest('hex').slice(0, 12)}`,
      name: entry.author ? `${entry.author} · ${entry.domain}` : entry.domain,
      category: '综合', type: 'rss', url: entry.feedUrl || entry.siteUrl, siteUrl: entry.siteUrl,
      channel: 'blogs', limit: 100, enabled: entry.status === 'available',
      ...(entry.status === 'unresolved' ? { disabledReason: entry.note } : {}),
    })
  }
  if (new Set(result.map(source => source.id)).size !== result.length) throw new Error('Blog catalog source IDs conflict with configured sources')
  return result
}

export const isBlog = (item: { channel?: string }) => item.channel === 'blogs'

// Also route community links to subscribed blogs away from editorial candidates.
export function belongsToBlog(link: string, sources: FeedSource[]): boolean {
  let article: URL
  try { article = new URL(link) } catch { return false }
  return sources.some(source => {
    if (!isBlog(source) || !source.siteUrl) return false
    return [source.siteUrl, ...(source.siteAliases || [])].some(value => {
      const site = new URL(value)
      const host = (value: string) => value.replace(/^www\./, '')
      const prefix = site.pathname.replace(/\/$/, '')
      return (host(article.hostname) === host(site.hostname) || host(article.hostname).endsWith('.' + host(site.hostname))) && (!prefix || article.pathname === prefix || article.pathname.startsWith(prefix + '/'))
    })
  })
}
