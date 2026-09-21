import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { FeedItem } from './collect.js'

const entrySchema = z.object({ firstSeen: z.string(), lastSeen: z.string(), hash: z.string(), sourceIds: z.array(z.string()) })
const indexSchema = z.object({ version: z.literal(1), entries: z.record(entrySchema) })
export interface StoredItem extends FeedItem {
  firstSeen: string
  lastSeen: string
  sourceIds: string[]
  change: 'new' | 'updated' | 'seen'
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 })
  await fs.rename(temporary, file)
}

export class FeedStore {
  constructor(readonly directory: string) {}

  async withLock<T>(task: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.directory, { recursive: true })
    const lockPath = path.join(this.directory, '.lock')
    let lock
    try { lock = await fs.open(lockPath, 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Feed archive is locked; check for a running collector before removing a stale .lock')
      throw error
    }
    try {
      await lock.writeFile(String(process.pid))
      return await task()
    } finally {
      await lock.close()
      await fs.unlink(lockPath)
    }
  }

  async merge(items: FeedItem[]): Promise<StoredItem[]> {
    const indexFile = path.join(this.directory, 'index.json')
    let index: z.infer<typeof indexSchema> = { version: 1, entries: {} }
    try { index = indexSchema.parse(JSON.parse(await fs.readFile(indexFile, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const unique = new Map<string, StoredItem>()
    for (const item of items) {
      const existing = index.entries[item.id]
      const hash = createHash('sha256').update(JSON.stringify([item.title, item.content])).digest('hex')
      const entry = {
        firstSeen: existing?.firstSeen || item.fetchedAt, lastSeen: item.fetchedAt, hash,
        sourceIds: [...new Set([...(existing?.sourceIds || []), item.sourceId])],
      }
      const current = unique.get(item.id)
      const stored: StoredItem = {
        ...item, ...entry,
        change: current?.change || (!existing ? 'new' : existing.hash === hash ? 'seen' : 'updated'),
      }
      unique.set(item.id, stored)
      index.entries[item.id] = entry
      await writeJson(path.join(this.directory, 'items', `${createHash('sha256').update(item.id).digest('hex')}.json`), stored)
    }
    await writeJson(indexFile, index)
    return [...unique.values()]
  }
}
