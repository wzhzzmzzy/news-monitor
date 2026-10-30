import fs from 'node:fs/promises';
import path from 'node:path';
import {root,repo,read,save,exists,settings,core,exec,json} from './lib.mjs';
import {piRunner} from './pi.mjs';
import {collectAside} from './aside.mjs';
const [phase,dayArg]=process.argv.slice(2);
const c=await settings();const {editionRange,shanghaiDay,queryNews,loadNews,loadSnapshotEvidence}=await core('news');
const day=dayArg||shanghaiDay();if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Invalid day');
const dir=path.join(c.outputRoot,day,'morning');await fs.mkdir(dir,{recursive:true});
const range=editionRange('morning',day);
const {withBriefingLock,prepareBriefing}=await core('briefing');
const {loadFeedConfig}=await core('config');
const config=await loadFeedConfig(c.feedConfig);
config.llm={...config.llm,piProvider:c.pi.provider,model:c.pi.model};
// Separate Pi Agent caches from the older direct-API runner.
config.prompts.common+='\n'+await fs.readFile(path.join(root,'prompts/pi-system.md'),'utf8');
const record=path.join(dir,'workflow.json');
const bind={version:1,day,window:{start:range.start.toISOString(),end:range.end.toISOString()},config:c,feed:config};
const {hashBytes}=await core('news');const identity=hashBytes(JSON.stringify(bind));
if(await exists(record)){if((await read(record)).identity!==identity)throw Error('Workflow configuration changed for this edition; preserve existing run');}
else await save(record,{identity,day,createdAt:new Date().toISOString()});
const locked=fn=>withBriefingLock(path.join(dir,'.workflow'),fn);
if(phase==='preflight'){
 if(+range.end>Date.now())throw Error('Morning cutoff has not arrived');
 await exec(c.pi.bin,['--version']);await exec(c.codex.bin,['--version']);await exec(c.aside.bin,['host','profiles']);
 console.log(dir);
}else if(phase==='collect')await locked(async()=>{
 const receipt=path.join(dir,'collection.json');if(await exists(receipt))return;
 if(day!==shanghaiDay())throw Error('Historical runs require adoption of an existing snapshot; do not collect today as historical evidence');
 const {runFeed}=await core('pipeline');const {collectSource}=await core('collect');
 const result=await runFeed(config,{publicationWindow:range,deferLocalization:true},async(s,cfg,now,...rest)=>{
  if(s.type==='x-user'||s.type==='x-list')return collectAside(s,cfg,now,c,dir);
  const f=path.join(dir,'sources',s.id+'.json');if(await exists(f)){const b=await read(f);if(b.failure)throw Error(b.failure);return b.items;}
  try{const items=await collectSource(s,cfg,now,...rest);await save(f,{items});return items;}catch{await save(f,{failure:'RSS collection failed'});throw Error('RSS collection failed');}
 });await save(receipt,result);
});
else if(phase==='localize')await locked(async()=>{
 if(await exists(path.join(dir,'snapshot.json')))return;
 const collected=await read(path.join(dir,'collection.json'));
 const {localizeItems}=await core('localize');
 const snapshot=await queryNews(config,{...range,edition:'morning',observedThrough:new Date(Math.max(+range.end,Date.parse(collected.collectedAt))+1)},(items,cfg)=>localizeItems(items,cfg,piRunner(c,cfg.prompts)));
 await save(path.join(dir,'snapshot.json'),{snapshotPath:snapshot.snapshotPath,snapshotId:snapshot.snapshotId});
});
else if(phase==='freeze')await prepareBriefing(dir,{day,edition:'morning',snapshot:(await read(path.join(dir,'snapshot.json'))).snapshotPath});
else if(phase==='editorial')await locked(async()=>{
 const snapshot=await loadNews(path.join(dir,'news.json'));await loadSnapshotEvidence(snapshot,path.join(dir,'news.json'));
 const {validateAgentReport}=await core('agent-report');const target=path.join(dir,'editorial.json');
 if(await exists(target)){validateAgentReport(await read(target),snapshot);return;}
 const title=`${Number(day.slice(0,4))} 年 ${Number(day.slice(5,7))} 月 ${Number(day.slice(8,10))} 日早报`;
 const prompt=await fs.readFile(path.join(root,'prompts/codex-editor.md'),'utf8');
 let correction='';
 for(let attempt=1;attempt<=2;attempt++){
  const output=path.join(dir,`codex-editorial.attempt-${Date.now()}-${attempt}.json`);
  await exec(c.codex.bin,['exec','--ephemeral','--sandbox','read-only','--cd',repo,'--output-schema',path.join(root,'config/editorial.schema.json'),'--output-last-message',output,'-'],{input:prompt+'\n'+JSON.stringify({title,readingPack:path.join(dir,'reading-pack.json'),snapshot,validationCorrection:correction}),timeout:c.codex.timeoutMs});
  try{
   const report=validateAgentReport(json(await fs.readFile(output,'utf8')),snapshot);if(report.title!==title)throw Error('Wrong report title');
   await fs.writeFile(target,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});break;
  }catch(e){if(attempt===2)throw e;correction=String(e.message)+'；检查字段、新闻ID、picks与readingIds互斥，输出修正后的完整JSON。';}
 }

});
else if(phase==='preview'){
 const {renderAgentReport}=await core('agent-report');
 const result=await renderAgentReport(path.join(dir,'news.json'),path.join(dir,'editorial.json'),path.join(dir,'report.html'));
 await save(path.join(dir,'preview-result.json'),{...result,publicationAttempted:false});console.log(JSON.stringify(result));
}
else if(phase==='publish'){
 const prompt=await fs.readFile(path.join(root,'prompts/codex-publish.md'),'utf8');
 await exec(c.codex.bin,['exec','--ephemeral','-c','shell_environment_policy.inherit="all"','-c','shell_environment_policy.ignore_default_excludes=true','--sandbox','workspace-write','--approve-for-me','--add-dir',c.outputRoot,'--cd',repo,'-'],{input:prompt+'\n'+JSON.stringify({node:process.execPath,script:path.join(root,'scripts/publish.mjs'),dir}),timeout:c.codex.timeoutMs});
 const s=await read(path.join(dir,'state.json'));if(!s.complete)throw Error('Codex publication incomplete; inspect STATUS.md');
}
else if(phase==='verify'){
 const s=await read(path.join(dir,'state.json'));if(!s.complete)throw Error('Publication incomplete; inspect STATUS.md');console.log(JSON.stringify({day,complete:true,steps:s.steps}));
}else if(phase==='status')console.log(JSON.stringify(await read(path.join(dir,'state.json')),null,2));
else throw Error('Phase: preflight|collect|localize|freeze|editorial|preview|publish|verify|status [YYYY-MM-DD]');
