import fs from 'node:fs/promises'
import type { ReaderReport } from './reader-data.js'
import { safeUrl } from './reader-data.js'
import type { ReadingItem } from './localize.js'
import type { SourceResult } from './collect.js'

type Item = ReaderReport['items'][number]
type Story = Item & { members?: Item[] }
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const link = (url: string, label: string) => safeUrl(url) ? `<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : escape(label)
const stamp = (item: Item) => item.publishedAt && Number.isFinite(Date.parse(item.publishedAt)) ? Date.parse(item.publishedAt) : null
const rowId = (id: string) => `timeline-item-${encodeURIComponent(id)}`
const editionNames = { morning: '早报', evening: '晚报', custom: '时段报告' }

// Match the public Koala reader's event order, primary story and latest timestamp.
export function readerStories(report: ReaderReport): Story[] {
  const byId = new Map(report.items.map(item => [item.id, item]))
  const byItem = new Map((report.events || []).flatMap(event => event.itemIds.map(id => [id, event] as const)))
  const seen = new Set<string>()
  return report.items.flatMap(item => {
    const event = byItem.get(item.id)
    if (!event) return [item]
    if (seen.has(event.eventId)) return []
    seen.add(event.eventId)
    const members = event.itemIds.map(id => byId.get(id)!)
    const primary = members.find(member => member.tier === 'picks') || members[0]
    const times = members.map(stamp).filter((time): time is number => time !== null)
    return [{ ...primary, title: event.title, summary: event.summary, source: [...new Set(members.map(member => member.source))].join(' · '), publishedAt: times.length ? new Date(Math.max(...times)).toISOString() : null, members }]
  })
}

export const standaloneReaderScript = `(() => {
 const tabs = [...document.querySelectorAll('[data-tab]')];
 const panels = [...document.querySelectorAll('[data-panel]')];
 const search = document.querySelector('#search');
 const topic = document.querySelector('#topic');
 let active = 'picks';
 function topics() {
  const values = [...new Set([...document.querySelector('[data-panel="'+active+'"]').querySelectorAll('[data-entry]')].flatMap(entry => entry.dataset.categories.split('|')))];
  topic.replaceChildren(...['全部主题', ...values].map(value => { const option = document.createElement('option'); option.value = option.textContent = value; option.selected = value === '全部主题'; return option; }));
 }
 function update() {
  const query = search.value.trim().toLowerCase();
  tabs.forEach(tab => { const on = tab.dataset.tab === active; tab.classList.toggle('active', on); tab.setAttribute('aria-pressed', String(on)); });
  panels.forEach(panel => {
   panel.hidden = panel.dataset.panel !== active;
   let count = 0;
   panel.querySelectorAll('[data-entry]').forEach(entry => { const show = (topic.value === '全部主题' || entry.dataset.categories.split('|').includes(topic.value)) && entry.dataset.search.toLowerCase().includes(query); entry.hidden = !show; if (show) count++; });
   panel.querySelector('[data-empty]').hidden = count !== 0;
   panel.querySelectorAll('[data-timeline-group]').forEach(group => { group.hidden = [...group.querySelectorAll('[data-entry]')].every(entry => entry.hidden); });
  });
  document.querySelectorAll('[data-jump]').forEach(button => { const target = document.getElementById(button.dataset.jump); button.hidden = !target || target.hidden || !!target.closest('[data-timeline-group][hidden]'); });
 }
 tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { active = tab.dataset.tab; topics(); update(); });
  tab.addEventListener('keydown', event => { const next = event.key === 'ArrowRight' ? (index+1)%tabs.length : event.key === 'ArrowLeft' ? (index+tabs.length-1)%tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : undefined; if (next !== undefined) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); } });
 });
 search.addEventListener('input', update); topic.addEventListener('change', update);
 document.querySelectorAll('[data-jump]').forEach(button => button.addEventListener('click', () => { const target = document.getElementById(button.dataset.jump); const day = target?.closest('details'); if (day) day.open = true; target?.focus({preventScroll:true}); target?.scrollIntoView({block:'start'}); }));
 topics(); update();
})();`

/** The Svelte reader owns the CSS; standalone HTML only supplies its offline data and controls. */
export async function renderReaderHtml(report: ReaderReport, evidence: ReadingItem[] = [], email = false, sources: SourceResult[] = []): Promise<string> {
  const template = await fs.readFile(new URL('../../templates/news-feed.svelte', import.meta.url), 'utf8')
  const css = template.match(/<style>([\s\S]*?)<\/style>/)?.[1]
  if (!css) throw new Error('Koala reader template has no stylesheet')
  const stories = readerStories(report)
  const raw = new Map(evidence.map(item => [item.id, item]))
  const original = (item: Item) => {
    const source = raw.get(item.id)
    if (!source) return ''
    const chinese = source.chinese
    const translated = chinese?.translated && chinese.contentZh ? `<details class="source-text"><summary>完整中文译文</summary><div class="source-body">${escape(chinese.contentZh)}</div></details>` : ''
    return `${translated}<details class="source-text" data-original-id="${escape(item.id)}"><summary>查看采集原文</summary><div class="source-body">${escape(source.content || '来源未提供正文')}</div>${source.discussionUrl ? link(source.discussionUrl, '查看讨论 ↗') : ''}</details>`
  }
  const related = (item: Story) => item.members ? `<details class="event-reports"><summary>展开 ${item.members.length} 篇相关报道</summary><ol>${item.members.map(member => `<li data-event-member="${escape(member.id)}">${link(member.url, member.title)}<div class="event-source">${escape(member.source)} · ${stamp(member) === null ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(member.publishedAt!))}</div><p>${escape(member.summary || '中文摘要待处理。')}</p>${original(member)}</li>`).join('')}</ol></details>` : original(item)
  const attrs = (item: Story) => `data-entry="${escape(item.id)}" data-categories="${escape([...new Set([item, ...(item.members || [])].map(member => member.category))].join('|'))}" data-search="${escape([item, ...(item.members || [])].map(member => `${member.title} ${member.summary || ''} ${member.source}`).join(' '))}"`
  const summary = (item: Item) => escape(item.summary || (raw.get(item.id)?.chineseStatus === 'failed' ? '中文摘要生成失败，请展开采集原文核对。' : '中文摘要待处理。'))
  const picks = stories.filter(item => item.tier === 'picks')
  const blogs = stories.filter(item => item.tier === 'blogs')
  const news = stories.filter(item => item.tier !== 'blogs').sort((a, b) => (stamp(b) ?? -Infinity) - (stamp(a) ?? -Infinity) || a.id.localeCompare(b.id))
  const groups = new Map<string, Story[]>()
  for (const item of news) {
    const time = stamp(item)
    const date = time === null ? 'unknown' : new Date(time + 8 * 3600000).toISOString().slice(0, 10)
    groups.set(date, [...(groups.get(date) || []), item])
  }
  const index = [...groups].map(([date, items]) => {
    const hours = new Map<string, string>()
    for (const item of items) { const time = stamp(item); if (time !== null) { const hour = new Date(time + 8 * 3600000).toISOString().slice(11, 13); if (!hours.has(hour)) hours.set(hour, rowId(item.id)) } }
    return `<div class="index-day"><button class="index-date" data-jump="timeline-date-${date}">${date === 'unknown' ? '时间未知' : date.slice(5).replace('-', ' / ')}</button><div class="index-hours">${[...hours].map(([hour, id]) => `<button data-jump="${escape(id)}">${hour}:00</button>`).join('')}</div></div>`
  }).join('')
  const timeline = [...groups].map(([date, items]) => {
    const label = date === 'unknown' ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(items[0].publishedAt!))
    const weekday = date === 'unknown' ? '' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', weekday: 'long' }).format(new Date(items[0].publishedAt!))
    return `<details class="timeline-day" data-timeline-group open><summary id="timeline-date-${date}" tabindex="-1" class="timeline-day-heading"><span>${label}</span><small>${weekday}${weekday ? ' · ' : ''}${items.length} 条</small></summary><ol class="timeline-list">${items.map(item => `<li id="${escape(rowId(item.id))}" tabindex="-1" class="timeline-row" ${attrs(item)}><time class="timeline-clock"${item.publishedAt ? ` datetime="${escape(item.publishedAt)}"` : ''}>${stamp(item) === null ? '—' : new Date(stamp(item)! + 8 * 3600000).toISOString().slice(11, 16)}</time><article class="timeline-card"><div class="timeline-meta"><span>${escape(item.source)}</span><span class="timeline-topic">${escape(item.category)}</span>${item.tier === 'picks' ? '<span class="timeline-picked">精选</span>' : ''}</div><h3>${link(item.url, item.title)}</h3><p>${summary(item)}</p>${related(item)}</article></li>`).join('')}</ol></details>`
  }).join('')
  let number = 0
  const kinds: Record<string, string> = { new: '新增', update: '进展', correction: '更正', watch: '观察' }
  const overview = report.sections.length ? `<section class="overview" aria-labelledby="overview-heading"><h2 id="overview-heading" class="overview-heading">新闻综述</h2><ol class="overview-list">${report.sections.map(section => `<li>${section.kind !== 'overview' ? `<h3><span>${kinds[section.kind] || ''}</span> ${escape(section.title)}</h3>` : ''}<p>${escape(section.body)}<sup class="citations">${section.sources.map(citation => { const label = `${citation.before ? '早前：' : ''}${citation.source} · ${citation.title}`; const n = ++number; return safeUrl(citation.url) ? `<a href="${escape(safeUrl(citation.url))}" target="_blank" rel="noopener noreferrer" title="${escape(label)}" aria-label="参考来源 ${n}：${escape(label)}">[${n}]</a>` : `<span title="${escape(label)}">[${n}]</span>` }).join('')}</sup></p></li>`).join('')}</ol></section>` : ''
  const operations = sources.length ? `<details class="reader-operations"><summary>来源与处理记录 · ${sources.filter(source => source.status === 'ok').length} 个来源可用${sources.some(source => source.status === 'failed') ? ' · 有来源采集失败' : ''}</summary><ul>${sources.map(source => `<li>${escape(source.sourceName)} · ${source.status === 'ok' ? `成功 ${source.count} 条` : source.status === 'failed' ? '采集失败' : '已停用'} · ${escape(source.note)}</li>`).join('')}</ul></details>` : ''
  const empty = '<p class="empty" data-empty hidden>没有匹配的内容。</p>'
  const panels = `<section class="stories" data-panel="picks" aria-label="精选">${picks.map(item => `<article class="pick" ${attrs(item)}><div class="meta"><span>${escape(item.category)}</span> ${escape(item.source)}</div><h2>${link(item.url, item.title)}</h2><p>${summary(item)}</p>${related(item)}</article>`).join('')}${empty}</section><section class="stories" data-panel="blogs" aria-label="博客">${blogs.map(item => `<details ${attrs(item)}><summary><span class="story-title">${escape(item.title)}</span><span class="source">${escape(item.source)}</span></summary><div class="detail"><p>${summary(item)}</p>${link(item.url, '阅读原文 ↗')}${original(item)}</div></details>`).join('')}${empty}</section><section class="stories" data-panel="timeline" aria-label="时间线"><p class="timeline-note">发布时间 · 北京时间${report.events?.length ? '；合并事件按最新报道排序' : ''}</p><div class="timeline-layout"><aside class="timeline-index"><nav aria-label="时间快速定位"><p class="index-label">快速定位</p>${index}</nav></aside><div class="timeline">${timeline}</div></div>${empty}</section>`
  const base = `:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:#eff1f5}main{max-width:840px;margin:0 auto;padding:28px 20px 0}h1,h2,h3,p,ol{margin:0}button,input,select{padding:0}button{border-radius:0}[hidden]{display:none!important}.source-text{margin-top:12px;border:0}.source-text>summary{font-size:11px;padding:4px 0;color:var(--muted)}.source-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.9;padding:12px 0}.source-text a{font-size:12px;color:var(--accent)}.refresh{font-size:12px}.reader-operations{margin-top:28px;font-size:11px;color:var(--muted)}.reader-operations>summary{font-size:11px}.reader-operations ul{padding-left:20px}.reader-footer{font-size:11px;color:var(--muted);margin:28px 0 0;padding-top:16px;border-top:1px solid var(--line)}@media(prefers-color-scheme:dark){body{background:#303446}}@media print{body{background:white}.toolbar,.tabs,.filters,.timeline-index{display:none!important}[data-panel][hidden],[data-entry][hidden]{display:block!important}.timeline-layout{display:block}.timeline-card{break-inside:avoid}}`
  // Koala's host CSS overrides reader heading fonts, links and disclosure borders.
  const host = `.reader{--host-link:#1e66f5;--host-border:#8c8fa1;--host-summary:#6c6f85}.reader h1,.reader h2,.reader h3{font-family:'PingFang SC',Tahoma,'Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK','Noto Sans',sans-serif}.reader.reader a{color:var(--host-link)}.reader details{padding:10px;border:1px solid var(--host-border);border-radius:10px;margin-bottom:5px}.reader details[open]>summary{color:var(--host-summary)}.reader .source-text{border:0;padding:0}.reader .source-text[open]>summary{color:var(--muted)}@media(prefers-color-scheme:dark){.reader{--host-link:#8caaee;--host-border:#838ba7;--host-summary:#a5adce}}`
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="每日自动更新的 RSS、X、HN 新闻汇总"><title>${escape(report.title)}</title><style>${base}\n${css}\n${host}</style></head><body><main><div class="reader"><p class="page-description">每日自动更新的 RSS、X、HN 新闻汇总</p><div class="toolbar"><label class="date">日期 <input type="date" value="${report.date}" readonly aria-label="报告日期"></label><div class="editions" aria-label="选择报告"><button class="chosen" aria-pressed="true">${editionNames[report.edition]}</button></div><a class="refresh" href="https://koala.wzhzzmzzy.workers.dev/news-feed" target="_blank" rel="noopener noreferrer">最新一期 ↗</a></div><header><div class="dateline">${report.date.replaceAll('-', ' / ')} <span>北京时间 · ${editionNames[report.edition]}</span></div><h1>${escape(report.title)}</h1></header>${report.summary.trim() ? `<p class="report-note">${escape(report.summary)}</p>` : ''}${overview}<nav class="tabs" aria-label="阅读分类">${[['picks', '精选', picks.length], ['blogs', '博客', blogs.length], ['timeline', '时间线', news.length]].map(([id, label, count]) => `<button data-tab="${id}" aria-pressed="${id === 'picks'}"${id === 'picks' ? ' class="active"' : ''}>${label}<span>${count}</span></button>`).join('')}</nav><div class="filters"><input id="search" type="search" placeholder="搜索标题、摘要、来源" aria-label="搜索新闻"><select id="topic" aria-label="主题"><option>全部主题</option></select></div>${panels}${operations}<p class="reader-footer">中文标题与摘要由配置的模型生成；精选与新闻综述由 Agent 编写。采集原文保留供核对；RSS 内容可能只有简介，社区链接未必包含外链正文。</p></div></main>${email ? '' : `<script>${standaloneReaderScript}</script>`}</body></html>`.replace(/\r\n?/g, '\n')
}
