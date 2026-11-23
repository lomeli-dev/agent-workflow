import {existsSync,unlinkSync,realpathSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {modify,applyEdits} from 'jsonc-parser';
import {parse as parseToml} from 'smol-toml';
import {locations,PACKAGE,json,CLIENTS} from './install.mjs';
import {projectRoot} from './gate.mjs';
import {atomic,noSymlinks,read,hash,lock} from './files.mjs';
import {MCP_TOOLS,DEFAULT_MCP_TOOLS} from './mcp-launch.mjs';
const A='# agent-workflow:mcp:begin',B='# agent-workflow:mcp:end';
function managed(text){const a=(text??'').indexOf(A),b=(text??'').indexOf(B);if((a<0)!==(b<0)||b<a||(a>=0&&((text??'').indexOf(A,a+1)>=0||(text??'').indexOf(B,b+1)>=0)))throw Error('Malformed managed MCP block');return a<0?null:text.slice(a,b+B.length);}
function replace(text,body){text??='';const old=managed(text);if(old)return text.replace(old,body??'');return text+(text&&!text.endsWith('\n')?'\n':'')+(body?'\n'+body+'\n':'');}
function updateJson(text,path,value){return applyEdits(text??'{}\n',modify(text??'{}\n',path,value,{formattingOptions:{insertSpaces:true,tabSize:2}}));}
export function connectionRoot(project){
 const root=projectRoot(project);
 if(realpathSync(project)!==root)throw Error('Project MCP registrations require the repository root; nested paths cannot be silently promoted');
 return root;
}
function validateReceipt(old,root){
 if(!old||old.project!==root||!Array.isArray(old.clients)||!old.clients.length||new Set(old.clients).size!==old.clients.length||old.clients.some(c=>!CLIENTS.includes(c))||!Array.isArray(old.files)||old.files.length!==old.clients.length)throw Error('Invalid connection receipt');
 const seen=new Set();
 for(const f of old.files){
  const allowed=f.client==='claude'?[join(root,'.mcp.json')]:f.client==='codex'?[join(root,'.codex/config.toml')]:[join(root,'opencode.json'),join(root,'opencode.jsonc')];
  if(!old.clients.includes(f.client)||seen.has(f.client)||!allowed.includes(f.path)||!(f.original===null||typeof f.original==='string')||!/^[a-f0-9]{64}$/.test(f.afterHash))throw Error('Invalid connection receipt');
  seen.add(f.client);
  if(f.originalHash!==undefined&&f.originalHash!==hash(f.original??''))throw Error('Original configuration checksum mismatch');
  if(f.client==='codex'){if(!/^[a-f0-9]{64}$/.test(f.blockHash))throw Error('Invalid connection block receipt');}
  else if(!f.entries||Array.isArray(f.entries)||typeof f.entries!=='object'||Object.keys(f.entries).some(k=>!MCP_TOOLS.some(id=>k==='aw-'+id)))throw Error('Invalid owned MCP entries');
 }
}
// Project connection receipts, read without modifying anything. `exists` is false when the
// project directory was removed or moved (for example a deleted worktree).
export function connectionReceipts(userRoot){
 const dir=join(locations(userRoot).store,'connections');if(!existsSync(dir))return [];
 return readdirSync(dir).filter(n=>n.endsWith('.json')).sort().map(name=>{
  const path=join(dir,name);let project=null;
  try{project=json(read(path)).project;}catch{}
  return {receipt:path,project:typeof project==='string'?project:null,exists:typeof project==='string'&&existsSync(project)};
 });
}
// Forget receipts whose project no longer exists. There is nothing left to restore there; copies
// of that project's config elsewhere keep their aw-* entries.
export function pruneConnections({userRoot,dryRun=false}={}){
 const orphans=connectionReceipts(userRoot).filter(r=>r.project&&!r.exists);
 const result={pruned:orphans.map(r=>r.project),dryRun,note:'Removed receipts only; nothing inside other checkouts was edited.'};
 if(dryRun||!orphans.length)return result;
 return lock(join(locations(userRoot).store,'connections'),()=>{
  for(const r of orphans){const now=read(r.receipt);if(now===null)continue;if(json(now).project!==r.project||existsSync(r.project))throw Error('Concurrent connection update: '+r.receipt);unlinkSync(r.receipt);}
  return result;
 });
}
export function connectionEntries(project,tools,userRoot){
 const entries={};for(const id of tools){if(!MCP_TOOLS.includes(id))throw Error('Not an MCP module: '+id);entries['aw-'+id]={command:process.execPath,args:[join(PACKAGE,'bin/agent-workflow.mjs'),'mcp','--tool',id,'--project',project,...(userRoot?['--user-root',locations(userRoot).home]:[])]};}return entries;
}
export function connect({project,tools=DEFAULT_MCP_TOOLS,clients=CLIENTS,userRoot,dryRun=false,remove=false}){
 if(!project)throw Error('Specify --project');if(!clients.length||new Set(clients).size!==clients.length||clients.some(c=>!CLIENTS.includes(c)))throw Error('Unsupported or duplicate client');
 const root=connectionRoot(project),loc=locations(userRoot),statePath=join(loc.store,'connections',hash(root)+'.json');
 const stateBefore=read(statePath),old=stateBefore?json(stateBefore):null;
 if(old)validateReceipt(old,root);
 if(remove&&!old)return {removed:false,reason:'not-connected'};
 if(old&&(old.project!==root||JSON.stringify([...old.clients].sort())!==JSON.stringify([...clients].sort())))throw Error('Connection client set changed; disconnect existing set first');
 const entries=connectionEntries(root,[...new Set(tools)],userRoot),changes=[];
 for(const client of clients){
  const prior=old?.files.find(f=>f.client===client);
  const path=prior?.path??(client==='claude'?join(root,'.mcp.json'):client==='codex'?join(root,'.codex/config.toml'):existsSync(join(root,'opencode.jsonc'))?join(root,'opencode.jsonc'):existsSync(join(root,'opencode.json'))?join(root,'opencode.json'):join(root,'opencode.jsonc'));
  if(!remove&&client==='opencode'&&prior&&existsSync(join(root,'opencode.jsonc'))&&prior.path!==join(root,'opencode.jsonc'))throw Error('OpenCode config selection changed; disconnect before reconnecting');
  noSymlinks(path);const before=read(path),previous=old?.files.find(f=>f.path===path);
  let after=before??'',owned;
  if(client==='codex'){
   const priorBlock=managed(after);parseToml(after);
   if((previous&&!priorBlock)||(priorBlock&&(!previous||hash(priorBlock)!==previous.blockHash)))throw Error('Edited/unowned Codex MCP block');
   const outside=parseToml(replace(after,null));for(const key of Object.keys(entries))if(outside.mcp_servers?.[key])throw Error('MCP name collision: '+key);
   const block=A+'\n'+Object.entries(entries).map(([name,value])=>`[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(value.command)}\nargs = ${JSON.stringify(value.args)}\n`).join('\n')+B;
   after=replace(after,remove?null:block);parseToml(after);owned={blockHash:remove?null:hash(block)};
  } else {
   const prefix=client==='claude'?['mcpServers']:['mcp','servers'];let obj=json(after||'{}');
   let container=obj;for(const key of prefix){const next=container?.[key];if(next!==undefined&&(!next||Array.isArray(next)||typeof next!=='object'))throw Error('Invalid MCP container');container=next;}
   for(const [key,value] of Object.entries(previous?.entries??{})){
    const present=prefix.reduce((v,k)=>v?.[k],obj)?.[key];if(JSON.stringify(present)!==JSON.stringify(value))throw Error('Edited managed MCP entry: '+key);
    after=updateJson(after,prefix.concat(key),undefined);obj=json(after);
   }
   const expected=Object.fromEntries(Object.entries(entries).map(([key,v])=>[key,client==='claude'?v:{type:'local',command:[v.command,...v.args]}]));
   if(!remove)for(const [key,value] of Object.entries(expected)){
    if(prefix.reduce((v,k)=>v?.[k],obj)?.[key]!==undefined)throw Error('MCP name collision: '+key);
    after=updateJson(after,prefix.concat(key),value);
   }
   owned={entries:expected};
  }
  const original=previous?previous.original:before;
  if(remove&&previous&&before!==null&&hash(before)===previous.afterHash)after=original;
  changes.push({path,before,after,original,originalHash:hash(original??''),client,...owned,afterHash:after===null?null:hash(after)});
 }
 if(dryRun)return {dryRun:true,project:root,remove,files:changes.map(f=>f.path),tools};
 return lock(join(loc.store,'connections'),()=>{
  if(read(statePath)!==stateBefore)throw Error('Concurrent connection update');
  const completed=[];try{
   for(const f of changes){if(read(f.path)!==f.before)throw Error('Concurrent config edit');if(f.after===null){if(f.before!==null)unlinkSync(f.path);}else atomic(f.path,f.after);completed.push(f);}
   if(remove)unlinkSync(statePath);else atomic(statePath,JSON.stringify({project:root,clients,tools,files:changes.map(({before,after,...f})=>f)},null,2)+'\n');
  }catch(e){for(const f of completed.reverse())if(read(f.path)===f.after){if(f.before===null)unlinkSync(f.path);else atomic(f.path,f.before);}throw e;}
  return {project:root,connected:!remove,files:changes.map(f=>f.path),tools,note:'Registrations only; restart/reload and approve project MCPs in each client. No credentials copied.'};
 });
}
