import { cac } from 'cac'
import { CronJob } from 'cron'
import { Hono } from 'hono'
import { serve as honoServe } from '@hono/node-server'
import { loadConfig } from './core/config.js'
import { StorageService } from './services/storage.js'
import { CrawlerService } from './services/crawler.js'
import { Monitor } from './core/monitor.js'
import { AnalyzerService } from './services/analyzer.js'
import { NotifierService } from './services/notifier.js'
import { Reporter } from './core/reporter.js'
import logger from './utils/logger.js'

const cli = cac('trend-radar')

// Status tracking
interface TaskStatus {
  lastRun: Date | null
  lastStatus: 'idle' | 'running' | 'success' | 'failed'
  error: string | null
}

interface RuntimeStatus {
  monitor: TaskStatus
  report: TaskStatus
}

let status: RuntimeStatus = {
  monitor: { lastRun: null, lastStatus: 'idle', error: null },
  report: { lastRun: null, lastStatus: 'idle', error: null },
}

const RUNTIME_STATE_FILE = 'runtime.json'

async function saveStatus(storage: StorageService) {
  try {
    await storage.saveRootJson(RUNTIME_STATE_FILE, status)
  } catch (err) {
    logger.warn('Failed to save runtime status: ' + err)
  }
}

async function loadStatus(storage: StorageService) {
  try {
    const saved = await storage.loadRootJson<RuntimeStatus>(RUNTIME_STATE_FILE)
    if (saved) {
      if (saved.monitor?.lastRun) saved.monitor.lastRun = new Date(saved.monitor.lastRun)
      if (saved.report?.lastRun) saved.report.lastRun = new Date(saved.report.lastRun)
      status = saved
      logger.info('Restored runtime status from ' + RUNTIME_STATE_FILE)
    }
  } catch (err) {
    logger.warn('Failed to load runtime status: ' + err)
  }
}

async function runMonitor(configPath: string) {
  status.monitor.lastStatus = 'running'
  let storage: StorageService | undefined
  try {
    const config = loadConfig(configPath)
    storage = new StorageService(config.archiveDir)
    await saveStatus(storage)

    const crawler = new CrawlerService(config.newsApiBaseUrl)
    const analyzer = new AnalyzerService(config, storage)
    const notifier = new NotifierService(config)
    const reporter = new Reporter(storage, analyzer, notifier)
    const monitor = new Monitor(storage)

    logger.info('Starting monitoring task...')
    await monitor.run(config, {
      crawler,
      analyzer,
      reporter,
    })
    logger.success('Monitoring task completed successfully.')
    status.monitor.lastRun = new Date()
    status.monitor.lastStatus = 'success'
    status.monitor.error = null
    await saveStatus(storage)
  } catch (error) {
    logger.error(error as any, 'Monitoring task failed:')
    status.monitor.lastStatus = 'failed'
    status.monitor.error = error instanceof Error ? error.message : String(error)
    if (storage) await saveStatus(storage)
    throw error
  }
}

async function runReport(configPath: string, dateStr?: string, recipientIndex?: number) {
  status.report.lastStatus = 'running'
  let storage: StorageService | undefined
  try {
    const config = loadConfig(configPath)
    storage = new StorageService(config.archiveDir)
    await saveStatus(storage)

    const analyzer = new AnalyzerService(config, storage)
    const notifier = new NotifierService(config)
    const reporter = new Reporter(storage, analyzer, notifier)

    const date = dateStr ? new Date(dateStr) : new Date()
    logger.info(`Generating daily report for ${date.toISOString().split('T')[0]}...`)
    await reporter.runDailyReport(date, recipientIndex)
    logger.success('Reporting task completed successfully.')
    status.report.lastRun = new Date()
    status.report.lastStatus = 'success'
    status.report.error = null
    await saveStatus(storage)
  } catch (error) {
    logger.error(error as any, 'Reporting task failed:')
    status.report.lastStatus = 'failed'
    status.report.error = error instanceof Error ? error.message : String(error)
    if (storage) await saveStatus(storage)
    throw error
  }
}

cli
  .command('monitor', 'Fetch, index and analyze news items')
  .option('-c, --config <file>', 'Path to config file', { default: 'config.yaml' })
  .action(async (options) => {
    try {
      await runMonitor(options.config)
    } catch (error) {
      process.exit(1)
    }
  })

cli
  .command('report', 'Generate and send daily report')
  .option('-c, --config <file>', 'Path to config file', { default: 'config.yaml' })
  .option('--date <date>', 'Date to report on (YYYY-MM-DD)')
  .option('--id <index>', 'Recipient index in the config email list')
  .action(async (options) => {
    try {
      const recipientIndex = options.id !== undefined ? parseInt(options.id, 10) : undefined
      await runReport(options.config, options.date, recipientIndex)
    } catch (error) {
      process.exit(1)
    }
  })

cli
  .command('serve', 'Run as a daemon with scheduler and status server')
  .option('-c, --config <file>', 'Path to config file', { default: 'config.yaml' })
  .action(async (options) => {
    const config = loadConfig(options.config)
    logger.info('Starting TrendRadar daemon...')

    // Init storage and load status
    const storage = new StorageService(config.archiveDir)
    await loadStatus(storage)

    // Monitor
    const monitorJob = new CronJob(config.monitorCron, async () => {
      try {
        await runMonitor(options.config)
      } catch (err) {
        // Error already logged in runMonitor
      }
    })

    // Report
    const reportJob = new CronJob(config.reportCron, async () => {
      try {
        await runReport(options.config)
      } catch (err) {
        // Error already logged in runReport
      }
    })

    monitorJob.start()
    reportJob.start()

    logger.info(`Scheduler started: Monitor (${config.monitorCron}), Report (${config.reportCron})`)

    const app = new Hono()
    app.get('/', (c) => c.json({
      status: 'up',
      uptime: process.uptime(),
      tasks: status
    }))

    app.get('/run/:task', async (c) => {
      const task = c.req.param('task')
      const id = c.req.query('id')
      const recipientIndex = id !== undefined ? parseInt(id, 10) : undefined

      if (task === 'monitor') {
        runMonitor(options.config).catch(() => {})
        return c.json({ message: 'Monitor task triggered' })
      }
      if (task === 'report') {
        runReport(options.config, undefined, recipientIndex).catch(() => {})
        return c.json({ message: 'Report task triggered' })
      }
      return c.json({ error: 'Unknown task' }, 400)
    })

    honoServe({ fetch: app.fetch, port: config.serverPort }, (info) => {
      logger.info(`Status server running at http://localhost:${info.port}`)
    })
  })

cli
  .command('test-email', 'Send a test email to verify SMTP configuration')
  .option('-c, --config <file>', 'Path to config file', { default: 'config.yaml' })
  .action(async (options) => {
    try {
      const config = loadConfig(options.config)
      const notifier = new NotifierService(config)
      await notifier.sendReport('TrendRadar SMTP Test', 'This is a test email from TrendRadar.')
      logger.success('Test email sent.')
    } catch (error) {
      logger.error(error as any, 'Email test failed:')
      process.exit(1)
    }
  })

cli.help()

cli.on('command:*', () => {
  logger.error('Invalid command: %s', cli.args.join(' '))
  process.exit(1)
})

cli.parse()