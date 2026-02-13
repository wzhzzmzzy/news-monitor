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

  it('should get batches in range across dates', async () => {
    const d1 = new Date('2026-02-01T10:00:00Z')
    const d2 = new Date('2026-02-02T10:00:00Z')
    
    const b1 = [{ timestamp: d1.toISOString(), summary: 'b1', keyInfo: [] }]
    const b2 = [{ timestamp: d2.toISOString(), summary: 'b2', keyInfo: [] }]

    await storage.saveJson('keywords.json', b1, d1)
    await storage.saveJson('keywords.json', b2, d2)

    const range = await storage.getBatchesInRange(
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-02-02T23:59:59Z')
    )
    expect(range).toHaveLength(2)
    expect(range[0].summary).toBe('b1')
    expect(range[1].summary).toBe('b2')
  })

  it('should filter batches within a day based on specific hours', async () => {
    const day = new Date('2026-02-10')
    const batches = [
      { timestamp: '2026-02-10T08:00:00Z', summary: 'early', keyInfo: [] },
      { timestamp: '2026-02-10T12:00:00Z', summary: 'middle', keyInfo: [] },
      { timestamp: '2026-02-10T16:00:00Z', summary: 'late', keyInfo: [] },
    ]

    await storage.saveJson('keywords.json', batches, day)

    // Range from 10:00 to 14:00 - should only pick 'middle'
    const start = new Date('2026-02-10T10:00:00Z')
    const end = new Date('2026-02-10T14:00:00Z')

    const result = await storage.getBatchesInRange(start, end)
    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('middle')
  })

  it('should merge news index in range', async () => {
    const d1 = new Date('2026-02-01')
    const d2 = new Date('2026-02-02')
    
    const i1 = { 
      'n1': { id: 'n1', title: 'News 1', url: 'u1', sources: ['s1'], firstSeen: '2026-02-01T10:00:00Z', lastSeen: '2026-02-01T10:00:00Z', maxRank: 5, occurrences: 1 } 
    }
    const i2 = { 
      'n1': { id: 'n1', title: 'News 1', url: 'u1', sources: ['s1'], firstSeen: '2026-02-02T10:00:00Z', lastSeen: '2026-02-02T10:00:00Z', maxRank: 3, occurrences: 2 },
      'n2': { id: 'n2', title: 'News 2', url: 'u2', sources: ['s2'], firstSeen: '2026-02-02T10:00:00Z', lastSeen: '2026-02-02T10:00:00Z', maxRank: 10, occurrences: 1 }
    }

    await storage.saveJson('index.json', i1, d1)
    await storage.saveJson('index.json', i2, d2)

    const merged = await storage.getNewsIndexInRange(d1, d2)
    expect(Object.keys(merged)).toHaveLength(2)
    expect(merged['n1'].occurrences).toBe(3)
    expect(merged['n1'].maxRank).toBe(3)
    expect(merged['n1'].firstSeen).toBe('2026-02-01T10:00:00Z')
    expect(merged['n1'].lastSeen).toBe('2026-02-02T10:00:00Z')
  })
})
