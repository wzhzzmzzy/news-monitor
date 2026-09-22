import { z } from 'zod'

export const eventSchema = z.object({
  eventId: z.string().min(1).max(100), title: z.string().min(1).max(200),
  summary: z.string().min(1).max(3000), itemIds: z.array(z.string()).min(2).max(100),
})
export type NewsEvent = z.infer<typeof eventSchema>

// Sparse groups: unassigned news remains a standalone item. Never accept blog IDs.
export function indexEvents(events: NewsEvent[], newsIds: Set<string>) {
  const ids = new Set<string>(), byItem = new Map<string, NewsEvent>()
  for (const event of events) {
    if (ids.has(event.eventId)) throw new Error('Duplicate event IDs')
    ids.add(event.eventId)
    for (const id of event.itemIds) {
      if (!newsIds.has(id)) throw new Error('Unknown or blog event item IDs')
      if (byItem.has(id)) throw new Error('Overlapping event item IDs')
      byItem.set(id, event)
    }
  }
  return byItem
}
