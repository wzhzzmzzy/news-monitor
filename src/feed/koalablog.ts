import { createHash } from 'node:crypto'
import { EnvHttpProxyAgent } from 'undici'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { makeReaderReport, latestSchema, parseData, dataMarkdown } from './reader-data.js'
import type { AgentReport } from './agent-report.js'
import type { NewsList } from './news.js'

export interface KoalablogOptions { url: string; tokenEnv?: string; updateShell?: boolean; dataOnly?: boolean }
const remoteFile = z.object({ id: z.number().int().positive(), path: z.string(), renderer: z.enum(['markdown', 'svelte']), content: z.string(), revision: z.number().int().positive(), artifactStatus: z.string().optional() })
const body = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
export function publicData(text: string): unknown {
  if (text.includes('```json\n')) return parseData(text)
  const code = text.match(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/i)?.[1]
  if (!code) throw new Error('Anonymous page is missing report JSON')
  const plain = code.replace(/<[^>]*>/g, '').replace(/&(#x[0-9a-f]+|#\d+|quot|apos|lt|gt|amp);/gi, (_, entity: string) => {
    const e = entity.toLowerCase()
    return e.startsWith('#x') ? String.fromCodePoint(parseInt(e.slice(2), 16)) : e.startsWith('#') ? String.fromCodePoint(Number(e.slice(1))) : ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' }[e]!)
  })
  return JSON.parse(plain)
}
export async function publishReader(snapshot: NewsList, report: AgentReport, options: KoalablogOptions, request?: typeof fetch) {
  if (request) return publishWithRequest(snapshot, report, options, request)
  const dispatcher = new EnvHttpProxyAgent()
  try { return await publishWithRequest(snapshot, report, options, (input, init) => fetch(input, { ...init, dispatcher } as RequestInit)) }
  finally { await dispatcher.destroy() }
}

