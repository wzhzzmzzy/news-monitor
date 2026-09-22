import { cac } from 'cac'
import { CronJob } from 'cron'
import { Hono } from 'hono'
import { serve as honoServe } from '@hono/node-server'
import { loadConfig } from './core/config.js'
import { runFeed } from './feed/pipeline.js'
import { runFeedReport, requireMailConfig, reportRange, validateSchedule, serialTasks } from './feed/runtime.js'
import { NotifierService } from './services/notifier.js'
import { queryNews, editionRange, shanghaiDay } from './feed/news.js'
import { renderAgentReport } from './feed/agent-report.js'
import { localizationIncomplete, type LocalizationStats } from './feed/localize.js'

const cli = cac('news-monitor')
const configOption = { default: 'config.example.yaml' }
const showError = (error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Task failed')
  process.exitCode = 1
}

for (const command of ['collect', 'monitor', 'feed']) {
  cli.command(command, 'Collect RSS/Atom, RSSHub and X; create Chinese translations and per-item summaries')
    .option('-c, --config <file>', 'Configuration file', configOption)
    .option('--channel <name>', 'Collect news or blogs only; default both')
    .action(async options => {
      try {
        if (options.channel && !['news', 'blogs'].includes(options.channel)) throw new Error('--channel must be news or blogs')
        const result = await runFeed(await loadConfig(options.config), { channel: options.channel })
        console.log(JSON.stringify(result, null, 2))
        if (result.results.some(source => source.status === 'failed') || localizationIncomplete(result.localization)) process.exitCode = 1
      } catch (error) { showError(error) }
    })
}

cli.command('report', 'Compatibility: unranked archive preview; use news + Agent + render for edited reports')
  .option('-c, --config <file>', 'Configuration file', configOption)
  .option('--hours <number>', 'Observation window in hours (1–168)', { default: 24 })
  .option('--date <date>', 'Local calendar date YYYY-MM-DD')
  .option('--all', 'Translate and summarize all archived items, ignoring the default 24-hour window')
  .option('--start <time>', 'Start time (ISO or yy-MM-dd HH:mm)')
  .option('--end <time>', 'End time (ISO or yy-MM-dd HH:mm)')
  .option('--send', 'Explicitly send the generated report by email')
  .action(async options => {
    try {
      if (options.all && (options.date || options.start || options.end)) throw new Error('Use --all or a date/time window, not both')
      const result = await runFeedReport(await loadConfig(options.config), {
        ...reportRange(options), all: options.all, send: options.send,
      })
      console.log(JSON.stringify(result, null, 2))
      if (localizationIncomplete(result.localization) || result.deliveryError) process.exitCode = 1
    } catch (error) { showError(error) }
  })

cli.command('news', 'Return a frozen JSON news list for an external agent; never ranks or writes prose')
  .option('-c, --config <file>', 'Configuration file', configOption)
  .option('--hours <number>', 'Custom observation window in hours', { default: 24 })
  .option('--start <time>', 'Custom window start (ISO with timezone)')
  .option('--end <time>', 'Custom window end (ISO with timezone)')
  .option('--edition <name>', 'morning (24h to 10:00) or evening (10:00–20:00), Asia/Shanghai')
  .option('--day <date>', 'Edition date YYYY-MM-DD, default today in Asia/Shanghai')
  .option('--baseline <file>', 'Frozen morning news.json; required for evening')
  .option('--refresh', 'Collect news and blogs once before today’s edition; end at collection completion')
  .action(async options => {
    try {
      if (options.edition && (options.start || options.end)) throw new Error('Use --edition/--day or --start/--end')
      if (options.day && !options.edition) throw new Error('--day requires --edition')
      const range = options.edition ? editionRange(options.edition, options.day || shanghaiDay()) : reportRange(options)
      const result = await queryNews(await loadConfig(options.config), { ...range, edition: options.edition, baseline: options.baseline, refresh: options.refresh })
      console.log(JSON.stringify(result, null, 2))
      if (result.status !== 'ready') process.exitCode = 1
    } catch (error) { showError(error) }
  })

cli.command('render', 'Render externally authored decisions; no model calls, fetching or delivery')
  .option('--snapshot <file>', 'Frozen news.json')
  .option('--decisions <file>', 'Agent-authored agent-report-v1 JSON')
  .option('--output <file>', 'New HTML file; existing files are never overwritten')
  .option('--email', 'Generate an email-compatible HTML artifact without sending')
  .action(async options => {
    try {
      if (!options.snapshot || !options.decisions || !options.output) throw new Error('render requires --snapshot, --decisions and --output')
      console.log(JSON.stringify(await renderAgentReport(options.snapshot, options.decisions, options.output, options.email), null, 2))
    } catch (error) { showError(error) }
  })

cli.command('serve', 'Schedule collection and Chinese processing only; external agents schedule reports')
  .option('-c, --config <file>', 'Configuration file', configOption)
  .action(async options => {
    try {
      const config = await loadConfig(options.config)
      validateSchedule(config)
      const status: Record<string, unknown> = { monitor: 'idle' }
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
            const outcome = result as { results: { status: string }[]; localization: LocalizationStats }
            const partial = outcome.results.some(source => source.status === 'failed') || localizationIncomplete(outcome.localization)
            status[name] = { state: partial ? 'partial' : 'success', completedAt: new Date().toISOString(), result }
          } catch (error) {
            status[name] = { state: 'failed', completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : 'Task failed' }
          } finally { active.delete(name) }
        })
      }
      const collectJob = new CronJob(config.schedule.collect, () => execute('monitor', () => runFeed(config)), null, false, config.schedule.timezone)
      const app = new Hono()
      app.get('/', c => c.json({ status: 'up', mode: 'rss-x', tasks: status }))
      const server = honoServe({ fetch: app.fetch, hostname: '127.0.0.1', port: config.serverPort })
      server.on('error', error => { collectJob.stop(); showError(error) })
      collectJob.start()
      console.log(`RSS/X scheduler started; status: http://127.0.0.1:${config.serverPort}`)
      const stop = () => { collectJob.stop(); server.close() }
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
