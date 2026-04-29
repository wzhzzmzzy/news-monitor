import { describe, expect, it } from 'vitest'
import { configSchema } from './config.js'
import { DEFAULT_BROWSER_USER_AGENT } from '../services/crawler.js'

const baseConfig = {
  newsApiBaseUrl: 'https://newsnow.busiyi.world/',
  hotlist_sources: [
    { id: 'weibo', name: '微博', type: 'api', url: '/api/s?id=weibo' },
  ],
  llmProvider: 'deepseek',
  llmApiKey: 'test-key',
  llmModel: 'deepseek-chat',
  smtpPass: 'test-pass',
  emailFrom: 'sender@example.com',
  emailTo: ['receiver@example.com'],
}

describe('configSchema crawler headers', () => {
  it('should enable browser User-Agent by default', () => {
    const result = configSchema.parse(baseConfig)

    expect(result.crawlerBrowserUserAgentEnabled).toBe(true)
    expect(result.crawlerUserAgent).toBe(DEFAULT_BROWSER_USER_AGENT)
  })

  it('should allow disabling and overriding crawler User-Agent', () => {
    const result = configSchema.parse({
      ...baseConfig,
      crawlerBrowserUserAgentEnabled: false,
      crawlerUserAgent: 'Custom UA',
    })

    expect(result.crawlerBrowserUserAgentEnabled).toBe(false)
    expect(result.crawlerUserAgent).toBe('Custom UA')
  })
})

describe('configSchema LLM structured output mode', () => {
  it('should default DeepSeek configs to JSON object generation mode', () => {
    const result = configSchema.parse(baseConfig)

    expect(result.llmStructuredOutputMode).toBe('json')
  })

  it('should allow overriding structured output mode', () => {
    const result = configSchema.parse({
      ...baseConfig,
      llmStructuredOutputMode: 'auto',
    })

    expect(result.llmStructuredOutputMode).toBe('auto')
  })
})
