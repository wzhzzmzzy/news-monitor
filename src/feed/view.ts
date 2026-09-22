import { createHash } from 'node:crypto'
import type { Digest } from './report.js'
import type { SourceResult } from './collect.js'
import type { ReadingItem, LocalizationStats } from './localize.js'
import type { Curation } from './curate.js'
import { readingTopic } from './topics.js'
import { isBlog } from './blogs.js'

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const safeLink = (url: string) => /^https?:\/\//i.test(url) ? escape(url) : undefined
const anchor = (id: string) => `item-${createHash('sha256').update(id).digest('hex').slice(0, 16)}`
const contentNames = { 'feed-content': 'RSS 内容 · 全文未核验', 'feed-summary': 'RSS 摘要', 'link-metadata': '社区链接与讨论信息 · 外链正文未采集', 'title-only': '仅标题', post: 'X 帖子原文' }
const itemLink = (item: ReadingItem, label: string) => safeLink(item.url) ? `<a href="${safeLink(item.url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>` : `${escape(label)}（来源未提供文章链接）`

export const readerScript = `(() => {
 const tabs = [...document.querySelectorAll('[data-tab]')];
 const panels = [...document.querySelectorAll('[data-panel]')];
 const filters = [...document.querySelectorAll('[data-topic]')];
 const search = document.querySelector('#search');
 let active = document.body.dataset.initial;
 let topic = '全部';
 function update() {
  const query = search.value.trim().toLocaleLowerCase();
  tabs.forEach(tab => { const on = tab.dataset.tab === active; tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1; });
  panels.forEach(panel => {
   panel.hidden = panel.dataset.panel !== active;
   let visible = 0;
   const entries = [...panel.querySelectorAll('[data-entry]')];
   entries.forEach(entry => { const show = (topic === '全部' || entry.dataset.category === topic) && (!query || entry.dataset.search.toLocaleLowerCase().includes(query)); entry.hidden = !show; if (show) visible++; });
   panel.querySelector('[data-empty]').hidden = visible !== 0;
  });
  filters.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.topic === topic)));
 }
 tabs.forEach((tab,index) => {
  tab.addEventListener('click', () => { active = tab.dataset.tab; update(); });
  tab.addEventListener('keydown', event => {
   let next;
   if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
   if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
   if (event.key === 'Home') next = 0;
   if (event.key === 'End') next = tabs.length - 1;
   if (next !== undefined) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
  });
 });
 filters.forEach(button => button.addEventListener('click', () => { topic = button.dataset.topic; update(); }));
 search.addEventListener('input', update);
 document.querySelector('#clear-filters').addEventListener('click', () => { topic = '全部'; search.value = ''; update(); });
 function revealHash() {
  if (!location.hash.startsWith('#item-')) return;
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  active = target.closest('[data-panel]').dataset.panel; topic = '全部'; search.value = ''; update();
  if (target.tagName === 'DETAILS') target.open = true;
  target.focus({preventScroll:true}); target.scrollIntoView({block:'start'});
 }
 document.querySelectorAll('[data-controls]').forEach(el => el.hidden = false);
 document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href^="#item-"]');
  if (link && link.getAttribute('href') === location.hash) { event.preventDefault(); revealHash(); }
 });
 update(); revealHash(); window.addEventListener('hashchange', revealHash);
})();`

