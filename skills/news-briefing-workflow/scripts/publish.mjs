import path from 'node:path';
import fs from 'node:fs/promises';
import {core,read,save,settings,exists} from './lib.mjs';
const dir=path.resolve(process.argv[2]||'');const c=await settings();
if(!dir.startsWith(c.outputRoot+path.sep))throw Error('Output outside configured root');
const {deliverBriefing,deliverySchema}=await core('briefing');
const {shanghaiDay}=await core('news');
const state=await read(path.join(dir,'state.json'));
const file=path.join(dir,'delivery.json');
if(!await exists(file)){
 const d=deliverySchema.parse(await read(c.deliveryConfig));
 // Keep the approval hold for internal chat delivery until the operator resolves it.
 if(!c.notificationsEnabled||state.day!==shanghaiDay())d.notifications.targets=[];
 await save(file,d);
}
const frozen=deliverySchema.parse(await read(file));
if(frozen.notifications.targets.length&&(!c.notificationsEnabled||state.day!==shanghaiDay()))throw Error('Notifications frozen for a different scope/date; reconcile explicitly before resuming');
const result=await deliverBriefing(dir,file,{run:async(bin,args)=>{
 // Check real time before each target lookup and send, including runs crossing midnight.
 if(bin===frozen.notifications.cli&&state.day!==shanghaiDay())throw Error('Report expired; notifications stopped');
 const {exec}=await import('./lib.mjs');return exec(bin,args,{timeout:120000});
}});
await save(path.join(dir,'publication-result.json'),result);
if(!result.complete)throw Error('Publication incomplete; see STATUS.md');
console.log(JSON.stringify({complete:true,day:result.day,notifications:frozen.notifications.targets.length}));
