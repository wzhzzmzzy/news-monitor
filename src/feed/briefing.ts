import fs from 'node:fs/promises'
import path from 'node:path'
import { hostname } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { loadConfig } from '../core/config.js'
import { queryNews, editionRange, shanghaiDay, loadNews, loadSnapshotEvidence, hashBytes, type NewsList } from './news.js'
import { renderAgentReport, validateAgentReport, type AgentReport } from './agent-report.js'
import { makeReaderReport } from './reader-data.js'
import { publishReader } from './koalablog.js'
import { koalaHttp } from './koala-http.js'
import { writeJson } from './store.js'

const targetSchema = z.discriminatedUnion('type', [
  z.object({ key: z.string().regex(/^[a-z0-9-]+$/), type: z.literal('group'), name: z.string().min(1), id: z.string().regex(/^\d+$/).optional() }),
  z.object({ key: z.string().regex(/^[a-z0-9-]+$/), type: z.literal('user'), mis: z.string().min(1), id: z.string().regex(/^\d+$/) }),
])
export const deliverySchema = z.object({
  version: z.literal('briefing-delivery-v1'),
  koalablog: z.object({ url: z.string().url(), tokenEnv: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/) }),
  km: z.object({ parentId: z.string().regex(/^\d+$/), mis: z.string().min(1), cli: z.string().min(1).default('oa-skills') }),
  notifications: z.object({ cli: z.string().min(1).default('catdesk'), ledgerDir: z.string().min(1), targets: z.array(targetSchema) }),
}).superRefine((v, ctx) => {
  const keys = v.notifications.targets.map(t => t.key)
  const recipients = v.notifications.targets.map(t => t.type === 'user' ? `user:${t.id}` : `group:${t.id || t.name}`)
  if (new Set(keys).size !== keys.length || new Set(recipients).size !== recipients.length) ctx.addIssue({ code: 'custom', message: 'Notification keys and recipients must be unique' })
})
export type Delivery = z.infer<typeof deliverySchema>
type Step = { status: 'running' | 'done' | 'failed' | 'unknown'; startedAt: string; finishedAt?: string; error?: string; receipt?: any }
type State = { version: 'briefing-state-v1'; day: string; edition: 'morning' | 'evening'; window: { start: string; end: string }; steps: Record<string, Step>; sourceHash?: string; inputHash?: string; deliveryHash?: string; complete: boolean }
const now = () => new Date().toISOString()
async function readState(dir: string): Promise<State> {
  const state = JSON.parse(await fs.readFile(path.join(dir, 'state.json'), 'utf8'))
  if (state.version !== 'briefing-state-v1') throw new Error('Unsupported briefing state')
  return state
}
async function exists(file: string) { try { await fs.access(file); return true } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e } }

