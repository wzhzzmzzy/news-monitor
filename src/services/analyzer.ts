import { generateObject, generateText, type LanguageModelV1 } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import type { Config, NewsIndexItem, HourlyBatchResult, DailyTrendSummary, TrendCluster, TrendItem, StreamItem, DailyReportData, ReportTopic } from '../types/index.js'
import logger from '../utils/logger.js'
import { withRetry } from '../utils/retry.js'
import { renderDailyReport } from '../utils/renderer.js'
import { 
  fuzzyDeduplicateTopics, 
  calculateDurationWeight, 
  isTrendRelated, 
  aggregateBatchesToDaily 
} from '../utils/analysis.js'

import type { StorageService } from './storage.js'

export class AnalyzerService {
  private config: Config
  private model: LanguageModelV1
  private storage?: StorageService

  constructor(config: Config, storage?: StorageService) {
    this.config = config
    this.storage = storage

    const openai = createOpenAI({
      apiKey: config.llmApiKey,
      baseURL: config.llmBaseUrl,
    })

    this.model = openai(config.llmModel) as LanguageModelV1
  }

  async analyzeBatch(items: NewsIndexItem[]): Promise<HourlyBatchResult> {
    // 过滤掉已知存在安全风险的条目
    const validItems = items.filter(item => !item.isSafetyRisk)
    
    if (validItems.length === 0) {
      return {
        timestamp: new Date().toISOString(),
        summary: '没有新条目可供分析（或所有条目均已命中安全策略）。',
        keyInfo: [],
      }
    }

    if (validItems.length < items.length) {
      logger.info(`已自动过滤 ${items.length - validItems.length} 条已知安全风险新闻。`)
    }

    logger.info(`正在分析 ${validItems.length} 条新闻...`)

    const newsContext = validItems
      .map((item) => `ID: ${item.id} | [${item.sources.join(', ')}] ${item.title}`)
      .join('\n')

    try {
      const { object } = await withRetry(async () => {
        return await generateObject({
          model: this.model,
          schema: z.object({
            summary: z.string().describe('此批新闻主要主题的简明摘要。'),
            keyInfo: z.array(z.object({
              topic: z.string().describe('核心话题或事件。'),
              entities: z.array(z.string()).describe('关键人物、公司或地点。'),
              heatScore: z.number().min(1).max(100).describe('估计的显著性或热度。'),
              category: z.string().describe('通用类别（例如：科技、财经、政治）。'),
              newsIds: z.array(z.string()).describe('输入中属于该话题的 ID 列表。'),
            })),
          }),
          prompt: `分析以下新闻标题并提取关键趋势和话题。
          请使用中文返回摘要和结构化的关键信息。
          
          对于识别出的每个话题，列出属于该话题的新闻 ID。
          
          新闻标题：
          ${newsContext}
          `,
        })
      })

      return {
        timestamp: new Date().toISOString(),
        summary: object.summary,
        keyInfo: object.keyInfo,
      }
    } catch (error) {
      const errorMessage = (error as Error).message
      if (errorMessage.includes('Content Exists Risk') || errorMessage.includes('safety')) {
        if (validItems.length <= 1) {
          const item = validItems[0]
          const logMsg = `[Safety Risk] ID: ${item?.id} | Title: ${item?.title} | URL: ${item?.url}`
          logger.warn(`单个新闻条目触碰安全策略: ${item?.title}`)
          
          if (this.storage && item) {
            await this.storage.appendLog('safety.log', logMsg)
            await this.markSafetyRisk(item.id)
          }

          return {
            timestamp: new Date().toISOString(),
            summary: '此条目因安全策略被跳过。',
            keyInfo: [],
          }
        }

        logger.warn(`检测到内容安全风险，尝试拆分批次（当前大小: ${validItems.length}）...`)
        const mid = Math.floor(validItems.length / 2)
        const left = validItems.slice(0, mid)
        const right = validItems.slice(mid)

        const [resLeft, resRight] = await Promise.all([
          this.analyzeBatch(left),
          this.analyzeBatch(right)
        ])

        return {
          timestamp: new Date().toISOString(),
          summary: `${resLeft.summary} | ${resRight.summary}`.replace(/没有新条目可供分析。/g, '').replace(/没有新条目可供分析（或所有条目均已命中安全策略）。/g, '').trim(),
          keyInfo: [...resLeft.keyInfo, ...resRight.keyInfo],
        }
      }

      logger.error(`分析失败: ${errorMessage}`)
      return {
        timestamp: new Date().toISOString(),
        summary: `分析由于错误被跳过: ${errorMessage}`,
        keyInfo: [],
      }
    }
  }

  private async markSafetyRisk(id: string): Promise<void> {
    if (!this.storage) return
    
    try {
      const filename = 'index.json'
      const index = (await this.storage.loadJson<Record<string, NewsIndexItem>>(filename)) || {}
      if (index[id]) {
        index[id].isSafetyRisk = true
        await this.storage.saveJson(filename, index)
        logger.debug(`已在索引中将新闻 ID ${id} 标记为安全风险。`)
      }
    } catch (err) {
      logger.error(err as any, '标记安全风险条目失败:')
    }
  }

