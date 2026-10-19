import fs from 'node:fs/promises'
import vm from 'node:vm'
import { expect, it } from 'vitest'
import { parseHTML } from 'linkedom'
import { renderReaderHtml, readerStories } from './reader-html.js'
import type { ReaderReport } from './reader-data.js'
import type { ReadingItem } from './localize.js'

const item = (id: string, tier: 'picks' | 'other' | 'blogs', category: string, publishedAt: string) => ({ id, tier, category, publishedAt, title: `新闻 ${id}`, source: `来源 ${id}`, summary: `摘要 ${id}`, url: `https://example.com/${id}` })
const report: ReaderReport = { version: 'news-feed-reader-v1', date: '2026-10-08', edition: 'morning', cutoff: '2026-10-08T02:00:00Z', title: '今日早报', summary: '',
  sections: [{ kind: 'overview', title: '新闻', body: '事实 <img onerror=bad>', sources: [{ title: '来源', source: '媒体', before: false, url: 'https://example.com/a' }] }],
  items: [item('a', 'picks', 'AI', '2026-10-07T01:00:00Z'), item('b', 'other', '技术', '2026-10-08T01:00:00Z'), item('c', 'other', '商业', '2026-10-07T02:00:00Z'), item('blog', 'blogs', '人文', '2026-10-07T03:00:00Z')],
  events: [{ eventId: 'event', title: '合并事件', summary: '事件综述', itemIds: ['a', 'b'] }],
}
it('uses Koala template CSS and retains every event member, blog, raw body and safe citation offline', async () => {
  const evidence = report.items.map(i => ({ ...i, content: `原文 ${i.id} </script><script>bad()</script>` } as unknown as ReadingItem))
  const html = await renderReaderHtml(report, evidence)
  const css = (await fs.readFile(new URL('../../templates/news-feed.svelte', import.meta.url), 'utf8')).match(/<style>([\s\S]*?)<\/style>/)![1]
  expect(html).toContain(css)
  const { document } = parseHTML(html)
  expect(document.querySelector('h1')?.textContent).toBe(report.title)
  expect(document.querySelectorAll('script')).toHaveLength(1)
  expect(document.querySelectorAll('.citations a')).toHaveLength(1)
  expect(document.querySelector('.overview p')?.textContent).toBe('事实 <img onerror=bad>[1]')
  expect(new Set([...document.querySelectorAll('[data-original-id]')].map(e => e.getAttribute('data-original-id')))).toEqual(new Set(report.items.map(i => i.id)))
  expect(document.querySelector('[data-panel=timeline] .timeline-clock')?.textContent).toBe('09:00')
  expect(document.querySelector('[data-tab=timeline] span')?.textContent).toBe('2')
  expect(readerStories(report)[0]).toMatchObject({ id: 'a', title: '合并事件', tier: 'picks', publishedAt: '2026-10-08T01:00:00.000Z' })
})
it('switches tabs, searches related reports and filters their topics without fetching data', async () => {
  const { document, window } = parseHTML(await renderReaderHtml(report))
  vm.runInNewContext(document.querySelector('script')!.textContent!, { document })
  const click = (selector: string) => document.querySelector(selector)!.dispatchEvent(new window.Event('click'))
  const panel = (name: string) => document.querySelector(`[data-panel=${name}]`) as any
  expect(panel('picks').hidden).toBe(false)
  expect(panel('blogs').hidden).toBe(true)
  click('[data-tab=timeline]')
  expect(panel('timeline').hidden).toBe(false)
  const search = document.querySelector('#search') as any
  search.value = '来源 b'; search.dispatchEvent(new window.Event('input'))
  expect([...panel('timeline').querySelectorAll('[data-entry]')].filter((e: any) => !e.hidden)).toHaveLength(1)
  search.value = ''; search.dispatchEvent(new window.Event('input'))
  const topic = document.querySelector('#topic') as any
  // linkedom represents select.value as read-only; select the option like a user.
  topic.querySelector('option[value=技术]').selected = true
  topic.dispatchEvent(new window.Event('change'))
  expect([...panel('timeline').querySelectorAll('[data-entry]')].filter((e: any) => !e.hidden)).toHaveLength(1)
  click('[data-tab=blogs]')
  expect(panel('blogs').hidden).toBe(false)
  expect(topic.value).toBe('全部主题')
})
