import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'
import { expect, it } from 'vitest'
import { renderFeed, readerScript } from './view.js'
import type { ReadingItem } from './localize.js'
import type { Curation } from './curate.js'

const items: ReadingItem[] = [0, 1, 2].map(id => ({
  id: String(id), title: `Original ${id}`, sourceId: 'rss', sourceName: 'Source', category: id === 2 ? '商业' : '技术',
  content: `Body ${id}`, contentKind: 'feed-content', url: `https://example.com/${id}`, fetchedAt: '', firstSeen: '', lastSeen: '', sourceIds: ['rss'], change: 'new', raw: {},
  chinese: { version: 'zh-reading-v1', fingerprint: '', model: 'test', processedAt: '', chunks: 1, translated: true, titleZh: `新闻 ${id}`, contentZh: `中文正文 ${id}`, summaryZh: `核心摘要 ${id}` },
}))
const editorial: Curation = { status: 'ready', total: 3, selected: 1, reading: 1, other: 1, cached: 0, entries: {
  '0': { score: 90, topic: '技术', reason: '独立研究带来新发现。', tier: 'picks', rank: 1 },
  '1': { score: 70, topic: '人文', reason: '可补充对话题的理解。', tier: 'reading' },
  '2': { score: 40, topic: '商业', reason: '同一事件重复跟进。', tier: 'other', duplicateOf: '0' },
} }
function mount(input = items) {
  const html = renderFeed(input, [], '测试归档', undefined, undefined, editorial)
  const { document, window } = parseHTML(html)
  const location = { hash: '' }
  window.HTMLElement.prototype.scrollIntoView = () => {}
  runInNewContext(readerScript, { document, window, location })
  return { html, document, window, location }
}

it('navigates and searches the second blog tab while keeping blogs out of ranked groups', () => {
  const blog = { ...items[0], id: 'blog', channel: 'blogs' as const, publishedAt: '2026-09-22T01:00:00Z' }
  const { document, window } = mount([...items, blog])
  const key = new window.Event('keydown'); Object.assign(key, { key: 'ArrowRight' })
  document.querySelector('#tab-picks')!.dispatchEvent(key)
  expect(document.querySelector('#tab-blogs')!.getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('#panel-blogs')!.hasAttribute('hidden')).toBe(false)
  expect(document.querySelectorAll('#panel-blogs [data-entry]')).toHaveLength(1)
  const input = document.querySelector('#search') as HTMLInputElement
  input.value = 'not-found'; input.dispatchEvent(new window.Event('input'))
  expect(document.querySelector('#panel-blogs [data-entry]')!.hasAttribute('hidden')).toBe(true)
  ;(document.querySelector('#clear-filters') as HTMLElement).click()
  expect(document.querySelector('#panel-blogs [data-entry]')!.hasAttribute('hidden')).toBe(false)
})

it('opens the shortlist by default and supports tabs, topic filtering, search, reset and empty states', () => {
  const { document, window } = mount()
  expect(document.querySelector('#panel-picks')!.hasAttribute('hidden')).toBe(false)
  expect(document.querySelector('#panel-timeline')!.hasAttribute('hidden')).toBe(true)
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
  ;(document.querySelector('[data-topic="商业"]') as HTMLElement).click()
  expect(document.querySelector('#panel-picks [data-entry]')!.hasAttribute('hidden')).toBe(true)
  expect(document.querySelector('#panel-picks [data-empty]')!.hasAttribute('hidden')).toBe(false)
  ;(document.querySelector('#tab-timeline') as HTMLElement).click()
  expect(document.querySelector('#panel-timeline')!.hasAttribute('hidden')).toBe(false)
  const low = document.querySelector('#panel-timeline [data-category="商业"]')!
  expect(low.tagName).toBe('ARTICLE')
  expect(low.hasAttribute('open')).toBe(false)
  const input = document.querySelector('#search') as HTMLInputElement
  input.value = 'not-found'
  input.dispatchEvent(new window.Event('input'))
  expect(low.hasAttribute('hidden')).toBe(true)
  ;(document.querySelector('#clear-filters') as HTMLElement).click()
  expect(input.value).toBe('')
  expect(low.hasAttribute('hidden')).toBe(false)
  const key = new window.Event('keydown')
  Object.assign(key, { key: 'Home' })
  document.querySelector('#tab-timeline')!.dispatchEvent(key)
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
})