async function publishWithRequest(snapshot: NewsList, report: AgentReport, options: KoalablogOptions, request: typeof fetch) {
  const origin = new URL(options.url)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Koalablog URL must be an HTTPS origin without credentials, path, query or fragment')
  const tokenEnv = options.tokenEnv || 'KOALABLOG_API_TOKEN'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv)) throw new Error('Expected an environment variable name for Koalablog token')
  const token = process.env[tokenEnv]
  if (!token) throw new Error(`Set ${tokenEnv} before publishing to Koalablog`)
  const api = async (route: string, init: RequestInit = {}) => {
    let response: Response
    try { response = await request(new URL(route, origin), { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) }) }
    catch { throw new Error('Koalablog request failed; retry the same report to reconcile. No automatic write retry was sent.') }
    if (!response.ok) throw new Error(`Koalablog request failed (HTTP ${response.status}); no concurrent content was overwritten`)
    return response
  }
  const listingSchema = z.array(z.object({ id: z.number().int().positive(), path: z.string(), artifactStatus: z.string().optional() }))
  const listing = listingSchema.parse(await (await api('/api/markdown/batch?source=memo')).json())
  const read = async (path: string) => {
    const found = listing.find(f => f.path === path)
    if (!found) return undefined
    return remoteFile.parse((await (await api(`/api/sync/files/${found.id}`)).json() as { file: unknown }).file)
  }
  const save = async (path: string, renderer: 'markdown' | 'svelte', content: string, previous?: z.infer<typeof remoteFile>) => {
    if (previous && previous.renderer !== renderer) throw new Error(`Renderer conflict at ${path}`)
    if (previous && body(previous.content) === body(content)) return previous
    const response = await api('/api/markdown/batch', { method: 'POST', body: JSON.stringify([{ id: previous?.id || 0, baseRevision: previous?.revision || 0, path, renderer, content, private: false }]) })
    const result = z.object({ success: z.literal(true), count: z.literal(1), results: z.array(remoteFile).length(1) }).parse(await response.json()).results[0]
    if (result.path !== path || result.renderer !== renderer || body(result.content) !== body(content)) throw new Error('Koalablog readback differs from this report')
    return result
  }
  const verifyPublic = async (path: string, expected?: unknown) => {
    const url = origin.origin + path.split('?')[0].split('/').map(encodeURIComponent).join('/') + (path.includes('?') ? '?' + path.split('?')[1] : '')
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
    if (response.status !== 200) throw new Error(`Public access failed at ${path} (HTTP ${response.status})`)
    if (expected !== undefined) {
      if (!isDeepStrictEqual(publicData(await response.text()), expected)) throw new Error(`Anonymous report data differs at ${path}`)
    } else await response.body?.cancel()
  }
  const unfinished = [...snapshot.items, ...snapshot.blogs].filter(i => i.languageStatus && !['ready', 'failed'].includes(i.languageStatus))
  if (unfinished.length) throw new Error('Cannot publish before all news and blog summaries reach ready/failed')
  const { data, latest, content } = makeReaderReport(snapshot, report)
  // Daily delivery only needs the deployed reader, even if its Source has evolved.
  const deployedShell = options.dataOnly ? await read('/news-feed') : undefined
  const shellStatus = listing.find(f => f.id === deployedShell?.id)?.artifactStatus
  // Koalablog keeps the last deployed Artifact online when saved Source drifts.
  if (options.dataOnly && (!deployedShell || deployedShell.renderer !== 'svelte' || !['deployed', 'deployment_drift'].includes(shellStatus || ''))) throw new Error('Data-only publication requires an existing deployed /news-feed reader')
  if (options.dataOnly && options.updateShell) throw new Error('Data-only publication cannot update the reader Source')
  if (options.dataOnly) await verifyPublic('/news-feed')
  const oldData = await read(latest.path)
  if (oldData && body(oldData.content) !== body(content)) throw new Error(`Report already exists with different content at ${latest.path}; nothing overwritten`)
  const savedData = await save(latest.path, 'markdown', content, oldData)
  await verifyPublic(latest.path, data)
  let savedShell = deployedShell
  if (!savedShell) {
    const shell = await fs.readFile(new URL('../../templates/news-feed.svelte', import.meta.url), 'utf8')
    const oldShell = await read('/news-feed')
    if (oldShell && body(oldShell.content) !== body(shell) && !options.updateShell) throw new Error('Reader source differs; use --koalablog-update-shell to update it, then Deploy in Dashboard')
    savedShell = await save('/news-feed', 'svelte', shell, oldShell)
  }
  // Re-read the index immediately before CAS. A concurrent publisher must retry on 409.
  listing.splice(0, listing.length, ...listingSchema.parse(await (await api('/api/markdown/batch?source=memo')).json()))
  const oldIndex = await read('/data/news-feed/latest')
  const current = oldIndex ? latestSchema.parse(parseData(oldIndex.content)) : undefined
  const advances = !current || Date.parse(latest.cutoff) > Date.parse(current.cutoff)
  if (current && latest.cutoff === current.cutoff && latest.path !== current.path) throw new Error('Two reports share a cutoff; latest index was not changed')
  if (advances) await save('/data/news-feed/latest', 'markdown', dataMarkdown(latest), oldIndex)
  await verifyPublic('/data/news-feed/latest', advances ? latest : current)
  // The Source is uploaded here; only Dashboard Deploy attaches its executable Artifact.
  const summary = z.array(z.object({ id: z.number(), artifactStatus: z.string().optional() })).parse(await (await api('/api/markdown/batch?source=memo')).json()).find(f => f.id === savedShell.id)
  const status = summary?.artifactStatus || 'not_deployed'
  const deployed = status === 'deployed'
  const readerAvailable = deployed || Boolean(options.dataOnly && status === 'deployment_drift')
  if (readerAvailable) {
    await verifyPublic('/news-feed')
    await verifyPublic(`/news-feed?${new URLSearchParams({ date: latest.date, edition: latest.path.split('/').pop()! })}`)
  }
  return { id: savedShell.id, url: `${origin.origin}/news-feed`, reportUrl: `${origin.origin}/news-feed?${new URLSearchParams({ date: latest.date, edition: latest.path.split('/').pop()! })}`, path: '/news-feed', renderer: 'svelte', visibility: 'public', source: 'memo', artifactStatus: status, readerAvailable, deploymentRequired: !readerAvailable,
    dataPath: latest.path, dataId: savedData.id, latestPath: '/data/news-feed/latest', latestAdvanced: advances, current: advances ? latest : current,
    contentSha256: createHash('sha256').update(content).digest('hex'), count: data.items.length }
}
