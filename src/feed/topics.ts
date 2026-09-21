import type { ReadingItem } from './localize.js'

// Split AI out of previously cached technical ratings without re-scoring items.
// Business and humanities stories retain their editorial category.
export function readingTopic(topic: string, item: ReadingItem): string {
  if (topic !== '技术') return topic
  const text = `${item.chinese?.titleZh || item.title}\n${item.chinese?.summaryZh || ''}`
  return /人工智能|人工智慧|大模型|语言模型|智能体|机器学习|深度学习|神经网络|扩散模型|生成式|\b(?:AI|LLMs?|OpenAI|Anthropic|ChatGPT|Claude|DeepSeek|Gemini|GPT[- ]?\d)\b/i.test(text) ? 'AI' : topic
}
