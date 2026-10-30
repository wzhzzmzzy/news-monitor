import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const repo=path.resolve(root,'../..');
export const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
export const exists=async f=>!!(await fs.stat(f).catch(()=>null));
export async function save(f,v){await fs.mkdir(path.dirname(f),{recursive:true});const t=f+'.'+process.pid+'.tmp';await fs.writeFile(t,JSON.stringify(v,null,2)+'\n',{mode:0o600});await fs.rename(t,f);}
export async function settings(){const c=await read(process.env.NEWS_WORKFLOW_CONFIG||path.join(root,'config/local.json'));for(const k of ['feedConfig','deliveryConfig','outputRoot'])c[k]=path.resolve(root,c[k]);return c;}
export function exec(bin,args,{input='',cwd=repo,timeout=180000,env=process.env}={}){return new Promise((resolve,reject)=>{const p=spawn(bin,args,{cwd,env,stdio:['pipe','pipe','pipe'],detached:true});let out='',err='',size=0;let force;const kill=()=>{try{process.kill(-p.pid,'SIGTERM')}catch{};force=setTimeout(()=>{try{process.kill(-p.pid,'SIGKILL')}catch{}},5000);force.unref();};const timer=setTimeout(kill,timeout);p.stdout.on('data',x=>{size+=x.length;if(size>32*1024*1024)kill();else out+=x});p.stderr.on('data',x=>{if(err.length<20000)err+=x});p.on('error',e=>{clearTimeout(timer);reject(e)});p.on('close',(code,signal)=>{clearTimeout(timer);clearTimeout(force);if(code===0&&!signal)resolve(out);else reject(new Error(`${path.basename(bin)} exited ${code??signal}; inspect local CLI authentication/connection (output withheld)`))});p.stdin.on('error',()=>{});p.stdin.end(input);});}
export function json(text){const cleaned=text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/,'');return JSON.parse(cleaned);}
export const core=async file=>import(path.join(repo,'dist/feed',file+'.js'));
