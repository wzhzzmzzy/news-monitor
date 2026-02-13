import { z } from 'zod'

const sourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['rss', 'api', 'html']),
  url: z.string().min(1),
  selector: z.string().optional(),
  headers: z.record(z.string()).optional(),
})

export const configSchema = z.preprocess(
  (input) => {
    const data = input as any
    // Migration: Map legacy 'sources' to 'hotlist_sources' if missing
    if (Array.isArray(data.sources) && !data.hotlist_sources) {
      data.hotlist_sources = data.sources.map((url: string, index: number) => ({
        id: `legacy-source-${index}`,
        type: 'rss', // Default assumption for legacy
        url,
      }))
    }
    return data
  },
  z.object({
    newsApiBaseUrl: z.string().url(),
    sources: z.array(z.string()).optional(), // Deprecated but kept for validation if passed
    hotlist_sources: z.array(sourceConfigSchema).min(1),
    stream_sources: z.array(sourceConfigSchema).default([]),
    
    // Analysis settings
    analysis_window_days: z.number().int().min(1).default(3),
    enable_stream_analysis: z.boolean().default(false),
    
    monitorCron: z.string().default('*/30 * * * *'),
    dailyReportCron: z.string().default('0 23 * * *'),
    historicalReportCron: z.string().default('0 10 * * 1'), // Default: Every Monday at 10 AM
    serverPort: z.number().int().positive().default(12440),
    archiveDir: z.string().default('./archive'),
    llmProvider: z.enum(['openai', 'deepseek', 'anthropic']),
    llmApiKey: z.string().min(1),
    llmBaseUrl: z.string().url().optional(),
    llmModel: z.string().min(1),
    smtpHost: z.string().optional(),
    smtpPort: z.number().int().positive().optional(),
    smtpUser: z.string().optional(),
    smtpPass: z.string(),
    emailFromName: z.string().default('NewsHead'),
    emailFrom: z.string().email(),
    emailTo: z.array(z.string().email()).min(1),
  })
)

export type ValidConfig = z.infer<typeof configSchema>