export async function withBriefingLock<T>(dir: string, task: () => Promise<T>): Promise<T> {
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, '.briefing.lock')
  let handle
  try { handle = await fs.open(file, 'wx', 0o600) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Briefing is locked; inspect .briefing.lock and its host/PID before recovery'); throw e }
  await handle.writeFile(JSON.stringify({ host: hostname(), pid: process.pid, startedAt: now() }))
  try { return await task() } finally { await handle.close(); await fs.unlink(file) }
}
function settled(snapshot: NewsList) {
  if (snapshot.window.basis !== 'publishedAt' || !snapshot.items.length) throw new Error('A briefing requires nonempty news with a publication window')
  if (!snapshot.publicationFilter || !snapshot.blogPublicationFilter) throw new Error('Regenerate a snapshot with both publication filters')
  if ([...snapshot.items, ...snapshot.blogs].some(i => !['ready', 'failed'].includes(i.languageStatus))) throw new Error('Wait for all summaries to finish before editing')
}
export async function prepareBriefing(directory: string, options: { config?: string; day?: string; edition?: string; baseline?: string; snapshot?: string }) {
  const dir = path.resolve(directory)
  return withBriefingLock(dir, async () => {
    const saved = await exists(path.join(dir, 'state.json')) ? await readState(dir) : undefined
    const edition = options.edition || saved?.edition || 'morning'
    const day = options.day || saved?.day || shanghaiDay()
    const range = editionRange(edition, day)
    if (saved && (saved.day !== day || saved.edition !== edition)) throw new Error('Directory already belongs to another report')
    const state: State = saved || { version: 'briefing-state-v1', day, edition: edition as State['edition'], window: { start: range.start.toISOString(), end: range.end.toISOString() }, steps: {}, complete: false }
    const persist = () => writeJson(path.join(dir, 'state.json'), state)
    if (state.steps.snapshot?.status === 'done') {
      const bytes = await fs.readFile(path.join(dir, 'news.json'), 'utf8')
      if (hashBytes(bytes) !== state.sourceHash) throw new Error('Frozen snapshot was modified')
      await loadSnapshotEvidence(await loadNews(path.join(dir, 'news.json')), path.join(dir, 'news.json'))
      return { ...state, next: 'Write editorial.json, then run briefing deliver' }
    }
    if (state.steps.snapshot && !options.snapshot) throw new Error('Interrupted preparation: inspect archived snapshots and adopt one using --snapshot; do not repeat collection blindly')
    if (!options.snapshot && !options.config) throw new Error('prepare requires a feed --config or an existing --snapshot')
    if (!options.snapshot && day !== shanghaiDay()) throw new Error('Historical recovery requires an existing --snapshot')
    if (!options.snapshot && +range.end > Date.now()) throw new Error('Formal briefing cutoff has not arrived; run after 10:00/20:00')
    state.steps.snapshot = { status: 'running', startedAt: now() }; await persist()
    try {
      const snapshot = options.snapshot ? await loadNews(options.snapshot) : await queryNews(await loadConfig(options.config!), { ...range, edition: state.edition, refresh: true, baseline: options.baseline })
      settled(snapshot)
      if (snapshot.edition !== state.edition || Date.parse(snapshot.window.start) !== +range.start || Date.parse(snapshot.window.end) !== +range.end) throw new Error('Snapshot does not match this report date and edition')
      const source = options.snapshot || snapshot.snapshotPath
      await loadSnapshotEvidence(snapshot, source)
      await fs.copyFile(path.join(path.dirname(source), 'reading-pack.json'), path.join(dir, 'reading-pack.json'))
      const bytes = await fs.readFile(source, 'utf8')
      await fs.writeFile(path.join(dir, 'news.json'), bytes, { mode: 0o600 })
      state.sourceHash = hashBytes(bytes)
      state.steps.snapshot = { ...state.steps.snapshot, status: 'done', finishedAt: now(), receipt: { snapshotId: snapshot.snapshotId, snapshotPath: source, news: snapshot.items.length, blogs: snapshot.blogs.length, status: snapshot.status, coverage: snapshot.coverage, observedThrough: snapshot.observedThrough } }
      await persist()
      return { ...state, next: 'Write editorial.json, then run briefing deliver' }
    } catch (e) {
      state.steps.snapshot = { ...state.steps.snapshot, status: 'failed', finishedAt: now(), error: 'Preparation failed; preserve archive and inspect before adopting a snapshot' }; await persist(); throw e
    }
  })
}

const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export function kmXml(title: string, html: string) { return `<km-doc><km-title>${escape(title)}</km-title><km-html><![CDATA[${html.replace(/]]>/g, ']]]]><![CDATA[>')}]]></km-html></km-doc>` }
export function embeddedHtml(xml: string) {
  const blocks = [...xml.matchAll(/<km-html\b[^>]*>([\s\S]*?)<\/km-html>/g)]
  if (blocks.length !== 1) throw new Error('Expected one complete KM HTML block; preserve remote content')
  const raw = blocks[0][1]
  if (!/^<!\[CDATA\[[\s\S]*\]\]>$/.test(raw)) throw new Error('Expected KM HTML CDATA')
  return raw.slice(9, -3).replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>')
}
export function cliJson(text: string): any {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    for (let end = text.length; end > i; end--) {
      if (text[end - 1] !== '}') continue
      try { return JSON.parse(text.slice(i, end)) } catch { /* CLI banners may surround JSON. */ }
    }
  }
  throw new Error('CLI did not return structured JSON')
}
const executeFile = promisify(execFile)
export type RunCli = (bin: string, args: string[]) => Promise<string>
const runCli: RunCli = async (bin, args) => {
  try { const { stdout } = await executeFile(bin, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: process.env }); return stdout }
  catch { throw new Error(`External CLI ${path.basename(bin)} failed or timed out; inspect authentication/connection and reconcile remote state`) }
}

