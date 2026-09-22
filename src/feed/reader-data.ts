import { z } from 'zod'
import { eventSchema } from './events.js'
import type { AgentReport } from './agent-report.js'
import type { NewsItem, NewsList } from './news.js'
import { shanghaiDay } from './news.js'

const time = z.string().datetime({ offset: true })
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const reportPath = z.string().regex(/^\/data\/news-feed\/\d{4}-\d{2}-\d{2}\/(morning|evening|custom-\d{6})$/)
const publicItem = z.object({ id: z.string(), title: z.string(), summary: z.string().nullable(), source: z.string(), url: z.string(), category: z.string(), publishedAt: time.nullable(), tier: z.enum(['picks', 'reading', 'other', 'blogs']) })
export const readerSchema = z.object({
  version: z.literal('news-feed-reader-v1'), title: z.string(), date, edition: z.enum(['morning', 'evening', 'custom']), cutoff: time,
  summary: z.string(), sections: z.array(z.object({ kind: z.string(), title: z.string(), body: z.string(), sources: z.array(z.object({ title: z.string(), url: z.string(), source: z.string(), before: z.boolean() })) })),
  items: z.array(publicItem), events: z.array(eventSchema).optional(),
})
export const latestSchema = z.object({ version: z.literal('news-feed-latest-v1'), path: reportPath, title: z.string(), date, edition: z.enum(['morning', 'evening', 'custom']), cutoff: time })
export type ReaderReport = z.infer<typeof readerSchema>
export type LatestReport = z.infer<typeof latestSchema>
export function safeUrl(value: string) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '' } catch { return '' }
}
export const dataMarkdown = (data: unknown) => '# News Feed data\n\n```json\n' + JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/`/g, '\\u0060') + '\n```\n'
export function parseData(content: string): unknown {
  const match = content.match(/(?:^|\n)```json\r?\n([\s\S]*?)\r?\n```(?:\r?\n|$)/)
  if (!match) throw new Error('Expected News Feed JSON data in Markdown')
  return JSON.parse(match[1])
}
export function makeReaderReport(snapshot: NewsList, report: AgentReport) {
  const day = shanghaiDay(new Date(snapshot.window.end))
  const picks = new Map(report.picks.map(p => [p.id, p]))
  const reading = new Set(report.readingIds)
  const byId = new Map(snapshot.items.map(i => [i.id, i]))
  const previous = new Map(snapshot.baseline?.items.map(i => [i.id, i]))
  const item = (i: NewsItem, tier: 'picks' | 'reading' | 'other' | 'blogs') => ({ id: i.id, title: i.title, summary: i.summary, source: i.source, url: safeUrl(i.url), category: picks.get(i.id)?.topic || i.category, publishedAt: i.publishedAt, tier })
  const citation = (i: NewsItem, before: boolean) => ({ title: i.title, source: i.source, url: safeUrl(i.url), before })
  const data = readerSchema.parse({ version: 'news-feed-reader-v1', title: report.title, date: day, edition: snapshot.edition, cutoff: snapshot.window.end, summary: report.summary,
    ...(report.events?.length ? { events: report.events } : {}),
    sections: report.sections.map(s => ({ kind: s.kind, title: s.title, body: s.body, sources: [...s.evidenceIds.map(id => citation(byId.get(id)!, false)), ...s.beforeIds.map(id => citation(previous.get(id)!, true))] })),
    items: [...report.picks.map(p => item(byId.get(p.id)!, 'picks')), ...snapshot.items.filter(i => !picks.has(i.id)).map(i => item(i, reading.has(i.id) ? 'reading' : 'other')), ...snapshot.blogs.map(i => item(i, 'blogs'))],
  })
  const suffix = snapshot.edition === 'custom' ? `custom-${new Date(Date.parse(snapshot.window.end) + 8 * 3600000).toISOString().slice(11, 19).replace(/:/g, '')}` : snapshot.edition
  const latest = latestSchema.parse({ version: 'news-feed-latest-v1', path: `/data/news-feed/${day}/${suffix}`, date: day, edition: data.edition, cutoff: data.cutoff, title: data.title })
  return { data, latest, content: dataMarkdown(data) }
}
