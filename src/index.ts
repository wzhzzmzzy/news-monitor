import { cac } from 'cac'
import { CronJob } from 'cron'
import { Hono } from 'hono'
import { serve as honoServe } from '@hono/node-server'
import { loadConfig } from './core/config.js'
import { runFeed } from './feed/pipeline.js'
import { runFeedReport, requireMailConfig, reportRange, validateSchedule, serialTasks } from './feed/runtime.js'
import { NotifierService } from './services/notifier.js'
import { localizationIncomplete, type LocalizationStats } from './feed/localize.js'

const cli = cac('news-monitor')
const configOption = { default: 'config.example.yaml' }
const showError = (error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Task failed')
  process.exitCode = 1
}

for (const command of ['monitor', 'feed']) {
  cli.command(command, 'Collect RSS/Atom, RSSHub and X; create Chinese translations and per-item summaries')
    .option('-c, --config <file>', 'Configuration file', configOption)
    .option('--analyze', 'Also generate an optional topical digest during this collection')
    .action(async options => {
      try {
        const result = await runFeed(await loadConfig(options.config), { analyze: options.analyze })
        console.log(JSON.stringify(result, null, 2))
        if (result.results.some(source => source.status === 'failed') || localizationIncomplete(result.localization) || ['pending', 'failed'].includes(result.curation.status)) process.exitCode = 1
      } catch (error) { showError(error) }
    })
}

cli.command('report', 'Build a report from archived RSS/X evidence without fetching sources')
  .option('-c, --config <file>', 'Configuration file', configOption)
  .option('--hours <number>', 'Observation window in hours (1–168)', { default: 24 })
  .option('--date <date>', 'Local calendar date YYYY-MM-DD')
  .option('--all', 'Translate and summarize all archived items, ignoring the default 24-hour window')
  .option('--start <time>', 'Start time (ISO or yy-MM-dd HH:mm)')
  .option('--end <time>', 'End time (ISO or yy-MM-dd HH:mm)')
  .option('--analyze', 'Also generate an optional topical digest from archived source bodies')
  .option('--send', 'Explicitly send the generated report by email')
  .action(async options => {
    try {
      if (options.all && (options.date || options.start || options.end)) throw new Error('Use --all or a date/time window, not both')
      const result = await runFeedReport(await loadConfig(options.config), {
        ...reportRange(options), all: options.all, analyze: options.analyze, send: options.send,
      })
      console.log(JSON.stringify(result, null, 2))
      if (localizationIncomplete(result.localization) || ['pending', 'failed'].includes(result.curation.status) || result.deliveryError) process.exitCode = 1
    } catch (error) { showError(error) }
  })

cli.command('serve', 'Schedule RSS/X collection and reports; status listens on localhost')
  .option('-c, --config <file>', 'Configuration file', configOption)
  .action(async options => {
    try {
      const config = await loadConfig(options.config)
      validateSchedule(config)
      const status: Record<string, unknown> = { monitor: 'idle', report: 'idle' }
      const queue = serialTasks()
      const active = new Set<string>()
      const execute = async (name: string, task: () => Promise<unknown>) => {
        if (active.has(name)) return
        active.add(name)
        status[name] = { state: 'queued' }
        await queue(async () => {
          status[name] = { state: 'running', startedAt: new Date().toISOString() }
          try {
            const result = await task()
            const outcome = result as { results: { status: string }[]; localization: LocalizationStats; curation: { status: string } }
            const partial = outcome.results.some(source => source.status === 'failed') || localizationIncomplete(outcome.localization) || ['pending', 'failed'].includes(outcome.curation.status)
            status[name] = { state: partial ? 'partial' : 'success', completedAt: new Date().toISOString(), result }
          } catch (error) {
            status[name] = { state: 'failed', completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Task failed' }
          } finally { active.delete(name) }
        })
      }
      const collectJob = new CronJob(config.schedule.collect, () => execute('monitor', () => runFeed(config)), null, false, config.schedule.timezone)
      const reportJob = new CronJob(config.schedule.report, () => execute('report', () => runFeedReport(config, {
        ...reportRange({ hours: 24 }), analyze: config.schedule.analyze, send: config.schedule.sendEmail,
      })), null, false, config.schedule.timezone)
      const app = new Hono()
      app.get('/', c => c.json({ status: 'up', mode: 'rss-x', tasks: status }))
      const server = honoServe({ fetch: app.fetch, hostname: '127.0.0.1', port: config.serverPort })
      server.on('error', error => { collectJob.stop(); reportJob.stop(); showError(error) })
      collectJob.start()
      reportJob.start()
      console.log(`RSS/X scheduler started; status: http://127.0.0.1:${config.serverPort}`)
      const stop = () => { collectJob.stop(); reportJob.stop(); server.close() }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    } catch (error) { showError(error) }
  })

cli.command('test-email', 'Explicitly send a test email using the optional email configuration')
  .option('-c, --config <file>', 'Configuration file', configOption)
  .action(async options => {
    try {
      const config = await loadConfig(options.config)
      await new NotifierService(requireMailConfig(config)).sendReport('News Feed 邮件测试', 'RSS/X 简报邮件服务测试。')
    } catch (error) { showError(error) }
  })

cli.help()
cli.on('command:*', () => { console.error('Unknown command'); process.exitCode = 1 })
cli.parse()
