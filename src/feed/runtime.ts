import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { CronTime } from 'cron'
import type { FeedConfig } from './config.js'
import type { SourceResult } from './collect.js'
import { FeedStore, writeJson, type StoredItem } from './store.js'
import { analyzeFeed, renderFeed } from './report.js'
import { NotifierService, type MailConfig } from '../services/notifier.js'
import { formatDate, parseDateTime } from '../utils/time.js'
import { localizeItems, localizationIncomplete } from './localize.js'
import { requireLlm } from './llm.js'
import { curateItems } from './curate.js'

// Collection and reporting share an archive lock. Queue scheduled work rather
// than losing the report whenever its cron overlaps a collection.
export function serialTasks() {
  let pending = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = pending.then(task)
    pending = result.then(() => undefined, () => undefined)
    return result
  }
}

export function reportRange(options: { hours?: number | string; date?: string; start?: string; end?: string }, now = new Date()) {
  const parse = (value: string) => parseDateTime(value) || new Date(value)
  let start: Date
  let end: Date
  if (options.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) throw new Error('Expected --date YYYY-MM-DD')
    if (options.start || options.end) throw new Error('Use --date or --start/--end, not both')
    start = new Date(`${options.date}T00:00:00`)
    if (formatDate(start) !== options.date) throw new Error('Expected a valid calendar date')
    end = new Date(start)
    end.setDate(end.getDate() + 1)
  } else {
    const hours = Number(options.hours ?? 24)
    if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('--hours must be between 1 and 168')
    end = options.end ? parse(options.end) : now
    start = options.start ? parse(options.start) : new Date(end.getTime() - hours * 3600000)
  }
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start || +end - +start > 168 * 3600000) {
    throw new Error('Expected a valid report window of at most 7 days')
  }
  return { start, end }
}

export function requireMailConfig(config: FeedConfig): MailConfig {
  if (!config.email) throw new Error('Configure email before using --send or test-email')
  const smtpPass = process.env[config.email.passwordEnv]
  if (!smtpPass) throw new Error(`Set ${config.email.passwordEnv} before sending email`)
  return { ...config.email, smtpPass }
}
export function validateSchedule(config: FeedConfig) {
  new CronTime(config.schedule.collect, config.schedule.timezone)
  new CronTime(config.schedule.report, config.schedule.timezone)
  if (config.localization.enabled || config.schedule.analyze) requireLlm(config.llm)
  if (config.schedule.sendEmail) requireMailConfig(config)
}

export async function readEvidenceWindow(directory: string, start?: Date, end?: Date) {
  let runs: string[]
  try { runs = await fs.readdir(path.join(directory, 'runs')) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { items: [], results: [] }; throw error }
  const items = new Map<string, StoredItem>()
  const results = new Map<string, SourceResult>()
  for (const run of runs.sort()) {
    const observed = Date.parse(run.slice(0, 10))
    // Avoid reading every historical payload; run names start with the UTC date.
    if ((start && observed + 86400000 < +start) || (end && observed > +end)) continue
    let content: string
    try { content = await fs.readFile(path.join(directory, 'runs', run, 'source-pack.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error }
    const pack = JSON.parse(content) as { version: number; collectedAt: string; items: StoredItem[]; results: SourceResult[] }
    if (pack.version !== 1 || !Array.isArray(pack.items) || !Array.isArray(pack.results) || !Number.isFinite(Date.parse(pack.collectedAt))) throw new Error(`Invalid source pack in run ${run}`)
    if ((start && Date.parse(pack.collectedAt) < +start) || (end && Date.parse(pack.collectedAt) >= +end)) continue
    for (const item of pack.items) items.set(item.id, item)
    for (const result of pack.results) results.set(result.sourceId, result)
  }
  return { items: [...items.values()], results: [...results.values()] }
}

export async function runFeedReport(config: FeedConfig, options: { start: Date; end: Date; all?: boolean; analyze?: boolean; send?: boolean },
  deliver = async (mail: MailConfig, subject: string, html: string) => new NotifierService(mail).sendReport(subject, html), localize = localizeItems, curate = curateItems) {
  const mail = options.send ? requireMailConfig(config) : undefined
  if (options.analyze) requireLlm(config.llm)
  return new FeedStore(config.archiveDir).withLock(async () => {
    const { items, results } = await readEvidenceWindow(config.archiveDir, options.all ? undefined : options.start, options.all ? undefined : options.end)
    if (!items.length) throw new Error('No RSS/X evidence in this observation window; run monitor first')
    const now = new Date().toISOString()
    const reportId = `${now.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    const directory = path.join(config.archiveDir, 'reports', reportId)
    const window = { start: options.all ? null : options.start.toISOString(), end: options.all ? null : options.end.toISOString(), basis: 'collectedAt', all: !!options.all }
    await writeJson(path.join(directory, 'source-pack.json'), { version: 1, window, results, items })
    const reading = await localize(items, config)
    await writeJson(path.join(directory, 'reading-pack.json'), reading)
    const label = options.all ? '全部已归档内容' : `${window.start} 至 ${window.end}（采集窗口）`
    const preview = path.join(directory, 'report.html')
    await fs.writeFile(preview, renderFeed(reading.items, results, label, undefined, reading.stats), { mode: 0o600 })
    const curation = await curate(reading.items, config)
    await writeJson(path.join(directory, 'editorial.json'), curation)
    const analysis = options.analyze ? await analyzeFeed(items, config.llm!) : undefined
    if (analysis) await writeJson(path.join(directory, 'analysis.json'), analysis)
    const html = renderFeed(reading.items, results, label, analysis?.digest, reading.stats, curation)
    await fs.writeFile(preview, html, { mode: 0o600 })
    const deliveryBlocked = !!mail && (localizationIncomplete(reading.stats) || ['pending', 'failed'].includes(curation.status))
    if (mail && !deliveryBlocked) await deliver(mail, `个人信息简报 · ${now.slice(0, 10)}`, renderFeed(reading.items, results, label, analysis?.digest, reading.stats, curation, { email: true }))
    const result = { reportId, preview, count: items.length, results, window, analyzed: !!analysis, localization: reading.stats, curation,
      sent: !!mail && !deliveryBlocked, ...(deliveryBlocked ? { deliveryError: '中文处理或阅读筛选尚未全部完成，邮件未发送；请查看处理状态后重试。' } : {}),
    }
    await writeJson(path.join(config.archiveDir, 'latest-report.json'), result)
    return result
  })
}
