import { describe, it, expect } from 'vitest'
import { tryRepairJSON, safeJSONParse } from './json'

describe('JSON Repair Utility', () => {
  it('should repair unescaped quotes inside string values', () => {
    // LLM sometimes outputs this kind of broken JSON
    const broken = '{"title": "春节消费"三重大礼包"请查收"}'
    const repaired = tryRepairJSON(broken)
    expect(() => JSON.parse(repaired)).not.toThrow()
    const parsed = JSON.parse(repaired)
    expect(parsed.title).toBe('春节消费"三重大礼包"请查收')
  })

  it('should handle markdown code blocks', () => {
    const broken = '```json\n{"key": "value"}\n```'
    const repaired = tryRepairJSON(broken)
    // jsonrepair returns the string within the code block
    expect(repaired).toContain('{"key": "value"}')
  })

  it('should repair trailing commas', () => {
    const broken = '{"list": [1, 2, 3,],}'
    const repaired = tryRepairJSON(broken)
    expect(JSON.parse(repaired)).toEqual({ list: [1, 2, 3] })
  })

  it('should work with safeJSONParse for complex broken cases', () => {
    const broken = '{"analysis": "Something", "news": [{"title": "News "Title" Quote"}]}'
    const parsed = safeJSONParse<{ analysis: string, news: any[] }>(broken)
    expect(parsed.analysis).toBe('Something')
    expect(parsed.news[0].title).toBe('News "Title" Quote')
  })
})
