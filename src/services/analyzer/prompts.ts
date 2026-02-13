import type { TrendCluster } from '../../types/index.js'

export const BATCH_ANALYSIS_PROMPT = (newsContext: string) => `分析以下新闻标题并提取关键趋势和话题。
请使用中文返回摘要和结构化的关键信息。

评分准则 (heatScore)：
1. 综合考虑新闻的排名 (Rank) 和信源权威性。
2. 多信源报道的话题热度应高于单一信源。
3. 官方媒体报道的权重应略高于社交媒体。

对于识别出的每个话题，列出属于该话题的新闻 ID。

新闻标题：
${newsContext}
`

export const DAILY_TOP_TOPICS_PROMPT = (
  richRawTopics: { title: string; score: number; sourceCount: number; ids: string[] }[],
  clusters?: TrendCluster[]
) => `基于以下今日抓取的原始话题数据，识别并整合出今天最重要的 5-10 个核心话题。
对于相似的话题请进行合并。

要求：
1. 话题标题 (title) 必须是 1 个或多个客观、中立的精炼短语或词语。
2. 每个短语/词语的字数严格限制在 6 字以内。
3. 严禁进行任何价值判断，仅根据报道热度和频率识别事实性话题。
4. **优先选择跨平台话题**：请重点关注 sourceCount (信源数) > 1 的话题。即使 score 很高，若 sourceCount=1 (单平台自嗨)，也应适当降权或剔除。
5. sourceCount >= 3 的话题视为全网高共识热点，必须优先入选。

原始话题 (含信源数)：
${JSON.stringify(richRawTopics.map(t => ({ title: t.title, score: t.score, sourceCount: t.sourceCount, ids: t.ids })), null, 2)}

持续关注的话题 (参考)：
${JSON.stringify(clusters?.map(c => c.main_topic) || [])}
`

export const TOPIC_DETAIL_PROMPT = (
  topicTitle: string,
  relevantNews: { title: string; url: string; sources: string[] }[]
) => `请针对话题 "${topicTitle}" 进行深度分析。

参考新闻列表：
${JSON.stringify(relevantNews.map(n => ({ title: n.title, url: n.url, sources: n.sources })))}

要求：
1. 分析内容必须客观、实事求是，仅基于给出的新闻信息做直接的趋势总结。
2. 严禁进行任何价值判断（如褒贬、主观预测或评价）。
3. 字数严格控制在 100 字以内。
4. 从参考新闻中，遴选出 1-10 条最核心的新闻。
5. 如果同一新闻在多个平台都有报道，请将其合并，以一个主标题和多个附属平台链接的形式给出。
6. platform 和 source 字段请严格使用新闻列表提供的原始 ID (如 weibo, zhihu, cls-hot 等)，不要输出中文名。
7. **重要：必须返回合法的 JSON。如果新闻标题中包含双引号，请务必将其转义（如 \"内容\"）或替换为中文引号（“”）。**
`

export const DAILY_SUMMARY_PROMPT = (topicTitles: string[], orphanNewsTitles: string[] = []) => `基于以下今日的核心话题${orphanNewsTitles.length > 0 ? '和补充的独立高热新闻' : ''}，写一段精炼的执行摘要（Executive Summary）。

要求：
1. 摘要必须实事求是，优先概括核心话题的整体趋势走势。
2. 严禁进行价值判断，不做任何主观评价。
3. 若存在独立新闻（未归类但高热度），请在摘要末尾简要提及，补充完整性。
4. 字数严格控制在 150 字以内。

今日核心话题：
${topicTitles.map(t => `- ${t}`).join('\n')}

${orphanNewsTitles.length > 0 ? `值得关注的独立新闻（未归类但高热度）：\n${orphanNewsTitles.map(t => `- ${t}`).join('\n')}` : ''}
`

export const HISTORICAL_TOP_TOPICS_PROMPT = (
  timeRange: { start: string; end: string; mode: string },
  richRawTopics: { title: string; score: number; sourceCount: number; ids: string[] }[]
) => `基于以下时间段内抓取的原始话题数据，识别并整合出最重要的 5-10 个核心话题，并提供一段宏观摘要。

时间范围：${timeRange.start} 至 ${timeRange.end}
模式：${timeRange.mode}

原始话题 (含信源数)：
${JSON.stringify(richRawTopics.map(t => ({ title: t.title, score: t.score, sourceCount: t.sourceCount, ids: t.ids })), null, 2)}

要求：
1. 话题标题 (title) 字数严格限制在 6 字以内。
2. 摘要必须实事求是，仅概括此时间段内的整体趋势演变。
3. 使用中文返回结果。
4. **信源多样性优先**：请重点关注 sourceCount >= 2 的话题。单一信源的高分话题往往是局部热点，在历史回顾中应被降权。
`

export const HISTORICAL_TOPIC_EVOLUTION_PROMPT = (
  topicTitle: string,
  timeRange: { start: string; end: string },
  relatedRaw: { time: string; score: number }[],
  relevantNews: { title: string; url: string; sources: string[] }[]
) => `请针对话题 "${topicTitle}" 生成历史演变分析和时间轴。

相关话题历史节点数据：
${JSON.stringify(relatedRaw)}

参考新闻列表：
${JSON.stringify(relevantNews.map(n => ({ title: n.title, url: n.url, sources: n.sources })))}

要求：
1. evolution: 描述该话题在 ${timeRange.start} 至 ${timeRange.end} 期间的起承转合，客观且精炼。
2. timeline: 记录关键的时间节点、对应的事件描述和热度。date 字段必须使用 YYYY-MM-DD 格式。
3. selectedNews: 从新闻列表中挑选最具代表性的 3-5 条。
4. 使用中文返回。
`

export const ORPHAN_SELECTION_PROMPT = (
  candidates: { title: string; score: number; sourceCount: number; maxRank: number }[]
) => `基于以下“未归入今日核心话题”的候选新闻列表，筛选出 3-5 条最值得关注的“遗珠新闻”。

候选新闻列表 (按热度排序)：
${JSON.stringify(candidates.map(c => ({ title: c.title, rank: c.maxRank, score: c.score, sources: c.sourceCount })), null, 2)}

筛选标准：
1. **独立价值高**：优先选择那些虽然没形成大话题簇，但本身事件重大（如突发灾难、重大政策、独家重磅）的新闻。
2. **排除噪音**：剔除明星八卦、纯营销文案或琐碎的社会新闻，除非其热度极高 (Rank <= 3)。
3. **补充视角**：选择那些能补充今日核心话题视角之外的内容。

请返回 JSON 格式，包含 selectedTitles (选中的新闻原标题列表) 和 reasoning (整体选择理由的简述)。
`
