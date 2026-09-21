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
function mount() {
  const html = renderFeed(items, [], '测试归档', undefined, undefined, editorial)
  const { document, window } = parseHTML(html)
  const location = { hash: '' }
  window.HTMLElement.prototype.scrollIntoView = () => {}
  runInNewContext(readerScript, { document, window, location })
  return { html, document, window, location }
}

it('opens the shortlist by default and supports tabs, topic filtering, search, reset and empty states', () => {
  const { document, window } = mount()
  expect(document.querySelector('#panel-picks')!.hasAttribute('hidden')).toBe(false)
  expect(document.querySelector('#panel-other')!.hasAttribute('hidden')).toBe(true)
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
  ;(document.querySelector('[data-topic="商业"]') as HTMLElement).click()
  expect(document.querySelector('#panel-picks [data-entry]')!.hasAttribute('hidden')).toBe(true)
  expect(document.querySelector('#panel-picks [data-empty]')!.hasAttribute('hidden')).toBe(false)
  ;(document.querySelector('#tab-other') as HTMLElement).click()
  expect(document.querySelector('#panel-other')!.hasAttribute('hidden')).toBe(false)
  const low = document.querySelector('#panel-other [data-entry]')!
  expect(low.tagName).toBe('DETAILS')
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
  document.querySelector('#tab-other')!.dispatchEvent(key)
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
})

it('follows duplicate-event links across tabs and clears filters to reveal the primary story', () => {
  const { document, window, location } = mount()
  ;(document.querySelector('#tab-other') as HTMLElement).click()
  ;(document.querySelector('[data-topic="商业"]') as HTMLElement).click()
  const target = document.querySelector('#panel-picks [data-entry]')!
  location.hash = '#' + target.id
  window.dispatchEvent(new window.Event('hashchange'))
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
  expect(target.hasAttribute('hidden')).toBe(false)
  expect(document.querySelector('[data-topic="全部"]')!.getAttribute('aria-pressed')).toBe('true')
  ;(document.querySelector('#tab-other') as HTMLElement).click()
  ;(document.querySelector('#panel-other .why a') as HTMLElement).click()
  expect(document.querySelector('#tab-picks')!.getAttribute('aria-selected')).toBe('true')
})

it('retains every item without JavaScript and gives email a script-free sequential reading layout', () => {
  const html = renderFeed(items, [], '归档', undefined, undefined, editorial)
  const { document } = parseHTML(html)
  expect(document.querySelectorAll('[data-entry]')).toHaveLength(3)
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
