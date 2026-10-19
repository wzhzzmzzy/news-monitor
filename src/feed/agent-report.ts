import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { loadNews, loadSnapshotEvidence, type NewsList } from './news.js'
import { renderReaderHtml } from './reader-html.js'
import { publishReader, type KoalablogOptions } from './koalablog.js'
import { makeReaderReport, dataMarkdown } from './reader-data.js'
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
export async function renderAgentReport(snapshotFile: string, decisionFile: string, output: string, email = false, koalablog?: KoalablogOptions) {
  const snapshot = await loadNews(snapshotFile)
  const pack = await loadSnapshotEvidence(snapshot, snapshotFile)
  const report = validateAgentReport(JSON.parse(await fs.readFile(decisionFile, 'utf8')), snapshot)
  const { data, content, latest } = makeReaderReport(snapshot, report)
  const html = await renderReaderHtml(data, pack.items, email, pack.results)
  const target = path.resolve(output)
  const protectedFiles = [snapshotFile, decisionFile, path.join(path.dirname(snapshotFile), 'reading-pack.json')].map(p => path.resolve(p))
  if (protectedFiles.includes(target)) throw new Error('Output must not overwrite input evidence or decisions')
  await fs.mkdir(path.dirname(target), { recursive: true })
  try { await fs.writeFile(target, html, { flag: 'wx', mode: 0o600 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await fs.readFile(target, 'utf8') !== html) throw error
  }
  for (const [file, value] of [[`${target}.report.md`, content], [`${target}.latest-candidate.md`, dataMarkdown(latest)]]) {
    try { await fs.writeFile(file, value, { flag: 'wx', mode: 0o600 }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await fs.readFile(file, 'utf8') !== value) throw error }
  }
  let publication
  if (koalablog) {
    await fs.copyFile(new URL('../../templates/news-feed.svelte', import.meta.url), `${target}.svelte`)
    publication = await publishReader(snapshot, report, koalablog)
    await writeJson(`${target}.koalablog.json`, publication)
  }
  return { output: target, snapshotId: snapshot.snapshotId, count: snapshot.items.length + snapshot.blogs.length, blogs: snapshot.blogs.length, selected: report.picks.length, email, ...(publication ? { publication } : {}) }
}