it('follows duplicate-event links across tabs and clears filters to reveal the primary story', () => {
  const { document, window, location } = mount()
  ;(document.querySelector('#tab-timeline') as HTMLElement).click()
  ;(document.querySelector('[data-topic="商业"]') as HTMLElement).click()
  const target = document.querySelector('#panel-picks [data-entry]')!
  location.hash = '#' + target.id
  window.dispatchEvent(new window.Event('hashchange'))
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
  expect(target.hasAttribute('hidden')).toBe(false)
  expect(document.querySelector('[data-topic="全部"]')!.getAttribute('aria-pressed')).toBe('true')
  ;(document.querySelector('#tab-timeline') as HTMLElement).click()
  ;(document.querySelector('#panel-timeline .why a') as HTMLElement).click()
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
})

it('retains every item without JavaScript and gives email a script-free sequential reading layout', () => {
  const html = renderFeed(items, [], '归档', undefined, undefined, editorial)
  const { document } = parseHTML(html)
  expect(document.querySelectorAll('[data-entry]')).toHaveLength(4)
  expect(new Set([...document.querySelectorAll('[data-entry]')].map(e => e.id)).size).toBe(4)
  expect([...document.querySelectorAll('[data-panel]')].every(p => !p.hasAttribute('hidden'))).toBe(true)
  expect(document.querySelectorAll('script')).toHaveLength(1)
  expect(document.querySelector('script')!.textContent).toBe(readerScript)
  const email = parseHTML(renderFeed(items, [], '归档', undefined, undefined, editorial, { email: true })).document
  expect(email.querySelectorAll('script')).toHaveLength(0)
  expect(email.querySelectorAll('article[data-entry]')).toHaveLength(3)
  expect(email.querySelectorAll('[data-controls]')).toHaveLength(0)
})

it('escapes model and source text without interpolating it into the executable script', () => {
  const unsafe = '</script><script>alert(1)</script>'
  const bad = { ...items[0], title: unsafe, url: 'javascript:alert(1)', chinese: { ...items[0].chinese!, titleZh: unsafe, summaryZh: unsafe } }
  const { document } = parseHTML(renderFeed([bad], [], unsafe, undefined, undefined, editorial))
  expect(document.querySelectorAll('script')).toHaveLength(1)
  expect(document.querySelector('script')!.textContent).toBe(readerScript)
  expect(document.querySelector('a[href^="javascript:"]')).toBeNull()
  expect(document.querySelector('.headline')!.textContent).toContain(unsafe)
})

 it('orders the timeline by publication time, groups Beijing dates and leaves unknown times last', () => {
  const input = items.map((item, index) => ({...item, publishedAt: ['2026-09-21T16:30:00Z', '2026-09-21T15:30:00Z', 'invalid'][index]}))
  const { document, window } = mount(input)
  ;(document.querySelector('#tab-timeline') as HTMLElement).click()
  expect([...document.querySelectorAll('#panel-timeline time')].map(e => e.textContent)).toEqual(['00:30', '23:30', '—'])
  expect([...document.querySelectorAll('.timeline-date')].map(e => e.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('2026-09-22'), expect.stringContaining('2026-09-21'), expect.stringContaining('时间未知')]))
  const search = document.querySelector('#search') as HTMLInputElement
  search.value = '新闻 1'; search.dispatchEvent(new window.Event('input'))
  expect([...document.querySelectorAll('[data-timeline-group]')].filter(e => !e.hasAttribute('hidden'))).toHaveLength(1)
 })