export async function publishKm(dir: string, delivery: Delivery, title: string, html: string, previousId: string | undefined, saveId: (id: string) => Promise<void>, run: RunCli = runCli, allowCreate = true, beforeCreate: () => Promise<void> = async () => {}) {
  const call = (...args: string[]) => run(delivery.km.cli, ['citadel', ...args, '--mis', delivery.km.mis])
  const children = cliJson(await call('getChildContent', '--contentId', delivery.km.parentId))
  if (String(children.parentId) !== delivery.km.parentId || !Array.isArray(children.children)) throw new Error('KM child listing could not be verified')
  const matches = children.children.filter((c: any) => c.title === title)
  if (matches.length > 1) throw new Error('Multiple same-title KM documents; resolve conflict before delivery')
  if (previousId && (!matches.length || String(matches[0].contentId) !== previousId)) throw new Error('Saved KM document differs from parent listing')
  let id = previousId || (matches[0] && String(matches[0].contentId))
  if (!id) {
    if (!allowCreate) throw new Error('KM creation was attempted but no matching child is visible; reconcile before creating again')
    const file = path.join(dir, 'km-create.xml')
    if (Buffer.byteLength(html) > 2 * 1024 * 1024) throw new Error('KM HTML exceeds 2 MiB; use Citadel attachment fallback before notification')
    await fs.writeFile(file, kmXml(title, html), { mode: 0o600 })
    await beforeCreate()
    const result = await call('createDocument', '--title', title, '--file', file, '--parentId', delivery.km.parentId)
    id = result.match(/(?:文档ID[：:]\s*|collabpage\/)(\d+)/)?.[1]
    if (!id) { try { id = String(cliJson(result).contentId || '') } catch { /* Unknown creation result is reconciled via children on resume. */ } }
    if (!id || !/^\d+$/.test(id)) throw new Error('KM creation outcome unknown; reconcile parent listing before retry')
  }
  await saveId(id)
  const metadata = cliJson(await call('getDocumentMetaInfo', '--contentId', id))
  if (String(metadata.parentId) !== delivery.km.parentId || metadata.title !== title || metadata.deleted) throw new Error('KM parent/title verification failed')
  const readback = path.join(dir, 'km-readback.xml')
  await fs.rm(readback, { force: true })
  await call('getDocumentXml', '--contentId', id, '--output', readback)
  if (embeddedHtml(await fs.readFile(readback, 'utf8')) !== html) throw new Error('KM content differs; preserve it and resolve conflict')
  return { contentId: id, url: `https://km.sankuai.com/collabpage/${id}`, parentId: delivery.km.parentId, htmlSha256: hashBytes(html), verifiedAt: now(), permissionPolicy: 'inherit-parent' }
}
export async function resolveRecipient(delivery: Delivery, target: Delivery['notifications']['targets'][number], run: RunCli = runCli) {
  const result = cliJson(await run(delivery.notifications.cli, ['daxiang', 'search', '--keyword', target.type === 'group' ? target.name : target.mis, '--type', target.type]))
  if (result.success !== true || !Array.isArray(result.data?.results)) throw new Error('Recipient search failed')
  const matches = result.data.results.filter((r: any) => r.type === target.type && (target.type === 'group' ? r.name === target.name : r.mis === target.mis))
  if (matches.length !== 1) throw new Error('Recipient is missing or ambiguous')
  const found = matches[0]
  if (target.type === 'user') {
    if (String(found.id) !== target.id) throw new Error('Recipient MIS and UID mismatch')
    return ['--user-id', target.id]
  }
  if (target.id && String(found.id) !== target.id) throw new Error('Group ID mismatch')
  if (/^\d+$/.test(String(found.id))) return ['--group-id', String(found.id)]
  if (found.id === 'unknown' && !target.id && result.data.results.length === 1) return ['--group', target.name]
  throw new Error('Group identity could not be verified')
}

