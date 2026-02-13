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
import { createTimeRange, formatDate } from './utils/time.js'

const cli = cac('trend-analyzer')

// Status tracking
interface TaskStatus {
  lastRun: Date | null
  lastStatus: 'idle' | 'running' | 'success' | 'failed'
  error: string | null
}

interface RuntimeStatus {
  monitor: TaskStatus
  dailyReport: TaskStatus
  historicalReport: TaskStatus
}

let status: RuntimeStatus = {
  monitor: { lastRun: null, lastStatus: 'idle', error: null },
  dailyReport: { lastRun: null, lastStatus: 'idle', error: null },
  historicalReport: { lastRun: null, lastStatus: 'idle', error: null },
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
    const saved = await storage.loadRootJson<any>(RUNTIME_STATE_FILE)
    if (saved) {
      // Safely restore monitor status
      if (saved.monitor) {
        status.monitor = { ...status.monitor, ...saved.monitor }
        if (status.monitor.lastRun) status.monitor.lastRun = new Date(status.monitor.lastRun)
      }
      
      // Restore daily report status (with migration from legacy 'report' key)
      const dailySource = saved.dailyReport || saved.report
      if (dailySource) {
        status.dailyReport = { ...status.dailyReport, ...dailySource }
        if (status.dailyReport.lastRun) status.dailyReport.lastRun = new Date(status.dailyReport.lastRun)
      }

      // Restore historical report status
      if (saved.historicalReport) {
        status.historicalReport = { ...status.historicalReport, ...saved.historicalReport }
        if (status.historicalReport.lastRun) status.historicalReport.lastRun = new Date(status.historicalReport.lastRun)
      }

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

async function runHistoricalReport(configPath: string, startStr: string, endStr?: string, recipientIndex?: number) {
  status.historicalReport.lastStatus = 'running'
  let storage: StorageService | undefined
  try {
    const config = loadConfig(configPath)
    storage = new StorageService(config.archiveDir)
    await saveStatus(storage)
    
    const analyzer = new AnalyzerService(config, storage)
    const notifier = new NotifierService(config)
    const reporter = new Reporter(storage, analyzer, notifier)

    const range = createTimeRange(startStr, endStr)
    logger.info(`Generating ${range.mode === 'historical' ? '历史趋势报告' : '今日新闻总结'} from ${range.start.toLocaleString('zh-CN')} to ${range.end.toLocaleString('zh-CN')}...`)
    
    await reporter.runHistoricalReport(range, recipientIndex)
    
    logger.success('Historical reporting task completed successfully.')
    status.historicalReport.lastRun = new Date()
    status.historicalReport.lastStatus = 'success'
    status.historicalReport.error = null
    await saveStatus(storage)
  } catch (error) {
    logger.error(error as any, 'Historical reporting task failed:')
    status.historicalReport.lastStatus = 'failed'
    status.historicalReport.error = error instanceof Error ? error.message : String(error)
    if (storage) await saveStatus(storage)
    throw error
  }
}

async function runReport(configPath: string, dateStr?: string, recipientIndex?: number) {
  status.dailyReport.lastStatus = 'running'
  let storage: StorageService | undefined
  try {
    const config = loadConfig(configPath)
    storage = new StorageService(config.archiveDir)
    await saveStatus(storage)

    const analyzer = new AnalyzerService(config, storage)
    const notifier = new NotifierService(config)
    const reporter = new Reporter(storage, analyzer, notifier)

    const date = dateStr ? new Date(dateStr) : new Date()
    logger.info(`Generating daily report for ${date.toLocaleDateString('zh-CN')}...`)
    await reporter.runDailyReport(date, recipientIndex)
    logger.success('Reporting task completed successfully.')
    status.dailyReport.lastRun = new Date()
    status.dailyReport.lastStatus = 'success'
    status.dailyReport.error = null
    await saveStatus(storage)
  } catch (error) {
    logger.error(error as any, 'Reporting task failed:')
    status.dailyReport.lastStatus = 'failed'
    status.dailyReport.error = error instanceof Error ? error.message : String(error)
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
  .option('--start <time>', 'Start time (yy-mm-dd hh:MM)')
  .option('--end <time>', 'End time (yy-mm-dd hh:MM)')
  .option('--id <index>', 'Recipient index in the config email list')
  .action(async (options) => {
    try {
      const recipientIndex = options.id !== undefined ? parseInt(options.id, 10) : undefined
      
      if (options.start || options.end) {
        const todayStr = formatDate(new Date()).slice(2)
        const start = options.start || `${todayStr} 01:00`
        await runHistoricalReport(options.config, start, options.end, recipientIndex)
      } else {
        await runReport(options.config, options.date, recipientIndex)
      }
    } catch (error) {
      process.exit(1)
    }
  })

cli
  .command('serve', 'Run as a daemon with scheduler and status server')
  .option('-c, --config <file>', 'Path to config file', { default: 'config.yaml' })
  .action(async (options) => {
    const config = loadConfig(options.config)
    logger.info('Starting Trend Analyzer daemon...')

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

    // Daily Report
    const dailyReportJob = new CronJob(config.dailyReportCron, async () => {
      try {
        await runReport(options.config)
      } catch (err) {
        // Error already logged
      }
    })

    // Historical Report
    const historicalReportJob = new CronJob(config.historicalReportCron, async () => {
      try {
        // By default, trigger for the analysis window
        const now = new Date();
        const start = new Date(now);
        start.setDate(now.getDate() - (config.analysis_window_days - 1));
        start.setHours(0, 0, 0, 0);
        
        const startStr = `${formatDate(start).slice(2)} 00:00`;
        await runHistoricalReport(options.config, startStr);
      } catch (err) {
        // Error already logged
      }
    })

    monitorJob.start()
    dailyReportJob.start()
    historicalReportJob.start()

    logger.info(`Scheduler started: Monitor (${config.monitorCron}), Daily (${config.dailyReportCron}), Historical (${config.historicalReportCron})`)

    const app = new Hono()
    app.get('/', (c) => c.json({
      status: 'up',
      uptime: process.uptime(),
      tasks: status
    }))

    app.get('/run/:task', async (c) => {
      const task = c.req.param('task')
      const id = c.req.query('id')
      const start = c.req.query('start')
      const end = c.req.query('end')
      const recipientIndex = id !== undefined ? parseInt(id, 10) : undefined

      if (task === 'monitor') {
        runMonitor(options.config).catch((err) => logger.error(err, 'Manual monitor trigger failed'))
        return c.json({ message: 'Monitor task triggered' })
      }
      
      if (task === 'daily-report' || (task === 'report' && !start && !end)) {
        runReport(options.config, undefined, recipientIndex).catch((err) => logger.error(err, 'Manual daily report trigger failed'))
        return c.json({ message: 'Daily report task triggered' })
      }

      if (task === 'historical-report' || (task === 'report' && (start || end))) {
        let startStr = start as string
        if (!startStr && !end) {
          // Use default window from config if no params provided for historical-report
          const now = new Date();
          const startDate = new Date(now);
          startDate.setDate(now.getDate() - (config.analysis_window_days - 1));
          startDate.setHours(0, 0, 0, 0);
          startStr = `${formatDate(startDate).slice(2)} 00:00`;
        } else if (!startStr) {
          const todayStr = formatDate(new Date()).slice(2)
          startStr = `${todayStr} 01:00`
        }

        runHistoricalReport(options.config, startStr, end as string, recipientIndex).catch((err) => logger.error(err, 'Manual historical report trigger failed'))
        return c.json({ 
          message: 'Historical report task triggered', 
          range: { start: startStr, end: end || 'now' } 
        })
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
      await notifier.sendReport('SMTP 服务测试', '这是一封来自趋势分析器的测试邮件。')
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