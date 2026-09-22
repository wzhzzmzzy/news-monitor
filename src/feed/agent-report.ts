import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Curation } from './curate.js'
import { loadNews, loadSnapshotEvidence, type NewsList } from './news.js'
import { renderFeed } from './view.js'

const topic = z.enum(['AI', '技术', '商业', '人文', '综合'])
export const agentReportSchema = z.object({
  version: z.literal('agent-report-v1'), snapshotId: z.string().uuid(),
  title: z.string().min(1).max(200), summary: z.string().max(3000),
  picks: z.array(z.object({ id: z.string(), reason: z.string().min(1).max(300), topic })).max(20),
  readingIds: z.array(z.string()).default([]),
  sections: z.array(z.object({
    title: z.string().min(1).max(200), kind: z.enum(['overview', 'new', 'update', 'correction', 'watch']),
    body: z.string().min(1).max(5000), evidenceIds: z.array(z.string()).min(1), beforeIds: z.array(z.string()).default([]),
  })).max(50),
})
export type AgentReport = z.infer<typeof agentReportSchema>
export function validateAgentReport(value: unknown, snapshot: NewsList) {
  const report = agentReportSchema.parse(value)
  if (report.snapshotId !== snapshot.snapshotId) throw new Error('Report belongs to another snapshot')
  const ids = new Set(snapshot.items.map(i => i.id))
  const before = new Set(snapshot.baseline?.items.map(i => i.id))
  const selected = [...report.picks.map(p => p.id), ...report.readingIds]
  if (new Set(selected).size !== selected.length || selected.some(id => !ids.has(id))) throw new Error('Invalid or overlapping selection IDs')
  for (const section of report.sections) {
    if (section.evidenceIds.some(id => !ids.has(id)) || section.beforeIds.some(id => !before.has(id))) throw new Error('Unknown report evidence IDs')
    if (['update', 'correction'].includes(section.kind) && !section.beforeIds.length) throw new Error('Changes require baseline evidence')
  }
  return report
}
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export async function renderAgentReport(snapshotFile: string, decisionFile: string, output: string, email = false) {
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
  const citation = (id: string, before = false) => {
    const item = (before ? snapshot.baseline?.items : snapshot.items)?.find(i => i.id === id)!
    const label = escape(`${before ? '早前：' : ''}${item.source} · ${item.title}`)
    return /^https?:\/\//i.test(item.url) ? `<a href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
  }
  const kinds = { overview: '综述', new: '新增', update: '进展', correction: '更正', watch: '观察' }
  const editorial = `<section aria-label="Agent 编辑报告" style="padding:28px 0 16px;border-bottom:1px solid var(--line)"><h2>${escape(report.title)}</h2><p style="white-space:pre-wrap">${escape(report.summary)}</p>${report.sections.map(s => `<article style="margin-top:24px"><p class="kicker">${kinds[s.kind]}</p><h3>${escape(s.title)}</h3><p style="white-space:pre-wrap">${escape(s.body)}</p><p class="meta">${s.beforeIds.map(id => citation(id, true)).concat(s.evidenceIds.map(id => citation(id))).join(' · ')}</p></article>`).join('')}</section>`
  let html = renderFeed(pack.items, pack.results, `${snapshot.window.start} — ${snapshot.window.end}`, undefined, pack.stats, curation, { email })
  html = html.replace('</header>', `</header>${editorial}`).replace('<title>值得读 · News Feed</title>', `<title>${escape(report.title)}</title>`)
    .replace('译文、摘要与阅读筛选由模型生成', '译文与摘要由配置的模型生成；精选、变化判断与报告由调用方 Agent 编写')
  const target = path.resolve(output)
  const protectedFiles = [snapshotFile, decisionFile, path.join(path.dirname(snapshotFile), 'reading-pack.json')].map(p => path.resolve(p))
  if (protectedFiles.includes(target)) throw new Error('Output must not overwrite input evidence or decisions')
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, html, { flag: 'wx', mode: 0o600 })
  return { output: target, snapshotId: snapshot.snapshotId, count: snapshot.items.length + snapshot.blogs.length, blogs: snapshot.blogs.length, selected: picks.size, email }
}
