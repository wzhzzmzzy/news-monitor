import { expect, it } from 'vitest'
import { validateAgentReport } from './agent-report.js'
import { makeReaderReport } from './reader-data.js'
import type { NewsList } from './news.js'
const snapshot = { snapshotId:'3101e225-cb98-4405-8df2-aef3283a3cf7', edition:'morning', window:{start:'2026-09-21T02:00:00Z',end:'2026-09-22T02:00:00Z'}, baseline:null,
  items:['a','b','c'].map(id=>({id,title:id,summary:null,source:'RSS',url:'https://example.com/'+id,category:'技术',publishedAt:null})),
  blogs:[{id:'blog'}] } as unknown as NewsList
const event = {eventId:'launch',title:'产品发布',summary:'同一发布的不同报道。',itemIds:['a','b']}
const report = {version:'agent-report-v1',snapshotId:snapshot.snapshotId,title:'早报',summary:'',picks:[{id:'a',topic:'技术',reason:'发布'}],readingIds:[],sections:[],events:[event]}
it('keeps all original items and exports sparse events while legacy reports remain unchanged',()=>{
  const valid=validateAgentReport(report,snapshot)
  const newsOnly={...snapshot,blogs:[]}
  const {data}=makeReaderReport(newsOnly,valid)
  expect(data.items.map(i=>i.id)).toEqual(['a','b','c'])
  expect(data.events).toEqual([event])
  const {events,...legacy}=report
  expect(makeReaderReport(newsOnly,validateAgentReport(legacy,snapshot)).data).not.toHaveProperty('events')
})
it('rejects missing, blog, repeated and overlapping event members and duplicate event IDs',()=>{
  for (const itemIds of [['a','missing'],['a','blog'],['a','a']]) expect(()=>validateAgentReport({...report,events:[{...event,itemIds}]},snapshot)).toThrow()
  expect(()=>validateAgentReport({...report,events:[event,{...event,eventId:'second',itemIds:['b','c']}]},snapshot)).toThrow('Overlapping')
  expect(()=>validateAgentReport({...report,events:[event,event]},snapshot)).toThrow('Duplicate event')
  expect(()=>validateAgentReport({...report,events:[{...event,itemIds:['a']}]},snapshot)).toThrow()
})
it('allows one pick and one evidence-backed section per event, and rejects mixed events',()=>{
  const section={title:'发布',kind:'overview',body:'事实。',evidenceIds:['a','b']}
  expect(()=>validateAgentReport({...report,sections:[section]},snapshot)).not.toThrow()
  expect(()=>validateAgentReport({...report,picks:[...report.picks,{...report.picks[0],id:'b'}]},snapshot)).toThrow('picked once')
  expect(()=>validateAgentReport({...report,sections:[section,section]},snapshot)).toThrow('one overview')
  expect(()=>validateAgentReport({...report,sections:[{...section,evidenceIds:['a','c']}]},snapshot)).toThrow('one event')
})