const styles = `
:root{color-scheme:light;--paper:#f6f5ee;--ink:#263a32;--muted:#6a7269;--line:#d7dacd;--accent:#396348;--wash:#e9eddf}
*{box-sizing:border-box}[hidden]{display:none!important}html{scroll-behavior:smooth;scroll-padding-top:24px}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.8 "PingFang SC","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}main{max-width:1160px;padding:30px 48px 60px;margin:auto}a{color:inherit;text-decoration-thickness:1px;text-underline-offset:5px}a:hover{color:var(--accent)}button,input{font:inherit}button{cursor:pointer}a,button,input,summary{transition:background .18s,color .18s}button:active{transform:translateY(1px)}:focus-visible{outline:2px solid var(--accent);outline-offset:5px}.skip{position:absolute;top:-100px}.skip:focus{top:8px;background:var(--paper);z-index:2}.masthead{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--ink);padding-bottom:16px;gap:24px}.brand{font:600 16px/1.4 Georgia,serif;letter-spacing:.15em}.edition{font-size:12px;color:var(--muted);text-align:right}.hero{display:grid;grid-template-columns:minmax(0,1fr) 260px;gap:64px;padding:45px 0 34px}.eyebrow{font-size:12px;letter-spacing:.12em;color:var(--accent);margin:0 0 16px}h1{font:500 clamp(36px,5vw,58px)/1.16 "Songti SC","STSong",Georgia,serif;letter-spacing:-.03em;margin:0 0 20px}h2,h3,p{margin-top:0}.intro{color:var(--muted);max-width:42em;margin-bottom:0}.guide{border-left:1px solid var(--line);padding-left:28px;align-self:center;font-size:13px}.guide strong{display:block;font-weight:600;margin-bottom:6px}.guide p{color:var(--muted);margin:0 0 13px}.metric{font:32px/1.1 Georgia,serif;font-variant-numeric:tabular-nums;color:var(--accent)}.metric small{font:12px/1.5 "PingFang SC",sans-serif;color:var(--muted);margin-left:7px}.tabs{display:flex;overflow-x:auto;gap:28px;border-bottom:1px solid var(--line)}.tab{border:0;background:none;padding:16px 0;color:var(--muted);border-bottom:3px solid transparent;white-space:nowrap;font-weight:500}.tab[aria-selected=true]{border-bottom-color:var(--accent);color:var(--ink)}.tab span{font:12px/1 monospace;background:var(--wash);padding:3px 6px;margin-left:8px}.toolbar{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:20px 0 8px;flex-wrap:wrap}.filters{display:flex;gap:6px;flex-wrap:wrap}.filter{border:0;background:transparent;color:var(--muted);font-size:13px;padding:5px 12px;border-radius:3px}.filter[aria-pressed=true]{background:var(--wash);color:var(--accent)}.filter:hover{background:#e0e6d6}.searchbox{display:flex;gap:10px;align-items:center}.searchbox input{width:220px;max-width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;padding:6px 2px;border-radius:0;font-size:13px}.searchbox button{background:none;border:0;color:var(--muted);font-size:12px}.panel{padding-top:8px}.sectionhead{display:flex;justify-content:space-between;gap:20px;align-items:baseline;margin-bottom:4px}.sectionhead h2{font-size:14px;font-weight:500;color:var(--muted);margin:0}.sectionhead span{font:12px/1.5 monospace;color:var(--muted)}.entry{border-bottom:1px solid var(--line);padding:29px 0;scroll-margin-top:24px}.entry.featured{padding:30px 32px;margin:18px 0 0;background:var(--wash);border-bottom:0}.article-grid{display:grid;grid-template-columns:36px minmax(0,1fr);gap:17px}.number{font:italic 22px/1.5 Georgia,serif;color:#84947b}.kicker{font-size:12px;color:var(--muted);margin-bottom:10px;display:flex;gap:12px;flex-wrap:wrap}.kicker .category{color:var(--accent);font-weight:600}.headline{font-size:22px;line-height:1.55;font-weight:600;text-wrap:pretty;margin:0 0 12px;max-width:38em}.headline a{text-decoration:none}.headline a:hover{text-decoration:underline}.featured .headline{font:500 30px/1.5 "Songti SC","STSong",Georgia,serif;max-width:29em}.core{font-size:16px;line-height:1.95;max-width:49em;margin-bottom:14px;color:#39453d}.why{font-size:13px;color:var(--accent);max-width:58em;margin:0 0 13px}.why b{font-weight:500;margin-right:9px}.meta{color:var(--muted);font-size:12px;margin:9px 0}.body{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.95;font-size:15px;max-width:54em;padding:16px 0}.body h3{font-size:17px}.text-details{margin:10px 0}.text-details summary,.operations>summary{font-size:13px;color:var(--muted);cursor:pointer}.text-details[open]>summary{color:var(--accent)}.other-entry>summary{cursor:pointer;display:flex;gap:20px;align-items:baseline;list-style:none}.other-entry>summary::-webkit-details-marker{display:none}.other-entry>summary:after{content:'+';margin-left:auto;color:var(--muted)}.other-entry[open]>summary:after{content:'−'}.other-entry .headline{font-size:17px;margin:0}.other-entry .category{font-size:12px;color:var(--muted);min-width:30px}.other-content{padding:18px 0 0 50px}.empty{padding:50px 0;color:var(--muted)}.operations{border-top:1px solid var(--line);margin-top:42px;padding-top:20px}.operations ul{padding-left:20px;font-size:12px;color:var(--muted)}footer{font-size:12px;color:var(--muted);margin-top:28px;max-width:70em}.pending{color:#825f33}.extra-analysis{margin:25px 0;padding:20px;background:var(--wash)}.extra-analysis h3{font-size:18px}.no-script{font-size:13px;color:var(--muted)}
@media(max-width:700px){main{padding:20px 20px 40px}.hero{grid-template-columns:1fr;gap:22px;padding:30px 0 22px}.guide{border-left:0;border-top:1px solid var(--line);padding:16px 0 0;display:flex;gap:20px;align-items:baseline}.guide .criteria{display:none}.tabs{gap:20px}.tab{font-size:14px}.tab span{margin-left:4px}.toolbar{align-items:flex-start}.searchbox{width:100%}.searchbox input{flex:1;width:auto}.headline{font-size:20px}.featured .headline{font-size:25px}.entry.featured{padding:22px 18px}.article-grid{grid-template-columns:24px minmax(0,1fr);gap:10px}.core{font-size:15px}.other-content{padding-left:0}.edition{max-width:55%}.number{font-size:18px}.other-entry>summary{gap:12px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
@media print{body{background:white}main{padding:0;max-width:none}[data-controls],.operations{display:none!important}[data-panel][hidden],[data-entry][hidden]{display:block!important}.entry{break-inside:avoid}.hero{padding-top:20px}}
`

