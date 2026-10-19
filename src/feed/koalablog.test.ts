import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import type { NewsList } from './news.js'
import type { AgentReport } from './agent-report.js'
import { publishReader, publicData } from './koalablog.js'
import { dataMarkdown, makeReaderReport, parseData } from './reader-data.js'
const snapshot = { snapshotId: '3101e225-cb98-4405-8df2-aef3283a3cf7', edition: 'evening', window: { start:'2026-09-21T02:00:00Z', end:'2026-09-21T12:00:00Z' }, items: [
  { id: 'a', title: '新闻 <script>bad</script>', summary: '核心事实。', category:'技术', publishedAt:null, source: '来源', url: 'https://example.com/a' },
  { id: 'b', title: '其他', summary: null, category:'技术', publishedAt:null, source: '来源', url: 'javascript:bad' },
], baseline: null, blogs: [], snapshotPath: '/private/local/path', secret: 'must-not-export' } as unknown as NewsList
const report: AgentReport = { version: 'agent-report-v1', snapshotId: snapshot.snapshotId, title: '9 月 21 日晚间阅读', summary: '', picks: [{ id: 'a', topic: 'AI', reason: '理由' }], readingIds: [], sections: [{ title: '不显示的综述标题', kind: 'overview', body: '简短新闻事实。', evidenceIds: ['a'], beforeIds: [] }] }
const options = { url: 'https://blog.example', tokenEnv: 'KOALA_TEST_TOKEN' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
type File = { id:number; path:string; revision:number; renderer:string; content:string; private:boolean; artifactStatus?:string }
function remote() {
  const files = new Map<string,File>(); const writes: string[] = []; let failPath = ''; let conflictPath = ''
  const request = vi.fn(async (input: URL | string | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith('/api/')) {
      expect((init?.headers as Record<string,string>).Authorization).toBe('Bearer test-token')
      expect(init?.redirect).toBe('error')
      if (init?.method === 'POST') {
        const [v] = JSON.parse(init.body as string); const old = files.get(v.path)
        if (v.path === failPath) return json({},500)
        if (v.path === conflictPath || (old && v.baseRevision !== old.revision)) return json({},409)
        expect(v.private).toBe(false)
        const saved = {...v, id: old?.id || files.size+1, revision:(old?.revision || 0)+1, artifactStatus:v.renderer==='svelte'?'not_deployed':'not_applicable'}
        files.set(v.path,saved); writes.push(v.path)
        return json({success:true,count:1,results:[saved]})
      }
      if (url.pathname === '/api/markdown/batch') return json([...files.values()])
      return json({file:[...files.values()].find(f=>String(f.id)===url.pathname.split('/').pop())})
    }
    expect(init?.headers).toBeUndefined()
    const file=files.get(decodeURIComponent(url.pathname))
    return new Response(file?.renderer === 'markdown' ? file.content : 'page',{status:file && !file.private?200:302})
  })
  return {files,writes,request,fail:(p:string)=>failPath=p,conflict:(p:string)=>conflictPath=p}
}
afterEach(() => vi.unstubAllEnvs())
it('daily data-only publishing tolerates an evolved deployed reader and never writes its source', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token'); const r = remote()
  r.files.set('/news-feed',{id:99,path:'/news-feed',revision:7,renderer:'svelte',content:'custom deployed reader',private:false,artifactStatus:'deployed'})
  await publishReader(snapshot,report,{...options,dataOnly:true},r.request)
  expect(r.writes).toEqual(['/data/news-feed/2026-09-21/evening','/data/news-feed/latest'])
  expect(r.files.get('/news-feed')?.revision).toBe(7)
  const bad = async (input: any, init?: RequestInit) => String(input).includes('/data/news-feed/') && !String(input).includes('/api/') ? new Response(dataMarkdown({wrong:true})) : r.request(input, init)
  await expect(publishReader(snapshot,report,{...options,dataOnly:true},bad)).rejects.toThrow('Anonymous report data differs')
})
it('requires deployment before any data-only write and decodes anonymous data HTML', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token'); const r=remote()
  await expect(publishReader(snapshot,report,{...options,dataOnly:true},r.request)).rejects.toThrow('existing deployed')
  expect(r.writes).toEqual([])
  expect(publicData('<pre><code class="language-json"><span>{</span>&quot;text&quot;:&quot;A &amp; B&quot;}</code></pre>')).toEqual({text:'A & B'})
})
it('data-only publishing uses the still-public deployed artifact during source drift', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token'); const r=remote()
  r.files.set('/news-feed',{id:99,path:'/news-feed',revision:9,renderer:'svelte',content:'saved but not deployed source',private:false,artifactStatus:'deployment_drift'})
  const receipt=await publishReader(snapshot,report,{...options,dataOnly:true},r.request)
  expect(receipt).toMatchObject({artifactStatus:'deployment_drift',readerAvailable:true,deploymentRequired:false})
  expect(r.writes).toEqual(['/data/news-feed/2026-09-21/evening','/data/news-feed/latest'])
  expect(r.files.get('/news-feed')?.revision).toBe(9)
  const blocked=remote()
  blocked.files.set('/news-feed',{id:99,path:'/news-feed',revision:9,renderer:'svelte',content:'source',private:true,artifactStatus:'deployment_drift'})
  await expect(publishReader(snapshot,report,{...options,dataOnly:true},blocked.request)).rejects.toThrow('Public access failed')
  expect(blocked.writes).toEqual([])
})
it('exports only public reading fields with independent blog channel and safe links', () => {
  const {data,latest,content}=makeReaderReport({...snapshot, blogs:[{...snapshot.items[0],id:'blog'}]},report)
  expect(latest.path).toBe('/data/news-feed/2026-09-21/evening')
  expect(data.items.map(i=>i.tier)).toEqual(['picks','other','blogs'])
  expect(data.items[0].category).toBe('AI')
  expect(data.items[1].url).toBe('')
  expect(content).not.toContain('<script>'); expect(content).not.toContain('must-not-export'); expect(content).not.toContain('/private/local/path')
  expect(parseData(content)).toEqual(data)
})
it('publishes data before latest; creates a fixed public Svelte entry without claiming deployment', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token');const r=remote()
  const result=await publishReader(snapshot,report,options,r.request)
  expect(r.writes).toEqual(['/data/news-feed/2026-09-21/evening','/news-feed','/data/news-feed/latest'])
  expect(result).toMatchObject({url:'https://blog.example/news-feed',reportUrl:'https://blog.example/news-feed?date=2026-09-21&edition=evening',renderer:'svelte',deploymentRequired:true,latestAdvanced:true,count:2})
  expect(JSON.stringify(result)).not.toContain('test-token')
  expect(r.files.get('/news-feed')?.content).toContain('@koala/page-runtime')
  expect(r.files.get('/news-feed')?.content).not.toContain('test-token')
})
it('retries completed/partial publication idempotently and never rolls latest back for a backfill', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token');const r=remote()
  r.fail('/data/news-feed/latest')
  await expect(publishReader(snapshot,report,options,r.request)).rejects.toThrow('HTTP 500')
  expect(r.files.has('/data/news-feed/latest')).toBe(false)
  r.fail(''); await publishReader(snapshot,report,options,r.request)
  const count=r.writes.length
  await publishReader(snapshot,report,options,r.request)
  expect(r.writes).toHaveLength(count)
  const old={...snapshot,edition:'morning' as const,window:{...snapshot.window,end:'2026-09-21T02:00:00Z'}}
  expect((await publishReader(old,report,options,r.request)).latestAdvanced).toBe(false)
  expect(parseData(r.files.get('/data/news-feed/latest')!.content)).toMatchObject({edition:'evening'})
})
it('refuses different same-slot content and CAS conflict without overwriting latest', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token');const r=remote()
  await publishReader(snapshot,report,options,r.request)
  await expect(publishReader(snapshot,{...report,title:'Changed'},options,r.request)).rejects.toThrow('different content')
  const original=r.files.get('/data/news-feed/latest')!.content
  r.conflict('/data/news-feed/latest')
  const next={...snapshot,window:{...snapshot.window,end:'2026-09-22T12:00:00Z'}}
  await expect(publishReader(next,report,options,r.request)).rejects.toThrow('HTTP 409')
  expect(r.files.get('/data/news-feed/latest')!.content).toBe(original)
})
it('keeps changed shell protected unless explicitly requested', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token');const r=remote()
  await publishReader(snapshot,report,options,r.request)
  r.files.get('/news-feed')!.content='manually changed'
  await expect(publishReader(snapshot,report,options,r.request)).rejects.toThrow('--koalablog-update-shell')
  await publishReader(snapshot,report,{...options,updateShell:true},r.request)
  expect(r.files.get('/news-feed')!.content).toBe(await fs.readFile(new URL('../../templates/news-feed.svelte',import.meta.url),'utf8'))
})
it('rejects private data on reuse, missing credentials and non-HTTPS origins', async () => {
  const request=vi.fn()
  await expect(publishReader(snapshot,report,{url:'http://blog.example'},request)).rejects.toThrow('HTTPS origin')
  vi.stubEnv('KOALA_TEST_TOKEN','')
  await expect(publishReader(snapshot,report,options,request)).rejects.toThrow('Set KOALA_TEST_TOKEN')
  expect(request).not.toHaveBeenCalled()
  vi.stubEnv('KOALA_TEST_TOKEN','test-token');const r=remote()
  const {latest,content}=makeReaderReport(snapshot,report)
  r.files.set(latest.path,{id:1,path:latest.path,revision:1,renderer:'markdown',private:true,content})
  await expect(publishReader(snapshot,report,options,r.request)).rejects.toThrow('Public access failed')
  expect(r.files.has('/data/news-feed/latest')).toBe(false)
})
it('redacts transport errors and refuses malformed existing latest index', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token');const request=vi.fn().mockRejectedValue(new Error('secret test-token'))
  await expect(publishReader(snapshot,report,options,request)).rejects.toThrow('No automatic write retry')
  expect(request).toHaveBeenCalledOnce()
  const r=remote();r.files.set('/data/news-feed/latest',{id:1,path:'/data/news-feed/latest',revision:1,renderer:'markdown',private:false,content:dataMarkdown({unexpected:true})})
  await expect(publishReader(snapshot,report,options,r.request)).rejects.toThrow()
  expect(r.files.get('/data/news-feed/latest')?.revision).toBe(1)
})

