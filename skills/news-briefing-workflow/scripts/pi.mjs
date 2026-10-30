import fs from 'node:fs/promises';
import path from 'node:path';
import {exec,json,root} from './lib.mjs';
export function piRunner(c,prompts){return async r=>{
 const system=await fs.readFile(path.join(root,'prompts/pi-system.md'),'utf8');
 const shape=r.kind==='translate'?'{"titleLanguage":"zh|other|mixed|nonlinguistic","contentLanguage":"zh|other|mixed|nonlinguistic","titleZh":"...","contentZh":"...","summaryZh":"..."}':r.kind==='summary-part'?'{"titleZh":"...","summaryZh":"..."}':'{"summaryZh":"..."}';
 const instruction=prompts.common+(r.kind==='translate'?prompts.translate:r.kind==='summary-part'?prompts.summaryPart:prompts.reduce)+(r.retry?prompts.retry:'');
 const output=await exec(c.pi.bin,['--provider',c.pi.provider,'--model',c.pi.model,'--print','--no-session','--no-tools','--no-extensions','--no-mcp','--no-skills','--no-prompt-templates','--no-context-files','--system-prompt',system],{input:instruction+'\n只输出JSON，结构：'+shape+'\n来源材料：\n'+JSON.stringify(r.payload),timeout:c.pi.timeoutMs});
 return json(output);
};}