export type DeliveryAdapters = {
  render: typeof renderAgentReport;
  koalablog: (snapshot: NewsList, report: AgentReport, delivery: Delivery) => Promise<any>;
  km: typeof publishKm;
  run: RunCli;
}
const defaults: DeliveryAdapters = {
  render: renderAgentReport,
  koalablog: (snapshot, report, delivery) => publishReader(snapshot, report, { ...delivery.koalablog, dataOnly: true }, koalaHttp()),
  km: publishKm, run: runCli,
}
// All dependencies that perform external writes are isolated for failure/recovery tests.
export async function deliverBriefing(directory: string, configFile?: string, adapters: Partial<DeliveryAdapters> = {}) {
  if (!configFile) throw new Error('deliver requires a delivery --config JSON file')
  const delivery = deliverySchema.parse(JSON.parse(await fs.readFile(configFile, 'utf8')))
  const dir = path.resolve(directory), deps = { ...defaults, ...adapters }
  return withBriefingLock(dir, async () => {
    const state = await readState(dir)
    if (state.steps.snapshot?.status !== 'done') throw new Error('Run briefing prepare before delivery')
    const snapshotFile = path.join(dir, 'news.json'), decisionFile = path.join(dir, 'editorial.json')
    const snapshotBytes = await fs.readFile(snapshotFile, 'utf8')
    if (hashBytes(snapshotBytes) !== state.sourceHash) throw new Error('Frozen snapshot was modified')
    const snapshot = await loadNews(snapshotFile); settled(snapshot)
    if (snapshot.edition !== state.edition || snapshot.window.start !== state.window.start || snapshot.window.end !== state.window.end) throw new Error('Snapshot identity differs from state')
    await loadSnapshotEvidence(snapshot, snapshotFile)
    const decisions = await fs.readFile(decisionFile, 'utf8')
    const report = validateAgentReport(JSON.parse(decisions), snapshot)
    const dateTitle = `${Number(state.day.slice(0, 4))} 年 ${Number(state.day.slice(5, 7))} 月 ${Number(state.day.slice(8, 10))} 日`
    if (report.title !== `${dateTitle}${state.edition === 'morning' ? '早报' : '增量晚报'}`) throw new Error('Editorial title does not match this report date and edition')
    const inputHash = hashBytes(JSON.stringify([snapshotBytes, snapshot.evidenceSha256, decisions]))
    const deliveryHash = hashBytes(JSON.stringify(delivery))
    if (state.inputHash && state.inputHash !== inputHash) throw new Error('Frozen editorial decisions changed; preserve existing delivery')
    if (state.deliveryHash && state.deliveryHash !== deliveryHash) throw new Error('Delivery targets changed; preserve existing delivery')
    state.inputHash = inputHash; state.deliveryHash = deliveryHash; state.complete = false
    const persist = () => writeJson(path.join(dir, 'state.json'), state)
    await persist()
    const stage = async (key: string, work: () => Promise<any>, irreversible = false) => {
      const previous = state.steps[key]
      if (previous?.status === 'done') return previous.receipt
      if (irreversible && ['running', 'unknown'].includes(previous?.status || '')) {
        state.steps[key] = { ...previous, status: 'unknown' } as Step; await persist(); return undefined
      }
      state.steps[key] = { status: 'running', startedAt: now(), ...(previous?.receipt ? { receipt: previous.receipt } : {}) }; await persist()
      try {
        const receipt = await work()
        state.steps[key] = { ...state.steps[key], status: 'done', finishedAt: now(), receipt }; await persist(); return receipt
      } catch (e) {
        state.steps[key] = { ...state.steps[key], status: irreversible ? 'unknown' : 'failed', finishedAt: now(), error: e instanceof Error ? e.message : 'Stage failed' }; await persist(); return undefined
      }
    }
    const { latest } = makeReaderReport(snapshot, report)
    const local = await stage('local', async () => {
      const receipt = await deps.render(snapshotFile, decisionFile, path.join(dir, 'report.html'))
      const html = await fs.readFile(path.join(dir, 'report.html'), 'utf8')
      const file = path.join(dir, 'km.html')
      try { await fs.writeFile(file, html, { flag: 'wx', mode: 0o600 }) }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || await fs.readFile(file, 'utf8') !== html) throw e }
      return { ...receipt, htmlSha256: hashBytes(await fs.readFile(path.join(dir, 'report.html'), 'utf8')), markdownSha256: hashBytes(await fs.readFile(path.join(dir, 'report.html.report.md'), 'utf8')), kmSha256: hashBytes(html), dataPath: latest.path }
    })
    if (local) {
      for (const [file, hash] of [['report.html', local.htmlSha256], ['report.html.report.md', local.markdownSha256], ['km.html', local.kmSha256]]) {
        if (hashBytes(await fs.readFile(path.join(dir, file), 'utf8')) !== hash) throw new Error(`Frozen local artifact changed: ${file}`)
      }
      await stage('koalablog', async () => {
        const receipt = await deps.koalablog(snapshot, report, delivery)
        if (!(receipt.readerAvailable === true || receipt.artifactStatus === 'deployed') || receipt.deploymentRequired !== false) throw new Error('Reader is not deployed')
        await writeJson(path.join(dir, 'koalablog.json'), receipt)
        return receipt
      })
      const km = await stage('km', async () => deps.km(dir, delivery, report.title, await fs.readFile(path.join(dir, 'km.html'), 'utf8'), state.steps.km?.receipt?.contentId, async id => {
        state.steps.km.receipt = { contentId: id }; await persist()
      }, deps.run, !state.steps.km?.receipt?.creationAttempted, async () => {
        state.steps.km.receipt = { creationAttempted: true }; await persist()
      }))
      if (km && state.steps.koalablog?.status === 'done') {
        const message = `今天的草台新闻推送来了： ${km.url}`
        for (const target of delivery.notifications.targets) {
          const key = `notify-${target.key}`
          if (state.steps[key]?.status === 'done') continue
          const ledger = path.resolve(delivery.notifications.ledgerDir, state.day, `${target.key}.json`)
          if (await exists(ledger)) {
            const old = JSON.parse(await fs.readFile(ledger, 'utf8'))
            if (old.reportDate !== state.day || JSON.stringify(old.target) !== JSON.stringify(target)) throw new Error('Notification ledger recipient conflict')
            state.steps[key] = { status: old.status === 'sent' ? 'done' : 'unknown', startedAt: old.preparedAt, receipt: old, ...(old.status === 'sent' ? {} : { error: 'Inspect chat history; delivery outcome is unknown' }) }; await persist(); continue
          }
          if (['unknown', 'running'].includes(state.steps[key]?.status || '')) {
            state.steps[key].status = 'unknown'; await persist(); continue
          }
          // Search is read-only; a failed search can safely retry without a sending marker.
          let recipient: string[]
          try { recipient = await resolveRecipient(delivery, target, deps.run) }
          catch (e) { state.steps[key] = { status: 'failed', startedAt: now(), error: e instanceof Error ? e.message : 'Recipient lookup failed' }; await persist(); continue }
          await stage(key, async () => {
            const pending = { reportDate: state.day, contentId: km.contentId, target, message, linkTitle: dateTitle, preparedAt: now(), status: 'sending' }
            await fs.mkdir(path.dirname(ledger), { recursive: true })
            await fs.writeFile(ledger, JSON.stringify(pending, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
            const receipt = cliJson(await deps.run(delivery.notifications.cli, ['daxiang', 'send', ...recipient, '--message', message, '--link-title', dateTitle]))
            if (receipt.success !== true || receipt.data?.success !== true) throw new Error('Notification outcome is not confirmed; inspect chat history before retry')
            const sent = { ...pending, status: 'sent', sentAt: now(), receipt }
            await writeJson(ledger, sent)
            return sent
          }, true)
        }
      }
    }
    const required = ['snapshot', 'local', 'koalablog', 'km', ...delivery.notifications.targets.map(t => `notify-${t.key}`)]
    state.complete = required.every(k => state.steps[k]?.status === 'done'); await persist()
    await fs.writeFile(path.join(dir, 'STATUS.md'), `# ${report.title}\n\n${state.complete ? '全部完成' : '部分完成，续跑只处理剩余阶段'}\n\n${required.map(k => `- ${k}: ${state.steps[k]?.status || 'pending'}${state.steps[k]?.error ? ` — ${state.steps[k].error}` : ''}`).join('\n')}\n`, { mode: 0o600 })
    return state
  })
}
export async function briefingStatus(directory: string) { return readState(path.resolve(directory)) }

