import fs from 'node:fs/promises';
import path from 'node:path';
import {root,repo,exists,exec,save} from './lib.mjs';
const file=path.join(root,'config/local.json');
if(!await exists(file)){
 const example=JSON.parse(await fs.readFile(path.join(root,'config/example.json'),'utf8'));
 example.feedConfig=path.join(repo,'config.feed.local.yaml');
 example.deliveryConfig=process.env.NEWS_DELIVERY_CONFIG||example.deliveryConfig;
 example.outputRoot=process.env.NEWS_OUTPUT_ROOT||path.resolve(repo,'../../experiments/dagu-briefings');
 await save(file,example);
}
await exec('dagu',['validate',path.join(root,'dagu/morning.yaml')]);
console.log('Configuration: '+file+'\nDAG validated. Run scripts/run.sh preflight before enabling the scheduler.');
