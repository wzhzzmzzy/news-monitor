import { generateObject, generateText, type LanguageModelV1 } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { z } from 'zod'
import type { 
  Config, NewsIndexItem, HourlyBatchResult, DailyTrendSummary, 
  TrendCluster, TrendItem, StreamItem, DailyReportData, ReportTopic,
  HistoricalReportData, HistoricalTopic, TimelineEntry
} from '../types/index.js'
import logger from '../utils/logger.js'
import { withRetry } from '../utils/retry.js'
import { renderDailyReport, renderHistoricalReport } from '../utils/renderer.js'
import { tryRepairJSON } from '../utils/json.js'
import { 
  fuzzyDeduplicateTopics, 
  calculateDurationWeight, 
  isTrendRelated, 
  aggregateBatchesToDaily 
} from '../utils/analysis.js'
import { formatDate } from '../utils/time.js'
import { 
  BATCH_ANALYSIS_PROMPT, 
  DAILY_TOP_TOPICS_PROMPT, 
  TOPIC_DETAIL_PROMPT,
  DAILY_SUMMARY_PROMPT,
  HISTORICAL_TOP_TOPICS_PROMPT,
  HISTORICAL_TOPIC_EVOLUTION_PROMPT,
  ORPHAN_SELECTION_PROMPT
} from './analyzer/prompts.js'

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
      .map((item) => `ID: ${item.id} | [${item.sources.join(', ')}] Rank: ${item.maxRank} | ${item.title}`)
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
          prompt: BATCH_ANALYSIS_PROMPT(newsContext),
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
    const topTopicsSchema = z.object({
      topTopics: z.array(z.object({
        title: z.string(),
        baseScore: z.number(),
        relevantNewsIds: z.array(z.string()),
        isLongTerm: z.boolean()
      })).max(10)
    })

    // Pre-calculate source counts for rawTopics to help LLM identify cross-platform trends
    const richRawTopics = rawTopics.map(t => {
      const allSources = new Set<string>()
      let bestRank = 999
      t.newsIds.forEach(id => {
        const news = newsMap[id]
        if (news) {
          news.sources.forEach(s => allSources.add(s))
          bestRank = Math.min(bestRank, news.maxRank)
        }
      })
      return {
        title: t.topic,
        score: t.heatScore,
        ids: t.newsIds,
        sourceCount: allSources.size,
        maxRank: bestRank === 999 ? 0 : bestRank
      }
    })

    const { object: topicList } = await withRetry(async () => {
      try {
        return await generateObject({
          model: this.model,
          schema: topTopicsSchema,
          prompt: DAILY_TOP_TOPICS_PROMPT(richRawTopics, clusters)
        })
      } catch (error: any) {
        if (error.text) {
          logger.warn('Top topics generation failed to parse JSON, attempting repair...')
          try {
            const repaired = tryRepairJSON(error.text)
            const parsed = JSON.parse(repaired)
            return { object: topTopicsSchema.parse(parsed) }
          } catch (repairError) {
            logger.error('JSON repair failed for top topics.')
            throw error
          }
        }
        throw error
      }
    })

    // 2.5 Identify Orphans (Call 1.5: LLM Selection)
    // First, filter candidates: unused, high rank/score
    const usedNewsIds = new Set<string>()
    topicList.topTopics.forEach(t => t.relevantNewsIds.forEach(id => usedNewsIds.add(id)))

    const orphanCandidates = richRawTopics
      .filter(t => {
        const isUsed = t.ids.some(id => usedNewsIds.has(id)) || 
                       topicList.topTopics.some(top => top.title.includes(t.title) || t.title.includes(top.title))
        if (isUsed) return false
        
        // Loose criteria for candidates pool: Rank <= 10 OR Score >= 50
        // We let LLM do the strict filtering
        const isCandidate = (t.maxRank > 0 && t.maxRank <= 10) || t.score >= 50
        return isCandidate
      })
      .sort((a, b) => {
         // Sort candidates by importance to give LLM the best context
         if (a.maxRank > 0 && b.maxRank > 0) return a.maxRank - b.maxRank
         if (a.maxRank > 0) return -1
         if (b.maxRank > 0) return 1
         return b.score - a.score
      })
      .slice(0, 20) // Provide top 20 candidates to LLM

    let orphans: typeof richRawTopics = []

    if (orphanCandidates.length > 0) {
      try {
        const { object: selection } = await withRetry(async () => {
          return await generateObject({
            model: this.model,
            schema: z.object({
              selectedTitles: z.array(z.string()).describe('The exact titles of the selected news items'),
              reasoning: z.string().optional()
            }),
            prompt: ORPHAN_SELECTION_PROMPT(orphanCandidates)
          })
        })

        // Map selected titles back to objects
        orphans = selection.selectedTitles
          .map(title => orphanCandidates.find(c => c.title === title))
          .filter(t => t !== undefined) as typeof richRawTopics
        
        logger.info(`LLM selected ${orphans.length} orphans from ${orphanCandidates.length} candidates.`)
      } catch (err) {
        logger.error(err as any, 'Failed to select orphans via LLM, falling back to top candidates.')
        // Fallback: take top 3 candidates
        orphans = orphanCandidates.slice(0, 3)
      }
    }

    // 3. For each topic, generate detailed analysis and select news (Call 2)
    const detailedTopicSchema = z.object({
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
    })
    
    const topics: ReportTopic[] = []
    
    for (const top of topicList.topTopics) {
      // Get news details for these IDs
      const relevantNews = top.relevantNewsIds
        .map(id => newsMap[id])
        .filter(n => n)
        .slice(0, 15) // Limit input to LLM

      const { object: detailedTopic } = await withRetry(async () => {
        try {
          return await generateObject({
            model: this.model,
            schema: detailedTopicSchema,
            prompt: TOPIC_DETAIL_PROMPT(top.title, relevantNews)
          })
        } catch (error: any) {
          if (error.text) {
            logger.warn(`Analysis generation failed for topic "${top.title}", attempting repair...`)
            try {
              const repaired = tryRepairJSON(error.text)
              const parsed = JSON.parse(repaired)
              return { object: detailedTopicSchema.parse(parsed) }
            } catch (repairError) {
              logger.error(`JSON repair failed for topic "${top.title}".`)
              throw error
            }
          }
          throw error
        }
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
        prompt: DAILY_SUMMARY_PROMPT(
          topics.map(t => t.title),
          orphans.map(t => `${t.title} (Rank: ${t.maxRank || 'N/A'}, Sources: ${t.sourceCount})`)
        )
      })
    })

    const sourceNames: Record<string, string> = {}
    this.config.hotlist_sources.forEach(s => sourceNames[s.id] = s.name)
    this.config.stream_sources.forEach(s => sourceNames[s.id] = s.name)

    const reportData: DailyReportData = {
      date: date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }),
      summary,
      topics: topics.sort((a, b) => b.score - a.score),
      orphans: orphans.map(t => {
        const primaryId = t.ids[0]
        const originalNews = primaryId ? newsMap[primaryId] : null
        return {
          title: originalNews ? originalNews.title : t.title, // Use original news title if available
          score: t.score,
          sourceCount: t.sourceCount,
          maxRank: t.maxRank,
          url: originalNews ? originalNews.url : undefined
        }
      }),
      sourceNames
    }

    return renderDailyReport(reportData)
  }

  async generateHistoricalReport(
    batches: HourlyBatchResult[],
    clusters: TrendCluster[],
    newsIndex: Record<string, NewsIndexItem>,
    timeRange: { start: Date; end: Date; mode: 'single' | 'historical' }
  ): Promise<string> {
    if (batches.length === 0) return '指定时间范围内无有效分析数据。'

    logger.info(`正在生成历史趋势报告 (${timeRange.start.toLocaleString('zh-CN')} 至 ${timeRange.end.toLocaleString('zh-CN')})...`)

    const newsMap = newsIndex || {}
    
    // 1. Prepare raw topic data
    const rawTopicsData = batches.flatMap(b => b.keyInfo.map(k => ({
      topic: k.topic,
      heatScore: k.heatScore,
      newsIds: k.newsIds,
      timestamp: b.timestamp
    })))

    // Fuzzy deduplication to reduce input size
    const { deduplicated: rawTopics } = fuzzyDeduplicateTopics(rawTopicsData)

    // Pre-calculate source counts for historical rawTopics
    const richRawTopics = rawTopics.map(t => {
      const allSources = new Set<string>()
      t.newsIds.forEach(id => {
        const news = newsMap[id]
        if (news) news.sources.forEach(s => allSources.add(s))
      })
      return {
        title: t.topic,
        score: t.heatScore,
        ids: t.newsIds,
        sourceCount: allSources.size
      }
    })

    // 2. Step 1: Identify top historical topics and generate global summary (Call 1)
    const topTopicsSchema = z.object({
      summary: z.string().describe('此时间段内整体趋势演变的宏观摘要。'),
      topTopics: z.array(z.object({
        title: z.string(),
        baseScore: z.number(),
        relevantNewsIds: z.array(z.string())
      })).max(10)
    })

    const { object: historicalSummary } = await withRetry(async () => {
      try {
        return await generateObject({
          model: this.model,
          schema: topTopicsSchema,
          prompt: HISTORICAL_TOP_TOPICS_PROMPT({
            start: timeRange.start.toISOString(),
            end: timeRange.end.toISOString(),
            mode: timeRange.mode
          }, richRawTopics)
        })
      } catch (error: any) {
        if (error.text) {
          logger.warn('Historical top topics generation failed to parse JSON, attempting repair...')
          try {
            const repaired = tryRepairJSON(error.text)
            const parsed = JSON.parse(repaired)
            return { object: topTopicsSchema.parse(parsed) }
          } catch (repairError) {
            logger.error('JSON repair failed for historical top topics.')
            throw error
          }
        }
        throw error
      }
    })

    // 3. Step 2: For each top topic, generate detailed evolution and timeline (Call 2 loop)
    const topics: HistoricalTopic[] = []
    const detailedHistoricalTopicSchema = z.object({
      evolution: z.string().describe('描述该话题在此期间的演变过程（例如：起源->爆发->现状）。'),
      timeline: z.array(z.object({
        date: z.string().describe('日期，格式为 YYYY-MM-DD。'),
        event: z.string().describe('关键节点描述。'),
        heatScore: z.number()
      })).max(10),
      selectedNews: z.array(z.object({
        title: z.string(),
        url: z.string(),
        source: z.string()
      })).max(5)
    })

    for (const item of historicalSummary.topTopics) {
      logger.info(`[Historical Report] Analyzing topic details: "${item.title}"...`)
      
      // Get related raw topics for this title to help the LLM see the timeline
      const relatedRaw = rawTopicsData.filter(rt => 
        rt.topic.includes(item.title) || item.title.includes(rt.topic)
      ).sort((a,b) => a.timestamp.localeCompare(b.timestamp))

      // Get some news details
      const relevantNews = item.relevantNewsIds
        .map(id => newsMap[id])
        .filter(n => n)
        .slice(0, 15)

      try {
        const { object: detailedTopic } = await withRetry(async () => {
          try {
            return await generateObject({
              model: this.model,
              schema: detailedHistoricalTopicSchema,
              prompt: HISTORICAL_TOPIC_EVOLUTION_PROMPT(
                item.title,
                { start: timeRange.start.toISOString(), end: timeRange.end.toISOString() },
                relatedRaw.map(r => ({ time: formatDate(new Date(r.timestamp)), score: r.heatScore })),
                relevantNews
              )
            })
          } catch (error: any) {
            if (error.text) {
              logger.warn(`Historical detailed analysis failed for topic "${item.title}", attempting repair...`)
              try {
                const repaired = tryRepairJSON(error.text)
                const parsed = JSON.parse(repaired)
                return { object: detailedHistoricalTopicSchema.parse(parsed) }
              } catch (repairError) {
                logger.error(`JSON repair failed for historical topic "${item.title}".`)
                throw error
              }
            }
            throw error
          }
        })

        topics.push({
          title: item.title,
          score: item.baseScore,
          evolution: detailedTopic.evolution,
          timeline: detailedTopic.timeline,
          news: detailedTopic.selectedNews
        })
        logger.success(`[Historical Report] Completed analysis for: "${item.title}"`)
      } catch (error) {
        logger.error(`[Historical Report] Failed to analyze topic "${item.title}" after retries. Skipping this topic.`)
        // Skip this topic but continue with others
      }
    }

    const sourceNames: Record<string, string> = {}
    this.config.hotlist_sources.forEach(s => sourceNames[s.id] = s.name)
    this.config.stream_sources.forEach(s => sourceNames[s.id] = s.name)

    const reportData: HistoricalReportData = {
      timeRange: {
        start: timeRange.start.toLocaleString('zh-CN'),
        end: timeRange.end.toLocaleString('zh-CN'),
        mode: timeRange.mode
      },
      summary: historicalSummary.summary,
      topics: topics.sort((a, b) => b.score - a.score),
      sourceNames
    }

    return renderHistoricalReport(reportData)
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