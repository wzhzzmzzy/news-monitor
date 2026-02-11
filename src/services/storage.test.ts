import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { StorageService } from './storage.js'

describe('StorageService', () => {
  const testArchiveDir = './tmp-test-archive'
  let storage: StorageService

  beforeEach(async () => {
    storage = new StorageService(testArchiveDir)
    await fs.mkdir(path.resolve(process.cwd(), testArchiveDir), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(path.resolve(process.cwd(), testArchiveDir), { recursive: true, force: true })
  })

  it('should save and load JSON data', async () => {
    const testData = { hello: 'world' }
    const filename = 'test.json'

    await storage.saveJson(filename, testData)
    const loadedData = await storage.loadJson(filename)

    expect(loadedData).toEqual(testData)
  })

  it('should return null when file does not exist', async () => {
    const loadedData = await storage.loadJson('non-existent.json')
    expect(loadedData).toBeNull()
  })

  it('should check if file exists', async () => {
    const filename = 'exists-test.json'
    expect(await storage.exists(filename)).toBe(false)

    await storage.saveJson(filename, { foo: 'bar' })
    expect(await storage.exists(filename)).toBe(true)
  })

  it('should create daily directory', async () => {
    const date = new Date('2026-02-06')
    const filename = 'daily.json'
    await storage.saveJson(filename, { date: '2026-02-06' }, date)

    const expectedPath = path.resolve(process.cwd(), testArchiveDir, '2026-02-06', filename)
    await expect(fs.access(expectedPath)).resolves.toBeUndefined()
  })

  // -- Multi-Day Analysis Tests --

  it('should save and get daily summary', async () => {
    const date = new Date('2026-02-01')
    const summary = {
      date: '2026-02-01',
      generated_at: new Date().toISOString(),
      trends: [{
        id: 't1', title: 'Trend 1', keywords: ['k1'], score: 10, first_seen_at: new Date().toISOString(), related_links: []
      }]
    }

    await storage.saveDailySummary(date, summary)
    const loaded = await storage.getDailySummary(date)
    expect(loaded).toEqual(summary)
  })

  it('should get summary range', async () => {
    const d1 = new Date('2026-02-01')
    const d2 = new Date('2026-02-02')
    const d3 = new Date('2026-02-03') // Missing

    const s1 = { date: '2026-02-01', generated_at: '', trends: [] }
    const s2 = { date: '2026-02-02', generated_at: '', trends: [] }

    await storage.saveDailySummary(d1, s1)
    await storage.saveDailySummary(d2, s2)

    const range = await storage.getSummaryRange(d1, d3)
    expect(range).toHaveLength(2)
    expect(range[0]).toEqual(s1)
    expect(range[1]).toEqual(s2)
  })

  it('should append and retrieve stream items', async () => {
    const d1 = new Date('2026-02-01T10:00:00Z')
    const item1 = { timestamp: d1.toISOString(), source_id: 's1', content: 'c1', url: 'u1' }
    
    // Append
    await storage.appendStreamItem(item1)
    
    // Verify file content directly
    const dailyDir = path.resolve(process.cwd(), testArchiveDir, '2026-02-01')
    const filePath = path.join(dailyDir, 'stream-buffer.jsonl')
    const content = await fs.readFile(filePath, 'utf8')
    expect(content).toContain(JSON.stringify(item1))

    // Retrieve
    const retrieved = await storage.getStreamItems(new Date('2026-02-01T09:00:00Z'))
    expect(retrieved).toHaveLength(1)
    expect(retrieved[0]).toEqual(item1)

    // Retrieve with future filter (should be empty)
    const empty = await storage.getStreamItems(new Date('2026-02-01T11:00:00Z'))
    expect(empty).toHaveLength(0)
  })
})
