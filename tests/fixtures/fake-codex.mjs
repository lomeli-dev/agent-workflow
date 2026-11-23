// Fake `codex app-server` for tests: one JSON object per line on stdio, like Codex 0.171.0.
// hooks/list reads $CODEX_HOME/hooks.json and the trust state from $CODEX_HOME/fake-state.json
// (stand-in for hooks.state in config.toml); config/batchWrite upserts hooks.state there and logs
// every request to $CODEX_HOME/fake-writes.jsonl. FAKE_CODEX_MODE: ok (default) | crash |
// init-error | list-error | write-error | ignore-write.
import {readFileSync,writeFileSync,appendFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';

const mode=process.env.FAKE_CODEX_MODE??'ok',home=process.env.CODEX_HOME;
if(process.argv[2]!=='app-server'){console.error('fake codex: only app-server');process.exit(2);}
if(mode==='crash'){console.error('fake codex: crashed on start');process.exit(1);}
const statePath=join(home,'fake-state.json');
const state=()=>existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{};
const snake=e=>e.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
const camel=e=>e[0].toLowerCase()+e.slice(1);
function list(){
  const file=join(home,'hooks.json'),hooks=[],s=state();
  if(!existsSync(file))return hooks;
  for(const [event,groups] of Object.entries(JSON.parse(readFileSync(file,'utf8')).hooks??{}))groups.forEach((g,i)=>(g.hooks??[]).forEach((h,j)=>{
    const key=`${file}:${snake(event)}:${i}:${j}`,entry=s[key]??{};
    const currentHash='sha256:'+createHash('sha256').update(JSON.stringify({event,matcher:g.matcher??null,h})).digest('hex');
    const trustStatus=entry.trusted_hash===undefined?'untrusted':entry.trusted_hash===currentHash?'trusted':'modified';
    hooks.push({key,eventName:camel(event),handlerType:h.type,command:h.command,matcher:g.matcher??null,sourcePath:file,source:'user',pluginId:null,isManaged:false,enabled:entry.enabled!==false,currentHash,trustStatus});
  }));
  return hooks;
}
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
let initialized=false;
createInterface({input:process.stdin}).on('line',line=>{
  if(!line.trim())return;const m=JSON.parse(line);
  if(m.method==='initialize'){if(mode==='init-error')return send({id:m.id,error:{code:-32603,message:'fake init failure'}});send({method:'remoteControl/status/changed',params:{status:'disabled'}});return send({id:m.id,result:{userAgent:'fake',codexHome:home}});}
  if(m.method==='initialized'){initialized=true;return;}
  if(!initialized)return send({id:m.id,error:{code:-32600,message:'not initialized'}});
  if(m.method==='hooks/list'){if(mode==='list-error')return send({id:m.id,error:{code:-32603,message:'fake list failure'}});return send({id:m.id,result:{data:m.params.cwds.map(cwd=>({cwd,hooks:list(),warnings:[],errors:[]}))}});}
  if(m.method==='config/batchWrite'){
    appendFileSync(join(home,'fake-writes.jsonl'),JSON.stringify(m.params)+'\n');
    if(mode==='write-error')return send({id:m.id,error:{code:-32603,message:'fake write failure'}});
    const edit=m.params.edits?.[0];
    if(m.params.edits?.length!==1||edit.keyPath!=='hooks.state'||edit.mergeStrategy!=='upsert')return send({id:m.id,error:{code:-32602,message:'unexpected edit'}});
    if(mode!=='ignore-write'){const s=state();for(const [k,v] of Object.entries(edit.value))s[k]={...s[k],...v};writeFileSync(statePath,JSON.stringify(s));}
    return send({id:m.id,result:{status:'ok',version:'1',filePath:join(home,'config.toml'),overriddenMetadata:null}});
  }
  send({id:m.id,error:{code:-32601,message:'unknown method '+m.method}});
});