export function renderFeed(items: ReadingItem[], results: SourceResult[], now: string, digest?: Digest, localization?: LocalizationStats, curation?: Curation, options: { email?: boolean } = {}): string {
  const ready = curation?.status === 'ready'
  const tier = (item: ReadingItem) => isBlog(item) ? 'blogs' : ready ? curation.entries[item.id]?.tier || 'reading' : 'reading'
  const groups = { picks: items.filter(i => tier(i) === 'picks'), reading: items.filter(i => tier(i) === 'reading'), other: items.filter(i => tier(i) === 'other'), blogs: items.filter(isBlog) }
  for (const list of [groups.picks, groups.reading, groups.other]) list.sort((a, b) => ((curation?.entries[a.id]?.rank || 99) - (curation?.entries[b.id]?.rank || 99)) || ((curation?.entries[b.id]?.score || 0) - (curation?.entries[a.id]?.score || 0)))
  groups.blogs.sort((a, b) => (b.publishedAt || b.fetchedAt).localeCompare(a.publishedAt || a.fetchedAt) || a.id.localeCompare(b.id))
  const initial = groups.picks.length ? 'picks' : groups.reading.length ? 'reading' : groups.blogs.length ? 'blogs' : 'reading'
  const itemBody = (item: ReadingItem) => {
    const chinese = item.chinese
    const entry = isBlog(item) ? undefined : curation?.entries[item.id]
    const related = entry?.duplicateOf ? items.find(i => i.id === entry.duplicateOf) : undefined
    const rationale = entry ? `<p class="why"><b>${entry.tier === 'picks' ? '为什么值得读' : entry.tier === 'other' ? '收起原因' : '阅读提示'}</b>${related ? `同一事件的补充报道，优先阅读 <a href="#${anchor(related.id)}">${escape(related.chinese?.titleZh || related.title)}</a>。` : escape(entry.reason)}</p>` : ''
    return `${chinese ? `<p class="core">${escape(chinese.summaryZh)}</p>` : `<p class="pending">${escape(item.chineseError || '尚未生成中文摘要')}</p>`}${rationale}<p class="meta">${contentNames[item.contentKind]} · ${item.contentKind === 'link-metadata' ? '投稿时间：' : ''}${escape(item.publishedAt || '发布时间未知')}${item.author ? ` · ${item.contentKind === 'link-metadata' ? '提交者：' : item.contentKind === 'post' ? '@' : '作者：'}${escape(item.author)}` : ''}${item.discussionUrl && safeLink(item.discussionUrl) ? ` · <a href="${safeLink(item.discussionUrl)}">查看讨论</a>` : ''}</p><details class="text-details"><summary>${chinese?.translated ? '完整中文译文' : chinese ? '完整中文内容' : '查看原文'}</summary><div class="body">${escape(chinese?.contentZh || item.content || '来源未提供正文')}</div></details>${chinese?.translated ? `<details class="text-details"><summary>查看原文</summary><h3>${escape(item.title)}</h3><div class="body">${escape(item.content || '来源未提供正文')}</div></details>` : ''}`
  }
  const article = (item: ReadingItem, index: number, section: string) => {
    const topic = readingTopic(curation?.entries[item.id]?.topic || item.category, item)
    const title = item.chinese?.titleZh || item.title
    const search = [title, item.chinese?.summaryZh || '', item.sourceName, curation?.entries[item.id]?.reason || ''].join(' ')
    const attrs = `id="${anchor(item.id)}" tabindex="-1" data-entry data-category="${escape(topic)}" data-search="${escape(search)}"`
    if (section === 'other' && !options.email) return `<details ${attrs} class="entry other-entry"><summary><span class="category">${escape(topic)}</span><span class="headline">${escape(title)}</span></summary><div class="other-content"><p class="meta">${itemLink(item, item.sourceName)}</p>${itemBody(item)}</div></details>`
    return `<article ${attrs} class="entry${section === 'picks' && index === 0 ? ' featured' : ''}"><div class="article-grid"><span class="number">${String(index + 1).padStart(2, '0')}</span><div><p class="kicker"><span class="category">${escape(topic)}</span><span>${escape(item.sourceName)}</span>${section === 'picks' && index === 0 ? '<span>首选阅读</span>' : ''}</p><h3 class="headline">${itemLink(item, title)}</h3>${itemBody(item)}</div></div></article>`
  }
  const labels = { picks: '精选', reading: '继续阅读', other: '其他资讯', blogs: '博客' }
  const panels = (Object.keys(groups) as Array<keyof typeof groups>).map(key => `<section class="panel" id="panel-${key}" role="tabpanel" aria-labelledby="tab-${key}" data-panel="${key}">${options.email ? `<h2>${labels[key]}</h2>` : `<noscript><h2>${labels[key]}</h2></noscript>`}${groups[key].map((item, i) => article(item, i, key)).join('')}<p class="empty" data-empty ${groups[key].length ? 'hidden' : ''}>这个分组下没有匹配内容。可切换分类或清除搜索。</p></section>`).join('')
  const progress = localization?.enabled ? `<p class="meta">中文处理：完成 ${localization.ready}/${localization.total} · 缓存 ${localization.cached} · 待处理 ${localization.pending} · 失败 ${localization.failed}</p>` : ''
  const coverage = results.map(r => `<li>${escape(r.sourceName)}：${r.status === 'ok' ? `${r.count} 条` : r.status === 'disabled' ? '未启用' : '采集失败'}${r.status === 'ok' && r.note === 'RSS 当前快照，正文完整性未核验' ? '' : `；${escape(r.note)}`}</li>`).join('')
  const topics = digest ? `<details class="extra-analysis"><summary>专题综述</summary><p>${escape(digest.summary)}</p>${digest.topics.map(t => `<h3>${escape(t.title)}</h3><p>${escape(t.analysis)}</p><p>${t.evidenceIds.map(id => items.find(i => i.id === id)).filter((i): i is ReadingItem => !!i).map(i => itemLink(i, i.chinese?.titleZh || i.title)).join(' · ')}</p>`).join('')}</details>` : ''
  const controls = `<nav class="tabs" role="tablist" aria-label="阅读分组" data-controls hidden>${(Object.keys(groups) as Array<keyof typeof groups>).map(key => `<button class="tab" role="tab" id="tab-${key}" aria-controls="panel-${key}" aria-selected="${key === initial}" data-tab="${key}">${labels[key]}<span>${groups[key].length}</span></button>`).join('')}</nav><div class="toolbar" data-controls hidden><div class="filters" aria-label="主题分类">${['全部', 'AI', '技术', '商业', '人文', '综合'].map(topic => `<button class="filter" data-topic="${topic}" aria-pressed="${topic === '全部'}">${topic}</button>`).join('')}</div><div class="searchbox"><input id="search" type="search" aria-label="搜索标题、摘要或来源" placeholder="搜索标题、摘要或来源"><button id="clear-filters">清除筛选</button></div></div>`
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="技术、商业与人文的个人阅读简报"><title>值得读 · News Feed</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='6' fill='%23396348'/%3E%3Ctext x='9' y='29' font-size='27' fill='%23f6f5ee'%3EN%3C/text%3E%3C/svg%3E"><style>${styles}</style></head><body data-initial="${initial}"><a class="skip" href="#reading">跳到阅读列表</a><main><header class="masthead"><div class="brand">NEWS FEED<span class="edition"> / 私人阅读简报</span></div><div class="edition">${escape(now)}</div></header>${topics}<div id="reading">${options.email ? '' : controls}${!options.email ? '<noscript><p class="no-script">当前按精选、继续阅读、其他资讯、博客顺序展示；全部内容都可访问。</p></noscript>' : ''}${panels}</div><details class="operations"><summary>来源与处理记录 · ${results.filter(r => r.status === 'ok').length} 个来源可用${results.some(r => r.status === 'failed') ? ' · 有来源采集失败' : ''}</summary><aside class="guide"><div><span class="metric">${groups.picks.length}<small>精选 / ${items.length} 条采集</small></span></div><div class="criteria"><strong>把注意力留给重要的事</strong><p>重要变化、原始信息、有启发的分析。</p><p>行情碎片、推广上新与重复报道收进其他资讯。</p></div></aside>${progress}<p class="meta">阅读筛选：${ready ? '已完成 · AI 初筛' : escape(curation?.note || '未启用')}。推荐表示阅读价值，不表示事实已核验。</p><ul>${coverage}</ul></details><footer>News Feed · 为阅读做减法。译文、摘要与阅读筛选由模型生成，保留原文供核对。RSS 可能只有简介，社区链接未必包含外链正文。所有未入选内容均保留；博客独立展示全部已采集更新，不参与精选。</footer></main>${options.email ? '' : `<script>${readerScript}</script>`}</body></html>`
  return html
}