export async function unlockBriefing(directory: string) {
  const dir = path.resolve(directory), file = path.join(dir, '.briefing.lock')
  const bytes = await fs.readFile(file, 'utf8')
  const lock = z.object({ host: z.string(), pid: z.number().int().positive().max(2147483647), startedAt: z.string() }).parse(JSON.parse(bytes))
  if (lock.host !== hostname()) throw new Error('Only the original host can recover this lock')
  try { process.kill(lock.pid, 0); throw new Error('Owner process is still alive; wait for it to finish') }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e }
  if (await fs.readFile(file, 'utf8') !== bytes) throw new Error('Lock owner changed; inspect before retrying')
  await writeJson(path.join(dir, 'lock-recovery.json'), { lock, recoveredAt: now() })
  await fs.unlink(file)
  return { unlocked: true, complete: false, next: 'Inspect state and adopt the existing snapshot or resume delivery' }
}

export async function reconcileNotification(directory: string, configFile?: string, targetKey?: string, proofFile?: string) {
  if (!configFile || !targetKey || !proofFile) throw new Error('reconcile-notification requires --config, --target and --proof')
  const delivery = deliverySchema.parse(JSON.parse(await fs.readFile(configFile, 'utf8')))
  const proof = z.object({ reportDate: z.string(), targetKey: z.string(), contentId: z.string(), outcome: z.enum(['sent', 'not-sent']), checkedAt: z.string().datetime({ offset: true }), checkedBy: z.string().min(1), evidence: z.string().min(1) }).parse(JSON.parse(await fs.readFile(proofFile, 'utf8')))
  const dir = path.resolve(directory)
  return withBriefingLock(dir, async () => {
    const state = await readState(dir), key = `notify-${targetKey}`
    const target = delivery.notifications.targets.find(t => t.key === targetKey)
    if (!target || state.deliveryHash !== hashBytes(JSON.stringify(delivery))) throw new Error('Reconciliation delivery configuration differs')
    if (!['running', 'unknown'].includes(state.steps[key]?.status || '')) throw new Error('Only an uncertain notification can be reconciled')
    if (proof.reportDate !== state.day || proof.targetKey !== targetKey || proof.contentId !== state.steps.km?.receipt?.contentId) throw new Error('Proof belongs to another report or recipient')
    const ledger = path.resolve(delivery.notifications.ledgerDir, state.day, `${targetKey}.json`)
    const old = await exists(ledger) ? JSON.parse(await fs.readFile(ledger, 'utf8')) : undefined
    if (old && (old.reportDate !== state.day || JSON.stringify(old.target) !== JSON.stringify(target) || old.contentId !== proof.contentId)) throw new Error('Notification ledger identity mismatch')
    await writeJson(path.join(dir, `notification-proof-${hashBytes(JSON.stringify(proof))}.json`), { proof, previousStep: state.steps[key], previousLedger: old })
    if (proof.outcome === 'sent') {
      const receipt = { ...old, reportDate: state.day, target, contentId: proof.contentId, status: 'sent', proof, sentAt: proof.checkedAt }
      await writeJson(ledger, receipt)
      state.steps[key] = { ...state.steps[key], status: 'done', finishedAt: now(), receipt }
    } else {
      // A future sender must acquire the shared exclusive ledger before sending again.
      await fs.rm(ledger, { force: true })
      state.steps[key] = { ...state.steps[key], status: 'failed', error: 'Confirmed not sent; safe to retry using the same delivery' }
    }
    state.complete = false; await writeJson(path.join(dir, 'state.json'), state)
    return state
  })
}
