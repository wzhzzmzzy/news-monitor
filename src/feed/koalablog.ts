import { createHash } from 'node:crypto'
import { EnvHttpProxyAgent } from 'undici'
import { z } from 'zod'
import fs from 'node:fs/promises'
import { makeReaderReport, latestSchema, parseData, dataMarkdown } from './reader-data.js'
import type { AgentReport } from './agent-report.js'
import type { NewsList } from './news.js'

export interface KoalablogOptions { url: string; tokenEnv?: string; updateShell?: boolean }
const remoteFile = z.object({ id: z.number().int().positive(), path: z.string(), renderer: z.enum(['markdown', 'svelte']), content: z.string(), revision: z.number().int().positive(), artifactStatus: z.string().optional() })
const body = (content: string) => content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
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
  const listing = z.array(z.object({ id: z.number().int().positive(), path: z.string() })).parse(await (await api('/api/markdown/batch?source=memo')).json())
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
  const verifyPublic = async (path: string) => {
    const url = origin.origin + path.split('/').map(encodeURIComponent).join('/')
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(30000) })
    await response.body?.cancel()
    if (response.status !== 200) throw new Error(`Public access failed at ${path} (HTTP ${response.status})`)
  }
  const { data, latest, content } = makeReaderReport(snapshot, report)
  const oldData = await read(latest.path)
  if (oldData && body(oldData.content) !== body(content)) throw new Error(`Report already exists with different content at ${latest.path}; nothing overwritten`)
  const savedData = await save(latest.path, 'markdown', content, oldData)
  await verifyPublic(latest.path)
  const shell = await fs.readFile(new URL('../../templates/news-feed.svelte', import.meta.url), 'utf8')
  const oldShell = await read('/news-feed')
  if (oldShell && body(oldShell.content) !== body(shell) && !options.updateShell) throw new Error('Reader source differs; use --koalablog-update-shell to update it, then Deploy in Dashboard')
  const savedShell = await save('/news-feed', 'svelte', shell, oldShell)
  // Re-read the index immediately before CAS. A concurrent publisher must retry on 409.
  const oldIndex = await read('/data/news-feed/latest')
  const current = oldIndex ? latestSchema.parse(parseData(oldIndex.content)) : undefined
  const advances = !current || Date.parse(latest.cutoff) > Date.parse(current.cutoff)
  if (current && latest.cutoff === current.cutoff && latest.path !== current.path) throw new Error('Two reports share a cutoff; latest index was not changed')
  if (advances) await save('/data/news-feed/latest', 'markdown', dataMarkdown(latest), oldIndex)
  await verifyPublic('/data/news-feed/latest')
  // The Source is uploaded here; only Dashboard Deploy attaches its executable Artifact.
  const summary = z.array(z.object({ id: z.number(), artifactStatus: z.string().optional() })).parse(await (await api('/api/markdown/batch?source=memo')).json()).find(f => f.id === savedShell.id)
  const status = summary?.artifactStatus || 'not_deployed'
  const deployed = status === 'deployed'
  if (deployed) await verifyPublic('/news-feed')
  return { id: savedShell.id, url: `${origin.origin}/news-feed`, reportUrl: `${origin.origin}/news-feed?${new URLSearchParams({ date: latest.date, edition: latest.path.split('/').pop()! })}`, path: '/news-feed', renderer: 'svelte', visibility: 'public', source: 'memo', artifactStatus: status, deploymentRequired: !deployed,
    dataPath: latest.path, dataId: savedData.id, latestPath: '/data/news-feed/latest', latestAdvanced: advances, current: advances ? latest : current,
    contentSha256: createHash('sha256').update(content).digest('hex'), count: data.items.length }
}
