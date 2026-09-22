import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { dataMarkdown } from './reader-data.js'

// Exercise the actual single-file page controller; its Svelte-only reactive views
// are compiled separately. No browser or remote state is mutated by these tests.
function page(search: string, editions = ['evening']) {
  const source = readFileSync(new URL('../../templates/news-feed.svelte', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)![1]
    .replace(/^  import .+;$/gm, '').replace(/^  \$:.*$/gm, '')
  const sample = (edition: string) => ({ version:'news-feed-reader-v1', title:edition, date:'2026-09-21', edition, cutoff:`2026-09-21T${edition==='morning'?'02':'12'}:00:00Z`, items:[], sections:[], summary:'' })
  const calls = vi.fn(async () => editions.map(edition => ({path:`/data/news-feed/2026-09-21/${edition}`, renderer:'markdown', private:false, deletedAt:null, content:dataMarkdown(sample(edition))})))
  const latest = vi.fn(async () => ({content:dataMarkdown({version:'news-feed-latest-v1', date:'2026-09-21', path:'/data/news-feed/2026-09-21/evening', cutoff:'2026-09-21T12:00:00Z'})}))
  const location = {href:`https://blog.example/news-feed${search}`, get search() {return new URL(this.href).search}}
  const listeners = new Map<string,()=>void>()
  const document = {getElementById:vi.fn()}
  const window = {matchMedia:vi.fn(()=>({matches:false})),origin:'https://blog.example',location,history:{pushState:vi.fn((_state, _title, url) => { location.href=String(url) })},addEventListener:(event:string,fn:()=>void)=>listeners.set(event,fn),removeEventListener:(event:string)=>listeners.delete(event)}
  let mount:()=>()=>void = () => () => {}
  const scope:any = {window, document, URL, URLSearchParams, callAction:calls, readMarkdown:latest, onMount:(fn:any)=>mount=fn}
  runInNewContext(source+`\nglobalThis.controller = {groupItems,matches,jumpTo,rowId,timelineGroups,inTab,tabs,check,loadRoute,goLatest,chooseReport,chooseDay,setDay:value=>day=value,state:()=>({report,error,day,requestedEdition,choices,loading})};`,scope)
  return {controller:scope.controller,calls,latest,window,document,listeners,mount:()=>mount()}
}
it('opens an exact dated evening report without consulting latest', async () => {
  const p=page('?date=2026-09-21&edition=evening',['morning','evening'])
  await p.controller.loadRoute()
  expect(p.controller.state().report.edition).toBe('evening')
  expect(p.calls.mock.calls[0]).toEqual(['/_actions/db.markdown.byPrefix',{prefix:'/data/news-feed/2026-09-21',scope:'public'}])
  expect(p.latest).not.toHaveBeenCalled()
})
it('never substitutes another edition for a missing morning report', async () => {
  const p=page('?date=2026-09-21&edition=morning')
  await p.controller.loadRoute()
  expect(p.controller.state()).toMatchObject({report:null,day:'2026-09-21',requestedEdition:'morning',loading:false})
  expect(p.controller.state().choices).toHaveLength(1)
})
it('supports date-only links and rejects invalid/ambiguous route parameters without requests', async () => {
  const p=page('?date=2026-09-21',['morning','evening']);await p.controller.loadRoute()
  expect(p.controller.state().report.edition).toBe('evening')
  for (const route of ['?date=2026-02-30','?edition=morning','?date=2026-09-21&edition=night','?date=2026-09-21&date=2026-09-22']) {
    const invalid=page(route);await invalid.controller.loadRoute()
    expect(invalid.controller.state().error).toContain('链接参数无效')
    expect(invalid.calls).not.toHaveBeenCalled();expect(invalid.latest).not.toHaveBeenCalled()
  }
})
it('updates shareable URLs when switching edition and restores state through browser history', async () => {
  const p=page('?date=2026-09-21&edition=morning',['morning','evening']);const cleanup=p.mount()
  await vi.waitFor(()=>expect(p.controller.state().loading).toBe(false))
  const choice=p.controller.state().choices.find((f:any)=>f.data.edition==='evening')
  p.controller.chooseReport(choice)
  expect(p.window.location.search).toBe('?date=2026-09-21&edition=evening')
  p.window.location.href='https://blog.example/news-feed?date=2026-09-21&edition=morning'
  p.listeners.get('popstate')!()
  await vi.waitFor(()=>expect(p.controller.state().report?.edition).toBe('morning'))
  p.controller.goLatest()
  await vi.waitFor(()=>expect(p.controller.state().report?.edition).toBe('evening'))
  expect(p.window.location.search).toBe('')
  cleanup();expect(p.listeners.has('popstate')).toBe(false)
})
it('ignores a slow previous request after an invalid navigation', async () => {
  const p=page('?date=2026-09-21&edition=evening')
  let complete:()=>void=()=>{}
  p.calls.mockImplementationOnce(()=>new Promise(resolve=>{complete=()=>resolve([])}))
  const pending=p.controller.loadRoute()
  p.window.location.href='https://blog.example/news-feed?date=invalid'
  await p.controller.loadRoute();complete();await pending
  expect(p.controller.state()).toMatchObject({report:null,loading:false})
  expect(p.controller.state().error).toContain('链接参数无效')
})

it('keeps legacy data tiers and presents non-blog news in a chronological timeline', () => {
  const p=page(''); const c=p.controller
  expect(Array.from(c.tabs, (t:any)=>t.id)).toEqual(['picks','blogs','timeline'])
  const entries = [
    {id:'old',tier:'reading',publishedAt:'2026-09-21T23:30:00+08:00'},
    {id:'unknown',tier:'other',publishedAt:null},
    {id:'new',tier:'picks',publishedAt:'2026-09-21T16:30:00Z'},
    {id:'blog',tier:'blogs',publishedAt:'2026-09-22T00:00:00Z'},
  ]
  const groups=c.timelineGroups(entries.filter(i=>c.inTab(i,'timeline')))
  expect(Array.from(groups,(g:any)=>g.date)).toEqual(['2026-09-22','2026-09-21','unknown'])
  expect(Array.from(groups,(g:any)=>g.items[0].clock)).toEqual(['00:30','23:30','—'])
  expect(entries.map(i=>i.id)).toEqual(['old','unknown','new','blog'])
  const report={version:'news-feed-reader-v1',title:'test',date:'2026-09-21',cutoff:'2026-09-21T12:00:00Z',sections:[],items:entries.map(i=>({...i,title:i.id,source:'test',url:'https://example.com',category:'技术',summary:null}))}
  expect(c.check(report)).toBe(report)
})

it('builds hour navigation from visible news and targets the first item of each Beijing hour', () => {
  const {controller:c}=page('')
  const items=[{id:'a/with space',publishedAt:'2026-09-21T10:44:00Z'},{id:'b',publishedAt:'2026-09-21T10:01:00Z'},{id:'c',publishedAt:'2026-09-21T09:59:00Z'},{id:'unknown',publishedAt:null}]
  const groups=c.timelineGroups(items)
  expect(Array.from(groups[0].hours)).toEqual([{hour:'18',target:c.rowId(items[0].id)},{hour:'17',target:c.rowId('c')}])
  expect(groups[1].hours).toHaveLength(0)
  expect(c.timelineGroups(items.slice(1))[0].hours[0].target).toBe(c.rowId('b'))
})
it('opens a collapsed day and focuses the jump destination without changing report query', () => {
  const p=page('?date=2026-09-21&edition=evening')
  const day={open:false}, target={closest:vi.fn(()=>day),focus:vi.fn(),scrollIntoView:vi.fn()}
  p.document.getElementById.mockReturnValue(target)
  p.controller.jumpTo('timeline-item-one')
  expect(day.open).toBe(true)
  expect(target.focus).toHaveBeenCalledWith({preventScroll:true})
  expect(target.scrollIntoView).toHaveBeenCalledWith({block:'start',behavior:'smooth'})
  expect(p.window.location.search).toBe('?date=2026-09-21&edition=evening')
  p.window.matchMedia.mockReturnValue({matches:true});p.controller.jumpTo('timeline-item-one')
  expect(target.scrollIntoView).toHaveBeenLastCalledWith({block:'start',behavior:'instant'})
  p.document.getElementById.mockReturnValue(null)
  expect(()=>p.controller.jumpTo('missing')).not.toThrow()
})

it('validates groups, preserves secondary sources for filtering and sorts events by newest report',()=>{
  const p=page('');const entries=[
    {id:'a',title:'发布',summary:'第一条',source:'主来源',url:'https://example.com/a',category:'AI',publishedAt:'2026-09-21T01:00:00Z',tier:'picks'},
    {id:'b',title:'更新',summary:'独有细节',source:'另一来源',url:'https://example.com/b',category:'技术',publishedAt:'2026-09-22T01:00:00Z',tier:'other'},
    {id:'blog',title:'博客',summary:null,source:'博客',url:'https://example.com/blog',category:'人文',publishedAt:null,tier:'blogs'},
  ];const events=[{eventId:'e',title:'合并事件',summary:'事实',itemIds:['b','a']}];
  const data={version:'news-feed-reader-v1',title:'早报',date:'2026-09-22',cutoff:'2026-09-22T02:00:00Z',summary:'',sections:[],items:entries,events};
  p.controller.check(data);
  const grouped=p.controller.groupItems(entries,events);
  expect(grouped).toHaveLength(2);expect(grouped[0]).toMatchObject({id:'a',tier:'picks',publishedAt:'2026-09-22T01:00:00.000Z'});
  expect(grouped[0].members).toHaveLength(2);
  expect(p.controller.matches(grouped[0],'技术','独有细节')).toBe(true);
  expect(p.controller.matches(grouped[0],'人文','')).toBe(false);
  expect(p.controller.groupItems(entries)).toEqual(entries);
  for(const ids of [['a','missing'],['a','blog'],['a','a']])expect(()=>p.controller.check({...data,events:[{...events[0],itemIds:ids}]})).toThrow();
  expect(()=>p.controller.check({...data,items:entries.map(i=>i.id==='b'?{...i,tier:'picks'}:i)})).toThrow('重复精选');
})