  async generateDailyReport(batches: HourlyBatchResult[], clusters?: TrendCluster[], newsIndex?: Record<string, NewsIndexItem>, date: Date = new Date()): Promise<string> {
    if (batches.length === 0) return '今日无有效分析数据。'

    logger.info(`正在从 ${batches.length} 个小时批次生成结构化每日报告...`)

    const newsMap = newsIndex || {}
    
    // 1. Prepare raw topic data from batches and clusters
    const rawTopicsData = batches.flatMap(b => b.keyInfo.map(k => ({
      topic: k.topic,
      heatScore: k.heatScore,
      newsIds: k.newsIds,
    })))

    // 1b. Fuzzy deduplication in code to reduce LLM context pressure
    const { deduplicated: rawTopics, mergedDetails } = fuzzyDeduplicateTopics(rawTopicsData)
    
    mergedDetails.forEach(detail => {
      logger.debug(`[Dedupe] Merging "${detail.from}" into "${detail.to}"`)
    })

    if (mergedDetails.length > 0) {
      logger.info(`Fuzzy deduplication cleaned up ${mergedDetails.length} topics.`)
    }

    // 2. Identify and consolidate top topics (Call 1)
    const { object: topicList } = await withRetry(async () => {
      return await generateObject({
        model: this.model,
        schema: z.object({
          topTopics: z.array(z.object({
            title: z.string(),
            baseScore: z.number(),
            relevantNewsIds: z.array(z.string()),
            isLongTerm: z.boolean()
          })).max(10)
        }),
        prompt: `基于以下今日抓取的原始话题数据，识别并整合出今天最重要的 5-10 个核心话题。
        对于相似的话题请进行合并。
        
        要求：
        1. 话题标题 (title) 必须是 1 个或多个客观、中立的精炼短语或词语。
        2. 每个短语/词语的字数严格限制在 6 字以内。
        3. 严禁进行任何价值判断，仅根据报道热度和频率识别事实性话题。
        
        原始话题：
        ${JSON.stringify(rawTopics.map(t => ({ title: t.topic, score: t.heatScore, ids: t.newsIds })), null, 2)}
        
        持续关注的话题 (参考)：
        ${JSON.stringify(clusters?.map(c => c.main_topic) || [])}
        `
      })
    })

    // 3. For each topic, generate detailed analysis and select news (Call 2 - possibly multiple if needed, but here consolidated for efficiency)
    const topics: ReportTopic[] = []
    
    for (const top of topicList.topTopics) {
      // Get news details for these IDs
      const relevantNews = top.relevantNewsIds
        .map(id => newsMap[id])
        .filter(n => n)
        .slice(0, 15) // Limit input to LLM

      const { object: detailedTopic } = await withRetry(async () => {
        return await generateObject({
          model: this.model,
          schema: z.object({
            analysis: z.string().describe('该话题的深度语义分析，包含背景和今日进展。'),
            groupedNews: z.array(z.object({
              title: z.string().describe('新闻标题（选择一个最具代表性的）。'),
              url: z.string().describe('主链接（选择一个最权威的，如新华网、澎湃、头条等）。'),
              source: z.string().describe('主链接的来源 ID（如 weibo, zhihu 等）。'),
              otherPlatforms: z.array(z.object({
                platform: z.string().describe('对应平台的 ID（如 weibo, zhihu, cls-hot 等）。'),
                url: z.string()
              })).optional().describe('同一事件在其他平台的报道链接。')
            })).max(10)
          }),
          prompt: `请针对话题 "${top.title}" 进行深度分析。
          
          参考新闻列表：
          ${JSON.stringify(relevantNews.map(n => ({ title: n.title, url: n.url, sources: n.sources })))}
          
          要求：
          1. 分析内容必须客观、实事求是，仅基于给出的新闻信息做直接的趋势总结。
          2. 严禁进行任何价值判断（如褒贬、主观预测或评价）。
          3. 字数严格控制在 100 字以内。
          4. 从参考新闻中，遴选出 1-10 条最核心的新闻。
          5. 如果同一新闻在多个平台都有报道，请将其合并，以一个主标题和多个附属平台链接的形式给出。
          6. platform 和 source 字段请严格使用新闻列表提供的原始 ID (如 weibo, zhihu, cls-hot 等)，不要输出中文名。
          `
        })
      })

      topics.push({
        title: top.title,
        score: top.baseScore,
        analysis: detailedTopic.analysis,
        isLongTerm: top.isLongTerm,
        news: detailedTopic.groupedNews
      })
    }

    // 4. Generate summary (Call 3)
    const { text: summary } = await withRetry(async () => {
      return await generateText({
        model: this.model,
        prompt: `基于以下今日的核心话题，写一段精炼的执行摘要（Executive Summary）。
        
        要求：
        1. 摘要必须实事求是，仅概括今日整体趋势走势。
        2. 严禁进行价值判断，不做任何主观评价。
        3. 字数严格控制在 150 字以内。
        
        今日话题：
        ${topics.map(t => `- ${t.title}`).join('\n')}
        `
      })
    })

    const sourceNames: Record<string, string> = {}
    this.config.hotlist_sources.forEach(s => sourceNames[s.id] = s.name)
    this.config.stream_sources.forEach(s => sourceNames[s.id] = s.name)

    const reportData: DailyReportData = {
      date: date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
      summary,
      topics: topics.sort((a, b) => b.score - a.score),
      sourceNames
    }

    return renderDailyReport(reportData)
  }

