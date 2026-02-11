import type { TrendItem, HourlyBatchResult, DailyTrendSummary } from '../types/index.js'

/**
 * 话题模糊去重：合并标题相似、包含关系的话题
 */
export function fuzzyDeduplicateTopics(rawTopics: { topic: string, heatScore: number, newsIds: string[] }[]) {
  const consolidated = new Map<string, { topic: string, heatScore: number, newsIds: Set<string> }>()
  const mergedDetails: { from: string, to: string }[] = []

  for (const t of rawTopics) {
    const normalized = t.topic.trim().toLowerCase()
    let foundKey: string | null = null

    for (const key of consolidated.keys()) {
      if (key === normalized || 
         (key.length > 3 && normalized.length > 3 && (key.includes(normalized) || normalized.includes(key)))) {
        foundKey = key
        break
      }
    }

    if (foundKey) {
      const existing = consolidated.get(foundKey)!
      mergedDetails.push({ from: t.topic, to: existing.topic })
      existing.heatScore = Math.max(existing.heatScore, t.heatScore)
      t.newsIds.forEach(id => existing.newsIds.add(id))
      if (t.topic.length > existing.topic.length) {
        existing.topic = t.topic
      }
    } else {
      consolidated.set(normalized, {
        topic: t.topic,
        heatScore: t.heatScore,
        newsIds: new Set(t.newsIds)
      })
    }
  }

  return {
    deduplicated: Array.from(consolidated.values()).map(t => ({
      topic: t.topic,
      heatScore: t.heatScore,
      newsIds: Array.from(t.newsIds)
    })),
    mergedDetails
  }
}

/**
 * 计算持续天数权重
 */
export function calculateDurationWeight(days: number): number {
  if (days <= 1) return 1.0
  return 1.0 + (Math.log(days) * 0.5)
}

/**
 * 判断两个趋势是否相关
 */
export function isTrendRelated(t1: TrendItem, t2: TrendItem): boolean {
  if (t1.id === t2.id) return true
  
  if (t1.keywords && t2.keywords) {
    const k1 = new Set(t1.keywords)
    const k2 = new Set(t2.keywords)
    const intersection = [...k1].filter(x => k2.has(x))
    if (intersection.length >= 2) return true
  }

  if (t1.title.includes(t2.title) || t2.title.includes(t1.title)) return true
  
  return false
}

/**
 * 将小时批次聚合为每日摘要
 */
export function aggregateBatchesToDaily(batches: HourlyBatchResult[], date: Date): DailyTrendSummary {
  const trendMap = new Map<string, TrendItem>()

  for (const batch of batches) {
    for (const info of batch.keyInfo) {
      const id = Buffer.from(info.topic).toString('base64').replace(/=/g, '')
      
      if (!trendMap.has(id)) {
        trendMap.set(id, {
          id,
          title: info.topic,
          keywords: info.entities,
          score: info.heatScore,
          category: info.category,
          first_seen_at: batch.timestamp,
          related_links: []
        })
      } else {
        const existing = trendMap.get(id)!
        existing.score = Math.max(existing.score, info.heatScore)
        const mergedKeywords = new Set([...existing.keywords, ...info.entities])
        existing.keywords = Array.from(mergedKeywords)
      }
    }
  }

      return {

        date: date.toISOString().split('T')[0],

        generated_at: new Date().toISOString(),

        trends: Array.from(trendMap.values())

      }

    }

    

  