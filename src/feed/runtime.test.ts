import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { feedConfigSchema, type FeedConfig } from './config.js'
import { runFeed } from './pipeline.js'
import { localizeItems } from './localize.js'
import type { FeedItem } from './collect.js'
import { readEvidenceWindow, reportRange, runFeedReport, serialTasks, validateSchedule } from './runtime.js'

let dir: string
let config: FeedConfig
const start = new Date('2026-09-21T09:00:00Z')
const end = new Date('2026-09-21T12:00:00Z')
const item = (id: string, fetchedAt: string, content = `Body ${id}`): FeedItem => ({
  id, sourceId: 'rss', sourceName: 'RSS', category: '技术', title: `Title ${id}`,
  url: `https://example.com/${id}`, fetchedAt, publishedAt: '2026-09-20T00:00:00Z',
  content, contentKind: 'feed-content', raw: { id, content },
})
async function collectAt(time: string, ids: string[]) {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(time))
  try { return await runFeed(config, {}, async (_source, _config, now) => ids.map(id => item(id, now))) }
  finally { vi.useRealTimers() }
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'news-report-test-'))
  config = feedConfigSchema.parse({ archiveDir: dir, localization: { enabled: false }, sources: [{ id: 'rss', name: 'RSS', type: 'rss', url: 'https://example.com/feed' }] })
})
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await fs.rm(dir, { recursive: true, force: true }) })

describe('RSS/X reporting and scheduling', () => {
  it('includes evidence from every run in the observation window and deduplicates identities', async () => {
    await collectAt('2026-09-20T10:00:00Z', ['old'])
    await collectAt(start.toISOString(), ['a', 'b'])
    await collectAt('2026-09-21T10:00:00Z', ['a', 'c'])
    await collectAt(end.toISOString(), ['outside'])
    const evidence = await readEvidenceWindow(dir, start, end)
    expect(evidence.items.map(item => item.id).sort()).toEqual(['a', 'b', 'c'])
    expect(evidence.items.find(item => item.id === 'a')?.lastSeen).toBe('2026-09-21T10:00:00.000Z')
    expect(evidence.items.every(item => item.publishedAt === '2026-09-20T00:00:00Z')).toBe(true)
    const fetcher = vi.fn().mockRejectedValue(new Error('Reporting must read the archive'))
    vi.stubGlobal('fetch', fetcher)
    const deliver = vi.fn()
    const report = await runFeedReport(config, { start, end }, deliver)
    expect(report.count).toBe(3)
    expect(report.sent).toBe(false)
    expect(report.analyzed).toBe(false)
    expect(deliver).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    const html = await fs.readFile(report.preview, 'utf8')
    expect(html).toContain('Body b')
    expect(html).toContain('Body c')
    expect(html).not.toContain('Body outside')
    const pack = JSON.parse(await fs.readFile(path.join(path.dirname(report.preview), 'source-pack.json'), 'utf8'))
    expect(pack.window.basis).toBe('collectedAt')
    expect(pack.items).toHaveLength(3)
  })

  it('requires explicit sending and environment credentials before invoking the mail transport', async () => {
    await collectAt(start.toISOString(), ['a'])
    const deliver = vi.fn().mockResolvedValue(undefined)
    await expect(runFeedReport(config, { start, end, send: true }, deliver)).rejects.toThrow('Configure email')
    config.email = { emailFrom: 'sender@example.com', emailTo: ['reader@example.com'], emailFromName: 'News Feed', passwordEnv: 'NEWS_TEST_SMTP_PASS' }
    await expect(runFeedReport(config, { start, end, send: true }, deliver)).rejects.toThrow('NEWS_TEST_SMTP_PASS')
    expect(deliver).not.toHaveBeenCalled()
    vi.stubEnv('NEWS_TEST_SMTP_PASS', 'test-only')
    config.localization.enabled = true
    const report = await runFeedReport(config, { start, end, send: true }, deliver, (items, cfg) => localizeItems(items, cfg, async () => ({ titleZh: '新闻标题', summaryZh: '中文摘要。' })))
    expect(deliver).toHaveBeenCalledTimes(1)
    expect(deliver.mock.calls[0][0].smtpPass).toBe('test-only')
    expect(deliver.mock.calls[0][2]).toContain('Body a')
    expect(report.sent).toBe(true)
    expect(await fs.readFile(path.join(dir, 'latest-report.json'), 'utf8')).not.toContain('test-only')
  })

  it('does not generate a misleading empty report or silently ignore corrupt evidence', async () => {
    await expect(runFeedReport(config, { start, end })).rejects.toThrow('run monitor first')
    const run = await collectAt(start.toISOString(), ['a'])
    await fs.writeFile(path.join(run.runDir, 'source-pack.json'), '{broken')
    await expect(readEvidenceWindow(dir, start, end)).rejects.toThrow()
  })

  it('validates dates and bounded windows and preserves local calendar date semantics', () => {
    expect(reportRange({ hours: 2 }, end)).toEqual({ start: new Date('2026-09-21T10:00:00Z'), end })
    const day = reportRange({ date: '2026-09-21' })
    expect(day.start.getHours()).toBe(0)
    expect(day.start.getDate()).toBe(21)
    expect(day.end.getDate()).toBe(22)
    expect(reportRange({ start: start.toISOString(), end: end.toISOString() })).toEqual({ start, end })
    expect(() => reportRange({ date: '2026-02-31' })).toThrow('valid calendar date')
    expect(() => reportRange({ date: '2026-09-21', start: start.toISOString() })).toThrow('not both')
    expect(() => reportRange({ hours: 'nonsense' })).toThrow()
    expect(() => reportRange({ hours: 169 })).toThrow()
    expect(() => reportRange({ start: end.toISOString(), end: start.toISOString() })).toThrow()
  })

  it('validates scheduler settings before starting jobs', () => {
    expect(() => validateSchedule(config)).not.toThrow()
    expect(() => validateSchedule({ ...config, schedule: { ...config.schedule, report: '0 10 * * *' } })).toThrow('calling agent')
    expect(() => validateSchedule({ ...config, schedule: { ...config.schedule, collect: 'invalid' } })).toThrow()
    expect(() => validateSchedule({ ...config, schedule: { ...config.schedule, analyze: true } })).toThrow('calling agent')
    expect(() => validateSchedule({ ...config, schedule: { ...config.schedule, sendEmail: true } })).toThrow('calling agent')
  })

  it('serializes overlapping collection/report jobs and continues after a failed job', async () => {
    const queue = serialTasks()
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const collect = queue(async () => { order.push('collect'); await gate; order.push('collected') })
    const report = queue(async () => { order.push('report'); throw new Error('model failed') })
    const recovery = queue(async () => { order.push('next collect') })
    await Promise.resolve()
    expect(order).toEqual(['collect'])
    const rejection = expect(report).rejects.toThrow('model failed')
    release()
    await collect
    await rejection
    await recovery
    expect(order).toEqual(['collect', 'collected', 'report', 'next collect'])
  })
})