  aggregateToDaily(batches: HourlyBatchResult[], date: Date): DailyTrendSummary {
    return aggregateBatchesToDaily(batches, date)
  }

  // -- Multi-Day Analysis Methods --

  /**
   * T012 & T013: Detect multi-day trends using Map-Reduce logic.
   * Correlates today's trends with history to find long-running topics.
   */
  async detectMultiDayTrends(
    today: DailyTrendSummary, 
    history: DailyTrendSummary[],
    streamItems: StreamItem[] = []
  ): Promise<TrendCluster[]> {
    const clusters: TrendCluster[] = []
    
    for (const trend of today.trends) {
      const cluster: TrendCluster = {
        main_topic: trend.title,
        keywords: trend.keywords,
        duration_days: 1,
        is_rising: false,
        history: [{ date: today.date, score: trend.score, title: trend.title }],
        stream_evidence: [],
        related_links: trend.related_links || []
      }

      // Check history (newest to oldest or just iterate)
      // Note: history is expected to be ordered or we can just iterate all
      for (const daySummary of history) {
        const match = daySummary.trends.find(t => isTrendRelated(trend, t))
        if (match) {
           cluster.duration_days++
           cluster.history.push({ date: daySummary.date, score: match.score, title: match.title })
        }
      }
      
      // Sort history by date desc?
      cluster.history.sort((a,b) => b.date.localeCompare(a.date))

      // Calculate is_rising (current score > average of past scores)
      if (cluster.history.length > 1) {
          const currentScore = cluster.history[0].score // Assuming first is today (newest)
          const prevScores = cluster.history.slice(1).map(h => h.score)
          const avgPrev = prevScores.reduce((a,b) => a+b, 0) / prevScores.length
          cluster.is_rising = currentScore > avgPrev
      }

      // Correlate with streams (US2)
      if (streamItems.length > 0) {
        // Use correlation logic inline or helper
        // We reuse the logic from correlateStreams but apply it to this cluster/trend
        const matches = streamItems.filter(item => {
           const content = item.content.toLowerCase()
           // Title match
           if (content.includes(trend.title.toLowerCase())) return true
           // Keyword match
           return trend.keywords.some(k => content.includes(k.toLowerCase()))
        })
        cluster.stream_evidence = matches
      }

      clusters.push(cluster)
    }
    
    // Sort clusters by weighted score
    return clusters.sort((a,b) => {
        const scoreA = a.history[0].score * calculateDurationWeight(a.duration_days)
        const scoreB = b.history[0].score * calculateDurationWeight(b.duration_days)
        return scoreB - scoreA
    })
  }

  /**
   * T014: Pure function to boost scores for long-running trends.
   */
  calculateDurationWeight(days: number): number {
      return calculateDurationWeight(days)
  }

  // -- Stream Analysis Methods (US2) --

  async correlateStreams(hotlistTrends: TrendItem[], streamItems: StreamItem[]): Promise<Record<string, StreamItem[]>> {
    const correlation: Record<string, StreamItem[]> = {}
    
    for (const trend of hotlistTrends) {
      const matches = streamItems.filter(item => {
        const content = item.content.toLowerCase()
        // Title match
        if (content.includes(trend.title.toLowerCase())) return true
        // Keyword match (at least one)
        return trend.keywords.some(k => content.includes(k.toLowerCase()))
      })
      
      if (matches.length > 0) {
        correlation[trend.id] = matches
      }
    }
    return correlation
  }

  async detectSentinelTrends(streamItems: StreamItem[], hotlistTrends: TrendItem[]): Promise<string[]> {
    // 1. Filter out items that match hotlists
    const uncorrelated = streamItems.filter(item => {
      const content = item.content.toLowerCase()
      return !hotlistTrends.some(t => 
        content.includes(t.title.toLowerCase()) || 
        t.keywords.some(k => content.includes(k.toLowerCase()))
      )
    })

    // 2. Count frequent terms/phrases in uncorrelated items (Simplified: just look for identical content or simple n-grams? 
    // For MVP: Identical content or simple clustering is hard without NLP lib.
    // Let's just return high-frequency identical titles)
    const counts = new Map<string, number>()
    for (const item of uncorrelated) {
      const key = item.content.trim()
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    // Return content with > 2 occurrences
    return Array.from(counts.entries())
      .filter(([_, count]) => count >= 3)
      .map(([content]) => content)
  }
}