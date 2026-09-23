import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { loadFeedConfig, parseFeedConfig } from './config.js'
import { collectSource } from './collect.js'
import { runFeed } from './pipeline.js'

let dir: string
const source = { id: 'one', name: 'One', type: 'rss', url: 'https://example.com/feed' }
beforeEach(async () => { dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'feed-config-'))) })
afterEach(async () => { vi.unstubAllGlobals(); await fs.rm(dir, { recursive: true, force: true }) })
const write = (file: string, value: unknown) => fs.writeFile(path.join(dir, file), JSON.stringify(value))

it('loads sources and nested configuration relative to their declaring files from another cwd', async () => {
  await fs.mkdir(path.join(dir, 'nested'))
  await write('nested/rss.yaml', [source])
  await write('nested/llm.yaml', { llm: { model: 'fake', piModelsPath: './models.json', timeoutMs: 15000 } })
  await write('nested/base.yaml', { includes: ['./llm.yaml'], archiveDir: './data', sourceFiles: ['./rss.yaml'], localization: { concurrency: 1 } })
  await write('main.yaml', { includes: ['./nested/base.yaml'], llm: { summaryMaxTokens: 512 }, localization: { summaryChunkChars: 12000 } })
  const config = await loadFeedConfig(path.join(dir, 'main.yaml'))
  expect(config.sources).toHaveLength(1)
  expect(config.archiveDir).toBe(path.join(dir, 'nested/data'))
  expect(config.llm).toMatchObject({ model: 'fake', timeoutMs: 15000, summaryMaxTokens: 512, piModelsPath: path.join(dir, 'nested/models.json') })
  expect(config.localization).toMatchObject({ mode: 'summary', concurrency: 1, summaryChunkChars: 12000 })
})

it('merges in order, lets the root override and replaces arrays; sourceFiles append inline sources', async () => {
  await write('rss.yaml', [source])
  await write('a.yaml', { sources: [source], llm: { model: 'a' } })
  await write('b.yaml', { llm: { model: 'b' } })
  await write('main.yaml', { includes: ['./a.yaml', './b.yaml'], sourceFiles: ['./rss.yaml'], sources: [{ ...source, id: 'two' }], llm: { maxRetries: 0 } })
  const config = await loadFeedConfig(path.join(dir, 'main.yaml'))
  expect(config.sources.map(s => s.id)).toEqual(['one', 'two'])
  expect(config.llm).toMatchObject({ model: 'b', maxRetries: 0 })
})

it('rejects duplicate IDs, missing files, include cycles, unsafe keys and invalid parameters', async () => {
  await write('rss.yaml', [source])
  await write('dup.yaml', { sourceFiles: ['./rss.yaml'], sources: [source] })
  await expect(loadFeedConfig(path.join(dir, 'dup.yaml'))).rejects.toThrow('Source IDs must be unique')
  await write('a.yaml', { includes: ['./b.yaml'] }); await write('b.yaml', { includes: ['./a.yaml'] })
  await expect(loadFeedConfig(path.join(dir, 'a.yaml'))).rejects.toThrow('cycle')
  await write('missing.yaml', { sourceFiles: ['./absent.yaml'] })
  await expect(loadFeedConfig(path.join(dir, 'missing.yaml'))).rejects.toThrow('Cannot read YAML')
  await write('unsafe.yaml', { constructor: { polluted: true } })
  await expect(loadFeedConfig(path.join(dir, 'unsafe.yaml'))).rejects.toThrow('Unsafe configuration key')
  expect(() => parseFeedConfig({ sources: [source], llm: { model: 'fake', maxRetries: -1 } })).toThrow()
})

it('loads all public configurations with summary mode and disabled X accounts', async () => {
  for (const file of ['config.example.yaml', 'config.feed.example.yaml', 'config.dev.yaml']) {
    const config = await loadFeedConfig(path.resolve(file))
    expect(config.localization.mode).toBe('summary')
    expect(config.sources.filter(s => s.type.startsWith('x-')).every(s => !s.enabled)).toBe(true)
    expect(config.sources.some(s => s.channel === 'blogs')).toBe(true)
  }
})

it('globally disables X without invoking the adapter', async () => {
  const config = parseFeedConfig({ archiveDir: dir, opencli: { enabled: false }, localization: { enabled: false }, sources: [{ id: 'x', name: 'X', type: 'x-user', username: 'example' }] })
  const run = vi.fn()
  await expect(collectSource(config.sources[0], config, new Date().toISOString(), run)).rejects.toThrow('disabled')
  const result = await runFeed(config, {}, run)
  expect(result.results[0].status).toBe('disabled')
  expect(run).not.toHaveBeenCalled()
})

it('uses configured RSS retries and user agent', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
  vi.stubGlobal('fetch', fetch)
  const config = parseFeedConfig({ sources: [source], collection: { rssRetries: 0, userAgent: 'custom-reader', rssTimeoutMs: 500 } })
  await expect(collectSource(config.sources[0], config, new Date().toISOString())).rejects.toThrow('RSS HTTP 503')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(fetch.mock.calls[0][1].headers['User-Agent']).toBe('custom-reader')
})
