import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StorageService } from './storage.js';

describe('StorageService Performance Benchmark', () => {
  const benchArchiveDir = './tmp-bench-archive';
  let storage: StorageService;

  beforeEach(async () => {
    storage = new StorageService(benchArchiveDir);
    await fs.mkdir(path.resolve(process.cwd(), benchArchiveDir), { recursive: true });

    // Seed data: 7 days, 24 batches per day
    for (let i = 0; i < 7; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      
      const batches = Array.from({ length: 24 }, (_, j) => ({
        timestamp: new Date(date.getFullYear(), date.getMonth(), date.getDate(), j).toISOString(),
        summary: `Summary ${i}-${j}`,
        keyInfo: Array.from({ length: 10 }, (_, k) => ({
          topic: `Topic ${k}`,
          entities: [],
          heatScore: 50,
          category: 'test',
          newsIds: [`n-${i}-${j}-${k}`]
        }))
      }));
      await storage.saveJson('keywords.json', batches, date);

      const index = Object.fromEntries(
        Array.from({ length: 240 }, (_, j) => [
          `n-${i}-${Math.floor(j/10)}-${j%10}`,
          { 
            id: `n-${i}-${Math.floor(j/10)}-${j%10}`, 
            title: 'News Title', 
            url: 'http://example.com', 
            sources: ['src'], 
            firstSeen: new Date().toISOString(), 
            lastSeen: new Date().toISOString(), 
            maxRank: 1, 
            occurrences: 1 
          }
        ])
      );
      await storage.saveJson('index.json', index, date);
    }
  });

  afterEach(async () => {
    await fs.rm(path.resolve(process.cwd(), benchArchiveDir), { recursive: true, force: true });
  });

  it('should aggregate 7 days of data within 2 seconds', async () => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);

    const startTime = Date.now();
    
    const [batches, index] = await Promise.all([
      storage.getBatchesInRange(start, end),
      storage.getNewsIndexInRange(start, end)
    ]);

    const duration = Date.now() - startTime;
    console.log(`Aggregation took ${duration}ms`);

    expect(batches.length).toBeGreaterThanOrEqual(7 * 24);
    expect(Object.keys(index).length).toBeGreaterThanOrEqual(7 * 240);
    expect(duration).toBeLessThan(2000);
  });
});
