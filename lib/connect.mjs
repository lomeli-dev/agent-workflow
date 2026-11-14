import {existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {modify,applyEdits} from 'jsonc-parser';
import {parse as parseToml} from 'smol-toml';
import {locations,PACKAGE,json,CLIENTS} from './install.mjs';
import {projectRoot} from './gate.mjs';
import {atomic,noSymlinks,read,hash,lock} from './files.mjs';
import {MCP_TOOLS} from './mcp-launch.mjs';
const A='# agent-workflow:mcp:begin',B='# agent-workflow:mcp:end';
function managed(text){const a=(text??'').indexOf(A),b=(text??'').indexOf(B);if((a<0)!==(b<0)||b<a)throw Error('Malformed managed MCP block');return a<0?null:text.slice(a,b+B.length);}
function replace(text,body){text??='';const old=managed(text);if(old)return text.replace(old,body??'');return text+(text&&!text.endsWith('\n')?'\n':'')+(body?'\n'+body+'\n':'');}
function updateJson(text,path,value){return applyEdits(text??'{}\n',modify(text??'{}\n',path,value,{formattingOptions:{insertSpaces:true,tabSize:2}}));}
export function connectionEntries(project,tools,userRoot){
 const entries={};for(const id of tools){if(!MCP_TOOLS.includes(id))throw Error('Not an MCP module: '+id);entries['aw-'+id]={command:process.execPath,args:[join(PACKAGE,'bin/agent-workflow.mjs'),'mcp','--tool',id,'--project',project,...(userRoot?['--user-root',locations(userRoot).home]:[])]};}return entries;
}
export function connect({project,tools=MCP_TOOLS,clients=CLIENTS,userRoot,dryRun=false,remove=false}){
 if(!project)throw Error('Specify --project');if(clients.some(c=>!CLIENTS.includes(c)))throw Error('Unsupported client');
 const root=projectRoot(project),loc=locations(userRoot),statePath=join(loc.store,'connections',hash(root)+'.json');
 const stateBefore=read(statePath),old=stateBefore?json(stateBefore):null;
 if(old&&(!Array.isArray(old.clients)||!Array.isArray(old.files)||old.files.some(f=>![join(root,'.mcp.json'),join(root,'.codex/config.toml'),join(root,'opencode.json'),join(root,'opencode.jsonc')].includes(f.path)||!(f.original===null||typeof f.original==='string'))))throw Error('Invalid connection receipt');
 if(remove&&!old)return {removed:false,reason:'not-connected'};
 if(old&&(old.project!==root||JSON.stringify([...old.clients].sort())!==JSON.stringify([...clients].sort())))throw Error('Connection client set changed; disconnect existing set first');
 const entries=connectionEntries(root,[...new Set(tools)],userRoot),changes=[];
 for(const client of clients){
  const path=client==='claude'?join(root,'.mcp.json'):client==='codex'?join(root,'.codex/config.toml'):existsSync(join(root,'opencode.jsonc'))?join(root,'opencode.jsonc'):existsSync(join(root,'opencode.json'))?join(root,'opencode.json'):join(root,'opencode.jsonc');
  noSymlinks(path);const before=read(path),previous=old?.files.find(f=>f.path===path);
  let after=before??'',owned;
  if(client==='codex'){
   const parsed=parseToml(after),priorBlock=managed(after);
   if(priorBlock&&(!previous||hash(priorBlock)!==previous.blockHash))throw Error('Edited/unowned Codex MCP block');
   const outside=parseToml(replace(after,null));for(const key of Object.keys(entries))if(outside.mcp_servers?.[key])throw Error('MCP name collision: '+key);
   const block=A+'\n'+Object.entries(entries).map(([name,value])=>`[mcp_servers.${JSON.stringify(name)}]\ncommand = ${JSON.stringify(value.command)}\nargs = ${JSON.stringify(value.args)}\n`).join('\n')+B;
   after=replace(after,remove?null:block);parseToml(after);owned={blockHash:remove?null:hash(block)};
  } else {
   const prefix=client==='claude'?['mcpServers']:['mcp','servers'];let obj=json(after||'{}');
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
  changes.push({path,before,after,original,client,...owned,afterHash:after===null?null:hash(after)});
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
