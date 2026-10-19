import fs from 'node:fs/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { koalaHttp } from './koala-http.js'

afterEach(() => { vi.unstubAllEnvs() })
it('publishes JSON with auth only on stdin and removes the temporary HTTP response', async () => {
  vi.stubEnv('HTTPS_PROXY', 'http://127.0.0.1:7897')
  let outputFile = '', captured: string[] = [], input = ''
  const request = koalaHttp(async (args, config) => {
    captured = args; input = config; outputFile = args[args.indexOf('--output') + 1]
    await fs.writeFile(outputFile, '{"success":true}')
    return '200'
  })
  const body = JSON.stringify({ content: '新闻\n"原文"\\路径' })
  const response = await request('https://example.com/api/markdown/batch', { method: 'POST', headers: { Authorization: 'Bearer test-secret' }, body })
  expect(await response.json()).toEqual({ success: true })
  expect(captured.join(' ')).not.toContain('test-secret')
  expect(input).toContain('Bearer test-secret')
  expect(input).toContain('proxy = "http://127.0.0.1:7897"')
  expect(JSON.parse(input.split('\n').find(line => line.startsWith('data = '))!.slice(7))).toBe(body)
  expect(captured).not.toContain('--retry')
  await expect(fs.access(outputFile)).rejects.toThrow()
})
it('only permits safe read retries and keeps HTTP errors visible to the publication layer', async () => {
  let captured: string[] = []
  const request = koalaHttp(async args => {
    captured = args; await fs.writeFile(args[args.indexOf('--output') + 1], 'unavailable'); return '503'
  })
  const response = await request('https://example.com/news-feed')
  expect(response.ok).toBe(false)
  expect(response.status).toBe(503)
  expect(await response.text()).toBe('unavailable')
  expect(captured[captured.indexOf('--retry') + 1]).toBe('2')
})
it('never retries a failed write and cleans its temporary files without exposing diagnostics', async () => {
  let outputFile = ''
  const run = vi.fn(async (args: string[]) => { outputFile = args[args.indexOf('--output') + 1]; throw new Error('transport failed') })
  await expect(koalaHttp(run)('https://example.com/api/markdown/batch', { method: 'POST', body: '{}' })).rejects.toThrow('transport failed')
  expect(run).toHaveBeenCalledTimes(1)
  expect(run.mock.calls[0][0]).not.toContain('--retry')
  await expect(fs.access(outputFile)).rejects.toThrow()
})
