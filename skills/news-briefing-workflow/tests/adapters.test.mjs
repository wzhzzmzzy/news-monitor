import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {piRunner} from '../scripts/pi.mjs';import {collectAside} from '../scripts/aside.mjs';import {exec,save} from '../scripts/lib.mjs';
async function temp(fn){const d=await fs.mkdtemp(path.join(os.tmpdir(),'news-workflow-'));try{await fn(d)}finally{await fs.rm(d,{recursive:true,force:true})}}
test('Pi child receives input through stdin and all tool channels are disabled',()=>temp(async d=>{
 const bin=path.join(d,'pi');await fs.writeFile(bin,'#!/usr/bin/env node\n(async()=>{let s="";for await(const x of process.stdin)s+=x; console.log(JSON.stringify({titleZh:"测试",summaryZh:"摘要",args:process.argv.slice(2),input:s}));})();',{mode:0o700});
 const out=await piRunner({pi:{bin,provider:'gateway',model:'deepseek-v4-flash',timeoutMs:10000}},{common:'材料',summaryPart:'摘要'})({kind:'summary-part',payload:{content:'untrusted text'},retry:false});
 for(const flag of ['--no-tools','--no-extensions','--no-mcp','--no-session','--no-context-files'])assert.ok(out.args.includes(flag));assert.ok(out.input.includes('untrusted text'));assert.ok(!out.args.some(x=>x.includes('untrusted text')));
}));
test('Aside ignores banner examples, validates last envelope and reuses source receipt',()=>temp(async d=>{
 const bin=path.join(d,'aside');const id='1234567890123456789';
 const payload={sourceId:'x-probe',status:'ok',posts:[{id,author:'OpenAI',text:'A real shaped source fixture',url:`https://x.com/OpenAI/status/${id}`,created_at:'2026-10-30T01:00:00Z'}]};
 await fs.writeFile(bin,'#!/usr/bin/env node\nconsole.log('+JSON.stringify('banner NEWS_POSTS_BEGIN {example} NEWS_POSTS_END\nNEWS_POSTS_BEGIN '+JSON.stringify(payload)+' NEWS_POSTS_END')+');',{mode:0o700});
 const source={id:'x-probe',name:'Probe',category:'技术',type:'x-user',username:'OpenAI',limit:1};const c={aside:{bin,timeoutMs:10000}};
 const items=await collectAside(source,{},'2026-10-30T02:00:00Z',c,d);assert.equal(items[0].id,'x:'+id);
 await fs.unlink(bin);assert.deepEqual(await collectAside(source,{},'2026-10-30T03:00:00Z',c,d),items);
}));
test('A terminal failed source is not requested again on resume',()=>temp(async d=>{
 await save(path.join(d,'sources/x-failed.json'),{failure:'login unavailable'});
 await assert.rejects(()=>collectAside({id:'x-failed'}, {}, '',{aside:{bin:'/nonexistent'}},d),/login unavailable/);
}));
test('Wrong permalink ID is rejected rather than archived as evidence',()=>temp(async d=>{
 await save(path.join(d,'sources/x-invalid.json'),{observedAt:'2026-10-30T02:00:00Z',posts:[{id:'123',author:'OpenAI',text:'x',url:'https://x.com/OpenAI/status/456',created_at:'2026-10-30T01:00:00Z'}]});
 await assert.rejects(()=>collectAside({id:'x-invalid',limit:1}, {}, '',{},d),/ID does not match/);
}));
test('Child nonzero exit cannot be interpreted as a valid empty result',async()=>{await assert.rejects(()=>exec(process.execPath,['-e','process.exit(3)']),/exited 3/)});

test('Timed out child exits as failure instead of keeping a stage running',async()=>{await assert.rejects(()=>exec(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:50}),/exited/)});
test('Installed resident DAG carries absolute paths and a resolvable login shell',()=>temp(async d=>{
 const daguHome=path.join(d,'dagu');
 await exec('/bin/sh',[path.join(import.meta.dirname,'..','scripts','install.sh')],{cwd:d,env:{...process.env,DAGU_HOME:daguHome,NEWS_LOGIN_SHELL:'/bin/sh'}});
 const text=await fs.readFile(path.join(daguHome,'dags','news-briefing-morning.yaml'),'utf8');
 const skill=path.resolve(import.meta.dirname,'..');
 assert.ok(!/^working_dir: \.\.$/m.test(text),'relative working_dir would resolve against the dagu home');
 assert.ok(text.includes('working_dir: '+skill+'\n'));
 assert.ok(text.includes('NEWS_LOGIN_SHELL: "/bin/sh"'));
 assert.match(text,/CRON_TZ=Asia\/Shanghai 0 10 \* \* \*/);
 assert.equal((text.match(/^  - name: /gm)||[]).length,8);
}));
