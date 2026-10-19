import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prepareBriefing, deliverBriefing, publishKm, kmXml, embeddedHtml, withBriefingLock, reconcileNotification, unlockBriefing, resolveRecipient, type Delivery, type RunCli } from './briefing.js'
import { queryNews, editionRange } from './news.js'
import { parseFeedConfig } from './config.js'
import { FeedStore, writeJson } from './store.js'

let root: string, dir: string, configFile: string, delivery: Delivery, snapshotFile: string
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'briefing-test-')); dir = path.join(root, 'report')
  const archive = path.join(root, 'archive'), time = '2026-09-21T01:00:00.000Z'
  const items = await new FeedStore(archive).merge([{ id:'one', sourceId:'rss', sourceName:'RSS', title:'新闻', content:'事实', category:'技术', url:'https://example.com/one', publishedAt:time, fetchedAt:time, contentKind:'feed-content', raw:{} }])
  await writeJson(path.join(archive,'runs','initial','source-pack.json'),{version:1,collectedAt:time,items,results:[]})
  const cfg = parseFeedConfig({archiveDir:archive,localization:{enabled:false},sources:[{id:'rss',name:'RSS',type:'rss',url:'https://example.com/rss'}]})
  const snapshot = await queryNews(cfg,{...editionRange('morning','2026-09-21'),edition:'morning'})
  snapshotFile = snapshot.snapshotPath
  await prepareBriefing(dir,{day:'2026-09-21',snapshot:snapshotFile})
  await writeJson(path.join(dir,'editorial.json'),{version:'agent-report-v1',snapshotId:snapshot.snapshotId,title:'2026 年 9 月 21 日早报',summary:'',picks:[{id:'one',reason:'有具体影响',topic:'技术'}],readingIds:[],sections:[{title:'事实',kind:'overview',body:'事实。',evidenceIds:['one']}]})
  delivery = {version:'briefing-delivery-v1',koalablog:{url:'https://blog.example',tokenEnv:'KOALA_TEST_TOKEN'},km:{parentId:'100',mis:'tester',cli:'oa-skills'},notifications:{cli:'catdesk',ledgerDir:path.join(root,'ledger'),targets:[{key:'group',type:'group',name:'测试群'},{key:'person',type:'user',id:'123',mis:'person'}]}}
  configFile=path.join(root,'delivery.json');await writeJson(configFile,delivery)
})
afterEach(async () => { await fs.rm(root,{recursive:true,force:true}) })
function adapters() {
  const koalablog=vi.fn(async () => ({artifactStatus:'deployed',deploymentRequired:false}))
  const km=vi.fn(async (_dir: string, _d: Delivery, _title: string, _html: string, _old: string | undefined, save: (id:string)=>Promise<void>) => { await save('999'); return {contentId:'999',url:'https://km.sankuai.com/collabpage/999',parentId:'100',htmlSha256:'test',verifiedAt:new Date().toISOString(),permissionPolicy:'inherit-parent'} })
  const run=vi.fn<RunCli>(async (_bin,args) => args.includes('search') ? JSON.stringify({success:true,data:{results:args.includes('group')?[{type:'group',name:'测试群',id:'unknown'}]:[{type:'user',mis:'person',id:'123'}]}}) : JSON.stringify({success:true,data:{success:true}}))
  return {koalablog,km,run}
}
it('accepts a verified public reader during source drift for daily delivery', async () => {
  const deps={...adapters(),koalablog:vi.fn(async()=>({artifactStatus:'deployment_drift',readerAvailable:true,deploymentRequired:false}))}
  expect((await deliverBriefing(dir,configFile,deps)).complete).toBe(true)
})
it('publishes KM during a Koalablog failure, then notifies only after both platforms finish on resume', async () => {
  const deps=adapters();deps.koalablog.mockRejectedValueOnce(new Error('offline'))
  const first=await deliverBriefing(dir,configFile,deps)
  expect(first.complete).toBe(false);expect(first.steps.km.status).toBe('done');expect(first.steps['notify-person']).toBeUndefined()
  expect(deps.run).not.toHaveBeenCalled()
  const second=await deliverBriefing(dir,configFile,deps)
  expect(second.complete).toBe(true);expect(deps.koalablog).toHaveBeenCalledTimes(2);expect(deps.km).toHaveBeenCalledTimes(1)
  expect(deps.run.mock.calls.filter(([,args])=>args.includes('send'))).toHaveLength(2)
  await fs.access(path.join(dir,'report.html.report.md'))
  expect(await fs.readFile(path.join(dir,'km.html'),'utf8')).toBe(await fs.readFile(path.join(dir,'report.html'),'utf8'))
})
it('never repeats a timeout notification, still sends to the other recipient and dedupes across directories', async () => {
  const deps=adapters();const base=deps.run.getMockImplementation()!
  deps.run.mockImplementation(async (bin,args) => { if (args.includes('send') && args.includes('--group')) throw new Error('timeout'); return base(bin,args) })
  const first=await deliverBriefing(dir,configFile,deps)
  expect(first.steps['notify-group'].status).toBe('unknown');expect(first.steps['notify-person'].status).toBe('done')
  await deliverBriefing(dir,configFile,deps)
  const secondDir=path.join(root,'another-report');await prepareBriefing(secondDir,{day:'2026-09-21',snapshot:snapshotFile})
  await fs.copyFile(path.join(dir,'editorial.json'),path.join(secondDir,'editorial.json'))
  const resumed=await deliverBriefing(secondDir,configFile,deps)
  expect(resumed.steps['notify-group'].status).toBe('unknown');expect(resumed.steps['notify-person'].status).toBe('done')
  expect(deps.run.mock.calls.filter(([,args])=>args.includes('send'))).toHaveLength(2)
})
it('blocks notifications until KM readback succeeds and refuses changed decisions on resume', async () => {
  const deps=adapters();deps.km.mockRejectedValueOnce(new Error('readback mismatch'))
  await deliverBriefing(dir,configFile,deps);expect(deps.run).not.toHaveBeenCalled()
  const file=path.join(dir,'editorial.json');const value=JSON.parse(await fs.readFile(file,'utf8'));value.summary='changed';await writeJson(file,value)
  await expect(deliverBriefing(dir,configFile,deps)).rejects.toThrow('decisions changed')
  expect(deps.km).toHaveBeenCalledTimes(1)
})
it('recovers a successful shared send receipt when the per-report state write was interrupted', async () => {
  const deps=adapters();await deliverBriefing(dir,configFile,deps)
  const file=path.join(dir,'state.json');const state=JSON.parse(await fs.readFile(file,'utf8'))
  state.steps['notify-group'].status='running';state.complete=false;await writeJson(file,state)
  deps.run.mockClear()
  expect((await deliverBriefing(dir,configFile,deps)).complete).toBe(true)
  expect(deps.run).not.toHaveBeenCalled()
})
it('only allows an uncertain notification to retry after recorded evidence confirms it was not sent', async () => {
  const deps=adapters();const base=deps.run.getMockImplementation()!
  deps.run.mockImplementation(async (bin,args)=>{ if(args.includes('send') && args.includes('--group')) throw new Error('timeout');return base(bin,args) })
  await deliverBriefing(dir,configFile,deps)
  const proof=path.join(root,'proof.json')
  await writeJson(proof,{reportDate:'2026-09-21',targetKey:'group',contentId:'999',outcome:'not-sent',checkedAt:new Date().toISOString(),checkedBy:'tester',evidence:'Confirmed absence in target chat and confirmed failed delivery'})
  await reconcileNotification(dir,configFile,'group',proof)
  deps.run.mockImplementation(base)
  expect((await deliverBriefing(dir,configFile,deps)).complete).toBe(true)
  expect(deps.run.mock.calls.filter(([,args])=>args.includes('send') && args.includes('--user-id'))).toHaveLength(1)
})
it('rejects an active report lock and rejects blindly recollecting an interrupted preparation', async () => {
  await withBriefingLock(dir,async () => { await expect(deliverBriefing(dir,configFile,adapters())).rejects.toThrow('locked') })
  await withBriefingLock(dir,async () => { await expect(unlockBriefing(dir)).rejects.toThrow('still alive') })
  const other=path.join(root,'interrupted');await fs.mkdir(other)
  await writeJson(path.join(other,'state.json'),{version:'briefing-state-v1',day:'2026-09-21',edition:'morning',window:{},steps:{snapshot:{status:'running'}},complete:false})
  await expect(prepareBriefing(other,{})).rejects.toThrow('do not repeat collection')
})
it('refuses an unknown fuzzy group ID if search also contains another candidate', async () => {
  const run:RunCli=async()=>JSON.stringify({success:true,data:{results:[{type:'group',name:'测试群',id:'unknown'},{type:'group',name:'测试群2',id:'unknown'}]}})
  await expect(resolveRecipient(delivery,delivery.notifications.targets[0],run)).rejects.toThrow('could not be verified')
})
it('does not issue another KM create after an uncertain create has no visible matching child', async () => {
  const run=vi.fn<RunCli>(async()=>JSON.stringify({parentId:'100',children:[]}))
  await expect(publishKm(dir,delivery,'日报','HTML',undefined,async()=>{},run,false)).rejects.toThrow('reconcile before creating again')
  expect(run.mock.calls.some(([,args])=>args.includes('createDocument'))).toBe(false)
})
it('reconciles a created KM document after a readback failure without creating it twice', async () => {
  let created=false, fail=true, id: string|undefined, creates=0
  const html='完整 HTML ]]> 保留';const title='日报'
  const run:RunCli=async (_bin,args) => {
    if (args.includes('getChildContent')) return JSON.stringify({parentId:'100',children:created?[{title,contentId:'999'}]:[]})
    if (args.includes('createDocument')) {created=true;creates++;return '文档ID：999'}
    if (args.includes('getDocumentMetaInfo')) return JSON.stringify({parentId:'100',title,deleted:false})
    if (fail) throw new Error('readback offline')
    await fs.writeFile(args[args.indexOf('--output')+1],kmXml(title,html));return ''
  }
  await expect(publishKm(dir,delivery,title,html,id,async value=>{id=value},run)).rejects.toThrow('offline')
  expect(id).toBe('999');fail=false
  await publishKm(dir,delivery,title,html,id,async value=>{id=value},run)
  expect(creates).toBe(1);expect(embeddedHtml(kmXml(title,html))).toBe(html)
})
it('completes both platforms with no notification targets and never invokes CatDesk', async () => {
  delivery.notifications.targets=[]
  await writeJson(configFile,delivery)
  const deps=adapters()
  const state=await deliverBriefing(dir,configFile,deps)
  expect(state.complete).toBe(true)
  expect(state.steps.km.status).toBe('done')
  expect(state.steps.koalablog.status).toBe('done')
  expect(deps.run).not.toHaveBeenCalled()
})
