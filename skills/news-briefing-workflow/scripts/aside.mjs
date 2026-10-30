import fs from 'node:fs/promises';
import path from 'node:path';
import {exec,root,core,read,exists,save} from './lib.mjs';
export async function collectAside(source,config,now,c,dir){
 const file=path.join(dir,'sources',source.id+'.json');
 const {parseTweets}=await core('collect');
 if(await exists(file)){const old=await read(file);if(old.failure)throw Error(old.failure);return parseTweets(JSON.stringify(old.posts),source,old.observedAt);}
 const url=source.type==='x-user'?'https://x.com/'+source.username.replace(/^@/,''):'https://x.com/i/lists/'+source.listId;
 const prompt=await fs.readFile(path.join(root,'prompts/aside-collect.md'),'utf8');
 try{
  const args=['exec',...(c.aside.profile?['--profile',c.aside.profile]:[]),prompt+'\n'+JSON.stringify({url,sourceId:source.id,limit:source.limit})];
  const raw=await exec(c.aside.bin,args,{timeout:c.aside.timeoutMs});
  await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file+'.response.txt',raw,{mode:0o600});
  const envelopes=[...raw.replace(/\x1b\[[0-9;]*m/g,'').matchAll(/NEWS_POSTS_BEGIN\s*([\s\S]*?)\s*NEWS_POSTS_END/g)];
  const values=envelopes.flatMap(m=>{try{return [JSON.parse(m[1])]}catch{return []}});
  const v=values.filter(v=>v.sourceId===source.id).at(-1);
  if(!v)throw Error('Aside did not return the required evidence envelope');
  if(v.sourceId!==source.id||v.status!=='ok'||!Array.isArray(v.posts)||!v.posts.length||v.posts.length>source.limit)throw Error('Aside empty/failed/oversized result');
  const parsed=parseTweets(JSON.stringify(v.posts),source,now);
  if(parsed.some(p=>!p.publishedAt||!p.content.trim()))throw Error('Missing publication time or post body');
  await save(file,{observedAt:now,posts:v.posts,coverage:'limited-browser-snapshot'});return parsed;
 }catch{await save(file,{observedAt:new Date().toISOString(),failure:'Aside collection failed; inspect saved response, browser login and CLI connection'});throw Error('Aside collection failed');}
}
