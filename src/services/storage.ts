import fs from 'node:fs/promises'
import path from 'node:path'
import { format, eachDayOfInterval, isBefore, parseISO } from 'date-fns'
import type { DailyTrendSummary, StreamItem } from '../types/index.js'

export class StorageService {
  private archiveDir: string

  constructor(archiveDir: string = './archive') {
    this.archiveDir = path.resolve(process.cwd(), archiveDir)
  }

  private getDailyDir(date: Date = new Date()): string {
    return path.join(this.archiveDir, format(date, 'yyyy-MM-dd'))
  }

  async saveRootJson<T>(filename: string, data: T): Promise<void> {
    await fs.mkdir(this.archiveDir, { recursive: true })
    const filePath = path.join(this.archiveDir, filename)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  async loadRootJson<T>(filename: string): Promise<T | null> {
    const filePath = path.join(this.archiveDir, filename)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return JSON.parse(content) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async saveJson<T>(filename: string, data: T, date: Date = new Date()): Promise<void> {
    const dailyDir = this.getDailyDir(date)
    await fs.mkdir(dailyDir, { recursive: true })
    const filePath = path.join(dailyDir, filename)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8')
  }

  async saveText(filename: string, content: string, date: Date = new Date()): Promise<void> {
    const dailyDir = this.getDailyDir(date)
    await fs.mkdir(dailyDir, { recursive: true })
    const filePath = path.join(dailyDir, filename)
    await fs.writeFile(filePath, content, 'utf8')
  }

  async appendLog(filename: string, content: string, date: Date = new Date()): Promise<void> {
    const dailyDir = this.getDailyDir(date)
    await fs.mkdir(dailyDir, { recursive: true })
    const filePath = path.join(dailyDir, filename)
    const timestamp = new Date().toISOString()
    await fs.appendFile(filePath, `[${timestamp}] ${content}\n`, 'utf8')
  }

  private async appendLine(filename: string, content: string, date: Date): Promise<void> {
    const dailyDir = this.getDailyDir(date)
    await fs.mkdir(dailyDir, { recursive: true })
    const filePath = path.join(dailyDir, filename)
    await fs.appendFile(filePath, content + '\n', 'utf8')
  }

  async loadJson<T>(filename: string, date: Date = new Date()): Promise<T | null> {
    const filePath = path.join(this.getDailyDir(date), filename)
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return JSON.parse(content) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async exists(filename: string, date: Date = new Date()): Promise<boolean> {
    const filePath = path.join(this.getDailyDir(date), filename)
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  // -- Multi-Day Analysis Methods --

  async getDailySummary(date: Date): Promise<DailyTrendSummary | null> {
    return this.loadJson<DailyTrendSummary>('summary.json', date)
  }

  async saveDailySummary(date: Date, data: DailyTrendSummary): Promise<void> {
    await this.saveJson('summary.json', data, date)
  }

  async getSummaryRange(startDate: Date, endDate: Date): Promise<DailyTrendSummary[]> {
    if (isBefore(endDate, startDate)) return []
    
    const dates = eachDayOfInterval({ start: startDate, end: endDate })
    const results: DailyTrendSummary[] = []
    
    for (const date of dates) {
      const summary = await this.getDailySummary(date)
      if (summary) results.push(summary)
    }
    return results
  }

  async appendStreamItem(item: StreamItem): Promise<void> {
    const date = parseISO(item.timestamp)
    const line = JSON.stringify(item)
    await this.appendLine('stream-buffer.jsonl', line, date)
  }

  async getStreamItems(since: Date): Promise<StreamItem[]> {
    const now = new Date()
    if (isBefore(now, since)) return []

    const dates = eachDayOfInterval({ start: since, end: now })
    const allItems: StreamItem[] = []

    for (const date of dates) {
      const filePath = path.join(this.getDailyDir(date), 'stream-buffer.jsonl')
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const lines = content.split('\n').filter(line => line.trim())
        
        const dailyItems = lines.map(l => {
            try { return JSON.parse(l) as StreamItem } catch { return null }
        }).filter((i): i is StreamItem => i !== null)
        
        allItems.push(...dailyItems)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.error(`Failed to read stream buffer for ${date}:`, error)
        }
        // If file missing, just skip
      }
    }

    // Filter by timestamp
    const sinceIso = since.toISOString()
    return allItems.filter(item => item.timestamp >= sinceIso)
  }
}