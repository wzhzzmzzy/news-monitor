import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Curation } from './curate.js'
import { loadNews, loadSnapshotEvidence, type NewsList } from './news.js'
import { renderFeed } from './view.js'
import { publishReader, type KoalablogOptions } from './koalablog.js'
import { makeReaderReport, dataMarkdown, safeUrl } from './reader-data.js'
import { eventSchema, indexEvents } from './events.js'
import { writeJson } from './store.js'

const topic = z.enum(['AI', '技术', '商业', '人文', '综合'])
export const agentReportSchema = z.object({
  version: z.literal('agent-report-v1'), snapshotId: z.string().uuid(),
  title: z.string().min(1).max(200), summary: z.string().max(3000),
  picks: z.array(z.object({ id: z.string(), reason: z.string().min(1).max(300), topic })).max(20),
  readingIds: z.array(z.string()).default([]),
  events: z.array(eventSchema).max(500).optional(),
  sections: z.array(z.object({
    title: z.string().min(1).max(200), kind: z.enum(['overview', 'new', 'update', 'correction', 'watch']),
    body: z.string().min(1).max(5000), evidenceIds: z.array(z.string()).min(1), beforeIds: z.array(z.string()).default([]),
  })).max(50),
})
export type AgentReport = z.infer<typeof agentReportSchema>
export function validateAgentReport(value: unknown, snapshot: NewsList) {
  if ([...snapshot.items, ...snapshot.blogs].some(item => !['ready', 'failed'].includes(item.languageStatus))) {
    throw new Error('Report summaries have not settled; regenerate the snapshot after all summaries complete or fail')
  }
  const report = agentReportSchema.parse(value)
  if (report.snapshotId !== snapshot.snapshotId) throw new Error('Report belongs to another snapshot')
  if (report.picks.length > (snapshot.preferences?.maxPicks ?? 20)) throw new Error('Too many picks for this snapshot')
  const ids = new Set(snapshot.items.map(i => i.id))
  const before = new Set(snapshot.baseline?.items.map(i => i.id))
  const selected = [...report.picks.map(p => p.id), ...report.readingIds]
  if (new Set(selected).size !== selected.length || selected.some(id => !ids.has(id))) throw new Error('Invalid or overlapping selection IDs')
  const events = indexEvents(report.events || [], ids)
  const pickedEvents = report.picks.map(p => events.get(p.id)?.eventId).filter(Boolean)
  if (new Set(pickedEvents).size !== pickedEvents.length) throw new Error('An event can only be picked once')
  const describedEvents = new Set<string>()
  for (const section of report.sections) {
    if (section.evidenceIds.some(id => !ids.has(id)) || section.beforeIds.some(id => !before.has(id))) throw new Error('Unknown report evidence IDs')
    const event = section.evidenceIds.map(id => events.get(id)).find(Boolean)
    if (event) {
      if (section.evidenceIds.some(id => events.get(id) !== event)) throw new Error('A section must describe one event')
      if (describedEvents.has(event.eventId)) throw new Error('An event can only have one overview section')
      describedEvents.add(event.eventId)
    }
    if (['update', 'correction'].includes(section.kind) && !section.beforeIds.length) throw new Error('Changes require baseline evidence')
  }
  return report
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export async function renderAgentReport(snapshotFile: string, decisionFile: string, output: string, email = false, koalablog?: KoalablogOptions) {
  const snapshot = await loadNews(snapshotFile)
  const pack = await loadSnapshotEvidence(snapshot, snapshotFile)
  const report = validateAgentReport(JSON.parse(await fs.readFile(decisionFile, 'utf8')), snapshot)
  const picks = new Map(report.picks.map((p, index) => [p.id, { ...p, rank: index + 1 }]))
  const entries: Curation['entries'] = Object.fromEntries(snapshot.items.map(item => {
    const picked = picks.get(item.id)
    return [item.id, { score: picked ? 100 : report.readingIds.includes(item.id) ? 60 : 0,
      topic: picked?.topic || item.category, reason: picked?.reason || '',
      tier: picked ? 'picks' : report.readingIds.includes(item.id) ? 'reading' : 'other', ...(picked ? { rank: picked.rank } : {}) }]
  }))
  const curation: Curation = { status: 'ready', total: snapshot.items.length, selected: picks.size, reading: report.readingIds.length, other: snapshot.items.length - picks.size - report.readingIds.length, cached: 0, entries }
  let citationNumber = 0
  const citation = (id: string, before = false) => {
    const item = (before ? snapshot.baseline?.items : snapshot.items)?.find(i => i.id === id)!
    const label = escape(`${before ? '早前：' : ''}${item.source} · ${item.title}`)
    const number = ++citationNumber
    const url = safeUrl(item.url)
    return url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer" title="${label}" aria-label="参考来源 ${number}：${label}" style="margin-left:3px;color:var(--accent)">[${number}]</a>` : `<span title="${label}" style="margin-left:3px">[${number}]</span>`
  }
  const kinds = { overview: '综述', new: '新增', update: '进展', correction: '更正', watch: '观察' }
  const overview = report.sections.length ? `<section class="report-overview" aria-labelledby="overview-heading" style="margin:20px 0 0;padding:20px 24px;background:var(--wash);border-radius:8px"><h3 id="overview-heading" style="font-size:12px;letter-spacing:.08em;color:var(--accent);margin:0 0 14px">新闻综述</h3><ol style="list-style:decimal;margin:0;padding-left:1.5em;font-size:13px">${report.sections.map(s => `<li style="margin:0 0 12px;padding-left:4px">${s.kind === 'overview' ? '' : `<h4 style="font-size:14px;margin:12px 0 6px">${kinds[s.kind]} · ${escape(s.title)}</h4>`}<p style="margin:0;font-size:13px;line-height:1.9;white-space:pre-wrap">${escape(s.body)}<sup class="citations" style="font-size:10px;line-height:0;vertical-align:super;white-space:nowrap">${s.evidenceIds.map(id => citation(id)).concat(s.beforeIds.map(id => citation(id, true))).join('')}</sup></p></li>`).join('')}</ol></section>` : ''
  const editorial = `<section aria-label="Agent 编辑报告" style="padding:28px 0 24px;border-bottom:1px solid var(--line)"><h2>${escape(report.title)}</h2>${report.summary.trim() ? `<p class="report-note" style="font-size:11px;line-height:1.8;color:var(--muted);white-space:pre-wrap">${escape(report.summary)}</p>` : ''}${overview}</section>`
  let html = renderFeed(pack.items, pack.results, `${snapshot.window.start} — ${snapshot.window.end}`, undefined, pack.stats, curation, { email, events: report.events })
  html = html.replace('</header>', `</header>${editorial}`).replace('<title>值得读 · News Feed</title>', `<title>${escape(report.title)}</title>`)
    .replace('译文、摘要与阅读筛选由模型生成', '译文与摘要由配置的模型生成；精选、变化判断与报告由调用方 Agent 编写')
  const target = path.resolve(output)
  const protectedFiles = [snapshotFile, decisionFile, path.join(path.dirname(snapshotFile), 'reading-pack.json')].map(p => path.resolve(p))
  if (protectedFiles.includes(target)) throw new Error('Output must not overwrite input evidence or decisions')
  await fs.mkdir(path.dirname(target), { recursive: true })
  try { await fs.writeFile(target, html, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if (!koalablog || (error as NodeJS.ErrnoException).code !== 'EEXIST' || await fs.readFile(target, 'utf8') !== html) throw error
  }
  let publication
  if (koalablog) {
    const { content, latest } = makeReaderReport(snapshot, report)
    await fs.writeFile(`${target}.report.md`, content, { mode: 0o600 })
    await fs.writeFile(`${target}.latest-candidate.md`, dataMarkdown(latest), { mode: 0o600 })
    await fs.copyFile(new URL('../../templates/news-feed.svelte', import.meta.url), `${target}.svelte`)
    publication = await publishReader(snapshot, report, koalablog)
    await writeJson(`${target}.koalablog.json`, publication)
  }
  return { output: target, snapshotId: snapshot.snapshotId, count: snapshot.items.length + snapshot.blogs.length, blogs: snapshot.blogs.length, selected: picks.size, email, ...(publication ? { publication } : {}) }
}