it('blocks unfinished blog summaries before any write', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token'); const r=remote()
  const pending={...snapshot,blogs:[{...snapshot.items[0],id:'blog',languageStatus:'pending'}]} as NewsList
  await expect(publishReader(pending,report,options,r.request)).rejects.toThrow('all news and blog summaries')
  expect(r.writes).toEqual([])
})
it('verifies anonymous blog summaries and latest even outside data-only mode', async () => {
  vi.stubEnv('KOALA_TEST_TOKEN','test-token'); const r=remote()
  const stale=async (input: any, init?: RequestInit) => {
    const path=new URL(String(input)).pathname
    if (!path.startsWith('/api/') && path==='/data/news-feed/latest') return new Response(dataMarkdown({...makeReaderReport(snapshot,report).latest,date:'2026-09-20'}))
    return r.request(input,init)
  }
  await expect(publishReader(snapshot,report,options,stale)).rejects.toThrow('Anonymous report data differs')
  const blogRemote=remote()
  const blogs={...snapshot,blogs:[{...snapshot.items[0],id:'blog',languageStatus:'ready'}]} as NewsList
  const missing=async (input: any, init?: RequestInit) => {
    const path=new URL(String(input)).pathname
    if (!path.startsWith('/api/') && path.endsWith('/evening')) {
      const data=makeReaderReport(blogs,report).data
      return new Response(dataMarkdown({...data,items:data.items.map(i=>i.tier==='blogs'?{...i,summary:null}:i)}))
    }
    return blogRemote.request(input,init)
  }
  await expect(publishReader(blogs,report,options,missing)).rejects.toThrow('Anonymous report data differs')
})
