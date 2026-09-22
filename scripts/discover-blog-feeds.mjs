// Resolve the checked-in ranking snapshot to publisher RSS/Atom feeds.
// No accounts, browser cookies, model calls, or ranking changes.
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseHTML } from 'linkedom'
import Parser from 'rss-parser'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const file = path.resolve(process.argv[2] || 'feeds/hn-popular-blogs.json')
const onlyUnresolved = process.argv.includes('--unresolved')
const useCurl = process.argv.includes('--curl')
const exec = promisify(execFile)
const catalog = JSON.parse(await fs.readFile(file, 'utf8'))
const cache = path.resolve('archive/blog-discovery')
await fs.mkdir(cache, { recursive: true })
const parser = new Parser()
const http = url => /^https?:\/\//i.test(url)
async function read(url) {
  if (!http(url)) throw new Error('Unsupported URL')
  if (useCurl) {
    const { stdout } = await exec('curl', ['--silent', '--show-error', '--location', '--fail', '--max-time', '25', '--proto', '=http,https', '--proto-redir', '=http,https', '--user-agent', 'news-monitor/1.0 (personal RSS reader)', '--write-out', '\n%{url_effective}', url], { maxBuffer: 8 * 1024 * 1024 })
    const boundary = stdout.lastIndexOf('\n')
    return { text: stdout.slice(0, boundary), url: stdout.slice(boundary + 1) }
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'news-monitor/1.0 (personal RSS reader)' } })
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`) }
  const text = await response.text()
  if (text.length > 8 * 1024 * 1024) throw new Error('Feed exceeds 8 MiB')
  return { url: response.url, text }
}
async function discover(entry) {
  if (entry.manualHold) { entry.status = 'unresolved'; entry.note = entry.manualHold; return }
  const candidates = []
  let homepageError
  const add = (url, via) => {
    if (http(url) && !candidates.some(c => c.url === url) && !/comments|replies/i.test(url)) candidates.push({ url, via })
  }
  if (entry.feedUrl) add(entry.feedUrl, 'existing')
  try {
    const page = await read(entry.discoveryPage || entry.siteUrl)
    await fs.writeFile(path.join(cache, `${entry.rank}.html`), page.text)
    const { document } = parseHTML(page.text)
    for (const link of document.querySelectorAll('link[rel~="alternate"][href]')) {
      if (/rss|atom|feed/i.test((link.getAttribute('type') || '') + link.getAttribute('href')) && !/comments/i.test(link.getAttribute('title') || '')) add(new URL(link.getAttribute('href'), page.url).href, 'html-alternate')
    }
    for (const a of document.querySelectorAll('a[href]')) {
      if (/\b(rss|atom|feed)\b/i.test(a.textContent) || /\.(rss|xml|atom)$|\/feed\/?$/i.test(a.getAttribute('href'))) {
        add(new URL(a.getAttribute('href'), page.url).href, 'html-link')
      }
    }
    entry.resolvedSiteUrl = page.url
  } catch (error) { homepageError = error.message }
  // A bounded conventional-path fallback, validated by parsing the response.
  for (const suffix of ['feed/', 'feed.xml', 'rss.xml', 'atom.xml']) add(new URL(suffix, entry.resolvedSiteUrl || entry.siteUrl).href, 'conventional-path')
  const attempts = []
  for (const candidate of candidates.slice(0, 8)) {
    try {
      const response = await read(candidate.url)
      const feed = await parser.parseString(response.text)
      if (!Array.isArray(feed.items)) throw new Error('Not RSS/Atom')
      entry.feedUrl = response.url
      entry.status = 'available'
      entry.discovery = candidate.via
      entry.checkedAt = new Date().toISOString()
      entry.feedItems = feed.items.length
      entry.note = '已解析 RSS/Atom；内容完整性与长期可用性未保证'
      delete entry.attempts
      await fs.writeFile(path.join(cache, `${entry.rank}.xml`), response.text)
      console.log(JSON.stringify({ rank: entry.rank, domain: entry.domain, status: entry.status, feedUrl: entry.feedUrl, count: feed.items.length }))
      return
    } catch (error) { attempts.push({ url: candidate.url, error: useCurl ? 'curl 无法读取或不是有效 RSS/Atom' : error.message }) }
  }
  entry.status = 'unresolved'
  entry.checkedAt = new Date().toISOString()
  entry.note = `未找到本次可解析的 RSS/Atom${homepageError ? `；主页：${homepageError}` : ''}`
  entry.attempts = attempts
  console.log(JSON.stringify({ rank: entry.rank, domain: entry.domain, status: entry.status, attempts: attempts.length }))
}
let next = 0
const entries = catalog.entries.filter(e => !onlyUnresolved || e.status !== 'available')
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < entries.length) await discover(entries[next++])
}))
// Aliases remain in the ranking for provenance, but are subscribed only once.
const feeds = new Map()
for (const entry of catalog.entries) {
  delete entry.aliasOf
  if (entry.status !== 'available') continue
  const normalized = entry.feedUrl.replace(/^http:/, 'https:').replace(/\/$/, '')
  if (feeds.has(normalized)) entry.aliasOf = feeds.get(normalized)
  else feeds.set(normalized, entry.domain)
}
await fs.writeFile(file + '.tmp', JSON.stringify(catalog, null, 2) + '\n')
await fs.rename(file + '.tmp', file)
console.log(JSON.stringify({ available: catalog.entries.filter(e => e.status === 'available').length, uniqueFeeds: feeds.size, unresolved: catalog.entries.filter(e => e.status !== 'available').map(e => e.domain) }))
