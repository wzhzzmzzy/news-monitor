import { jsonrepair } from 'jsonrepair'

/**
 * 尝试修复 LLM 生成的不规范 JSON 字符串。
 */
export function tryRepairJSON(jsonString: string): string {
  try {
    let text = jsonString.trim()

    // 1. 如果被 markdown 代码块包裹，提取出来
    const match = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (match) {
      text = match[1]
    }

    return jsonrepair(text)
  } catch (e) {
    // 如果修复失败，返回原字符串，让后续解析报错
    return jsonString
  }
}

/**
 * 安全地解析 JSON，如果解析失败则尝试修复后重试
 */
export function safeJSONParse<T>(text: string): T {
  try {
    return JSON.parse(text) as T
  } catch (e) {
    const repaired = tryRepairJSON(text)
    try {
      return JSON.parse(repaired) as T
    } catch (e2) {
      // 如果还是失败，抛出原始错误
      throw e
    }
  }
}