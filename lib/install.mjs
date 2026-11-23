import {readFileSync,existsSync,unlinkSync,realpathSync,readdirSync,accessSync,statSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse,modify,applyEdits} from 'jsonc-parser';
import {hash,read,noSymlinks,atomic,lock,block,blockContent,START,END} from './files.mjs';

export const PACKAGE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const CLIENTS=['claude','codex','opencode'];
export const VERSION=JSON.parse(readFileSync(join(PACKAGE,'package.json'),'utf8')).version;
function validateManifest(m,loc){
  if(m.schemaVersion!==1||m.home!==loc.home||!Array.isArray(m.clients)||!m.clients.length||m.clients.some(c=>!CLIENTS.includes(c))||!Array.isArray(m.files))throw Error('Invalid installation manifest');
  const allowed=new Set([join(loc.claude,'CLAUDE.md'),join(loc.claude,'settings.json'),join(loc.codex,'AGENTS.md'),join(loc.codex,'hooks.json'),join(loc.opencode,'AGENTS.md'),join(loc.opencode,'opencode.json'),join(loc.opencode,'opencode.jsonc'),join(loc.store,'runtime/gate.mjs'),join(loc.store,'runtime/hook.mjs'),join(loc.store,'runtime/validation-guard.mjs'),join(loc.store,'bin/node'),join(loc.store,'opencode-plugin/index.mjs'),join(loc.store,'opencode-plugin/package.json')]);
  const generated=json(read(join(PACKAGE,'generated/manifest.json')));
  for(const n of Object.keys(generated.files)){
    if(n.startsWith('.claude/'))allowed.add(join(loc.claude,n.slice(8)));
    if(n.startsWith('.codex/'))allowed.add(join(loc.codex,n.slice(7)));
    if(n.startsWith('.agents/skills/'))allowed.add(join(loc.skills,n.slice(15)));
    if(n.startsWith('.opencode/'))allowed.add(join(loc.opencode,n.slice(10)));
  }
  const seen=new Set();
  for(const f of m.files){
    if(!allowed.has(f.path)||seen.has(f.path)||!['file','block','hooks','plugin'].includes(f.kind)||!(f.original===null||typeof f.original==='string')||!/^[a-f0-9]{64}$/.test(f.afterHash))throw Error('Invalid owned path or entry in installation manifest');
    seen.add(f.path);
  }
}
export function locations(userRoot){
  const home=realpathSync(resolve(userRoot??homedir()));
  const native=!userRoot;
  const config=native&&process.env.XDG_CONFIG_HOME?resolve(process.env.XDG_CONFIG_HOME):join(home,'.config');
  const codex=native&&process.env.CODEX_HOME?resolve(process.env.CODEX_HOME):join(home,'.codex');
  const claude=native&&process.env.CLAUDE_CONFIG_DIR?resolve(process.env.CLAUDE_CONFIG_DIR):join(home,'.claude');
  return {home,config,codex,claude,opencode:join(config,'opencode'),store:join(home,'.local/share/agent-workflow'),skills:join(home,'.agents/skills')};
}
export function json(text){const errors=[];const value=parse(text??'{}',errors,{allowTrailingComma:true});if(errors.length||!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid JSON/JSONC configuration; not overwritten');return value;}
function set(text,path,value,insert=false){return applyEdits(text??'{}\n',modify(text??'{}\n',path,value,{isArrayInsertion:insert,formattingOptions:{insertSpaces:true,tabSize:2}}));}
function quote(s){return "'"+s.replaceAll("'","'\\''")+"'";}
function ownedHook(group,command){return Array.isArray(group?.hooks)&&group.hooks.length===1&&group.hooks[0]?.command===command;}
function hookGroup(command){return {hooks:[{type:'command',command,timeout:3}]};}
function checkOwnedHooks(text,command){
  const value=json(text);
  for(const event of ['SessionStart','SubagentStart','PreCompact']){
    const groups=value.hooks?.[event];
    if(!Array.isArray(groups))throw Error('Managed hook missing or changed: '+event);
    const matches=groups.filter(g=>ownedHook(g,command));
    if(matches.length!==1||JSON.stringify(matches[0])!==JSON.stringify(hookGroup(command)))throw Error('Managed hook missing or changed: '+event);
  }
}
export function hooks(text,command,remove=false){
  let result=text??'{}\n';const obj=json(result);if(obj.hooks!==undefined&&(!obj.hooks||Array.isArray(obj.hooks)||typeof obj.hooks!=='object'))throw Error('Unsupported hooks configuration');
  for(const event of ['SessionStart','SubagentStart','PreCompact']){
    const original=json(result).hooks?.[event]??[];if(!Array.isArray(original))throw Error('Hook event is not an array');
    const indices=original.flatMap((g,i)=>ownedHook(g,command)?[i]:[]);
    if(!remove&&indices.length===1&&JSON.stringify(original[indices[0]])===JSON.stringify(hookGroup(command)))continue;
    for(const i of indices.reverse())result=set(result,['hooks',event,i],undefined);
    const current=json(result).hooks?.[event];
    if(!remove)result=current?set(result,['hooks',event,current.length],hookGroup(command),true):set(result,['hooks',event],[hookGroup(command)]);
    else if(current?.length===0)result=set(result,['hooks',event],undefined);
  }
  if(remove&&Object.keys(json(result).hooks??{}).length===0)result=set(result,['hooks'],undefined);
  return result;
}
function pluginConfig(text,path,remove=false){
  const original=json(text).plugins??[];if(!Array.isArray(original))throw Error('OpenCode plugins must be an array');
  let result=text??'{}\n';const indices=original.flatMap((p,i)=>p===path?[i]:[]);
  if(!remove&&indices.length===1)return result;
  for(const i of indices.reverse())result=set(result,['plugins',i],undefined);
  const current=json(result).plugins;
  if(!remove)return current?set(result,['plugins',current.length],path,true):set(result,['plugins'],[path]);
  return current?.length===0?set(result,['plugins'],undefined):result;
}

// Stable hook entry point. Hooks call <store>/bin/node instead of an nvm-versioned path, so a
// sync is the only place that records which Node runs them. If that Node disappears, the shim
// falls back to the Node in PATH and otherwise exits 0 (hooks are advisory); verify and doctor
// report the missing Node so the user can repair it with npm link + sync.
export const SYNC_FIX='Run `npm link` in the agent-workflow checkout with the Node you want to keep, then `agent-workflow sync --global` and `agent-workflow verify`';
export function nodeShim(node){
  return `#!/bin/sh
# Agent Workflow hook runner (generated by agent-workflow sync; do not edit).
node=${quote(node)}
if [ -x "$node" ]; then exec "$node" "$@"; fi
if node=$(command -v node 2>/dev/null); then exec "$node" "$@"; fi
echo 'agent-workflow: recorded Node not found; run npm link in the checkout, then agent-workflow sync --global' >&2
exit 0
`;
}
function unquoteAll(text){return [...(text??'').matchAll(/'((?:[^']|'\\'')*)'/g)].map(m=>m[1].replaceAll("'\\''","'"));}
export function shimNode(text){const m=/^node=('(?:[^']|'\\'')*')$/m.exec(text??'');return m?unquoteAll(m[1])[0]:null;}
function runnable(path){try{accessSync(path,constants.X_OK);return statSync(path).isFile();}catch{return false;}}
// Checks what an installed hook command points to: runner (shim or legacy absolute node), the
// Node the shim records, and the runtime script.
export function hookHealth(command,loc){
  const [runner,script]=unquoteAll(command);if(!runner||!script)return [{issue:'hook-command-unrecognized',fix:SYNC_FIX}];
  const issues=[];let node=runner;
  if(runner===join(loc.store,'bin/node')){
    if(!runnable(runner))return [{issue:'hook-runner-missing',runner,fix:SYNC_FIX}];
    node=shimNode(read(runner));
  }
  if(!node||!runnable(node))issues.push({issue:'hook-node-missing',node,fallback:runner===join(loc.store,'bin/node')?'Node from PATH, if any':'none; hooks fail',fix:SYNC_FIX});
  if(read(script)===null)issues.push({issue:'hook-runtime-missing',script,fix:SYNC_FIX});
  return issues;
}

export function plan({userRoot,clients=CLIENTS,nodePath}={}){
  const loc=locations(userRoot);clients=[...new Set(clients)];if(!clients.length||clients.some(c=>!CLIENTS.includes(c)))throw Error('Use claude,codex,opencode');
  const statePath=join(loc.store,'installation.json'),prior=read(statePath)?json(read(statePath)):null;
  if(prior)validateManifest(prior,loc);
  const manifest=json(read(join(PACKAGE,'generated/manifest.json'))),ops=[];
  for(const [name,digest] of Object.entries(manifest.files)){
    const source=join(PACKAGE,'generated',name),content=readFileSync(source,'utf8');if(hash(content)!==digest)throw Error('Generated artifact drift: run npm run build');
    let dest;
    if(name.startsWith('.claude/')&&clients.includes('claude'))dest=join(loc.claude,name.slice(8));
    else if(name.startsWith('.codex/')&&clients.includes('codex'))dest=join(loc.codex,name.slice(7));
    else if(name.startsWith('.agents/skills/')&&clients.includes('codex'))dest=join(loc.skills,name.slice(15));
    else if(name.startsWith('.opencode/')&&clients.includes('opencode'))dest=join(loc.opencode,name.slice(10));
    if(dest)ops.push({path:dest,kind:'file',content});
  }
  const rule=readFileSync(join(PACKAGE,'generated/AGENTS.md'),'utf8');
  for(const client of clients){
    const path=client==='claude'?join(loc.claude,'CLAUDE.md'):client==='codex'?join(loc.codex,'AGENTS.md'):join(loc.opencode,'AGENTS.md');
    ops.push({path,kind:'block',content:rule});
  }
  for(const name of ['gate.mjs','hook.mjs','validation-guard.mjs'])ops.push({path:join(loc.store,'runtime',name),kind:'file',content:readFileSync(join(PACKAGE,'lib',name),'utf8')});
  const shim=join(loc.store,'bin/node');
  ops.push({path:shim,kind:'file',content:nodeShim(nodePath??process.execPath),mode:0o755});
  const command=`${quote(shim)} ${quote(join(loc.store,'runtime/hook.mjs'))}`;
  if(clients.includes('claude'))ops.push({path:join(loc.claude,'settings.json'),kind:'hooks',command});
  if(clients.includes('codex'))ops.push({path:join(loc.codex,'hooks.json'),kind:'hooks',command});
  if(clients.includes('opencode')){
    const dir=join(loc.store,'opencode-plugin');
    ops.push({path:join(dir,'index.mjs'),kind:'file',content:readFileSync(join(PACKAGE,'lib/opencode-plugin.mjs'),'utf8')});
    ops.push({path:join(dir,'package.json'),kind:'file',content:JSON.stringify({name:'agent-workflow-local',version:VERSION,type:'module',exports:'./index.mjs'})+'\n'});
    const config=existsSync(join(loc.opencode,'opencode.jsonc'))?join(loc.opencode,'opencode.jsonc'):existsSync(join(loc.opencode,'opencode.json'))?join(loc.opencode,'opencode.json'):join(loc.opencode,'opencode.jsonc');
    const ownedConfig=prior?.files.find(f=>f.kind==='plugin')?.path;
    if(ownedConfig&&ownedConfig!==config)throw Error('OpenCode config selection changed; uninstall the recorded integration before reinstalling');
    ops.push({path:config,kind:'plugin',plugin:dir});
  }
  if(prior&&JSON.stringify([...prior.clients].sort())!==JSON.stringify([...clients].sort()))throw Error('Client set changed: uninstall first, then install the chosen set');
  const changes=ops.map(op=>{
    noSymlinks(op.path);const before=read(op.path),old=prior?.files.find(f=>f.path===op.path);
    if(op.kind==='file'&&before!==null&&(!old||hash(before)!==old.afterHash))throw Error('Unowned or edited destination: '+op.path);
    if(op.kind==='block'&&((old&&!blockContent(before))||(blockContent(before)&&(!old||hash(blockContent(before))!==old.blockHash))))throw Error('Edited/unowned rule block: '+op.path);
    if(op.kind==='hooks'&&old)checkOwnedHooks(before,old.command);
    if(op.kind==='plugin'&&old&&(json(before).plugins??[]).filter(p=>p===old.plugin).length!==1)throw Error('Managed plugin registration changed');
    const base=op.kind==='hooks'&&old&&old.command!==op.command?hooks(before,old.command,true):before;
    const after=op.kind==='file'?op.content:op.kind==='block'?block(before,op.content):op.kind==='hooks'?hooks(base,op.command):pluginConfig(before,op.plugin);
    return {...op,before,after,original:old?old.original:before,afterHash:hash(after),blockHash:op.kind==='block'?hash(blockContent(after)):null};
  });
  return {loc,statePath,clients,changes,prior};
}

export function install(options={}){
  const loc=locations(options.userRoot);
  if(options.dryRun){const p=plan(options);return {dryRun:true,changes:p.changes.filter(f=>f.before!==f.after).map(f=>({path:f.path,kind:f.kind})),clients:p.clients};}
  return lock(loc.store,()=>{
    const p=plan(options);const changed=p.changes.filter(f=>f.before!==f.after);
    if(options.dryRun)return {dryRun:true,changes:changed.map(f=>({path:f.path,kind:f.kind})),clients:p.clients};
    const completed=[];
    try {
      for(const f of changed){if(read(f.path)!==f.before)throw Error('Concurrent change detected: '+f.path);atomic(f.path,f.after,f.mode);completed.push(f);}
      // Original config backup may contain private settings; store locally with private permissions only.
      const files=p.changes.map(({path,kind,original,afterHash,blockHash,command,plugin})=>({path,kind,original,afterHash,blockHash,command,plugin}));
      atomic(p.statePath,JSON.stringify({schemaVersion:1,version:VERSION,home:p.loc.home,clients:p.clients,files},null,2)+'\n');
    } catch(e){
      for(const f of completed.reverse())if(read(f.path)!==null&&hash(read(f.path))===f.afterHash){if(f.before===null)unlinkSync(f.path);else atomic(f.path,f.before);}
      throw e;
    }
    return {installed:true,changedFiles:changed.length,clients:p.clients,hookTrust:'Client hook approval may still be required; never bypassed',models:'Inherited; no global defaults changed'};
  });
}

export function verify({userRoot}={}){
  const loc=locations(userRoot),raw=read(join(loc.store,'installation.json'));if(!raw)return {ok:false,installed:false,issues:['not-installed']};
  const m=json(raw),issues=[];validateManifest(m,loc);
  for(const f of m.files){
    try{
      noSymlinks(f.path);const text=read(f.path);
      if(text===null){issues.push({path:f.path,issue:'missing'});continue;}
      if(f.kind==='file'&&hash(text)!==f.afterHash)issues.push({path:f.path,issue:'edited'});
      if(f.kind==='block'&&hash(blockContent(text)??'')!==f.blockHash)issues.push({path:f.path,issue:'rule-block-drift'});
      if(f.kind==='hooks'){checkOwnedHooks(text,f.command);for(const h of hookHealth(f.command,loc))issues.push({path:f.path,...h});}
      if(f.kind==='plugin'&&!(json(text).plugins??[]).includes(f.plugin))issues.push({path:f.path,issue:'plugin-missing'});
    }catch(e){issues.push({path:f.path,issue:e.message});}
  }
  const {outdated,error}=outdatedFiles(userRoot,m,loc);
  const result={ok:issues.length===0&&outdated.length===0&&!error,installed:true,status:issues.length?'drift':error?'unknown':outdated.length?'outdated':'ok',installedVersion:m.version??null,packageVersion:VERSION,clients:m.clients,issues,outdated};
  if(error)result.outdatedCheck=error;
  if(outdated.length)result.next='Installed files differ from this package: agent-workflow sync --global --dry-run, then agent-workflow sync --global';
  return {...result,scope:'Files and registrations only; native loading, hook trust and LSP integration require client verification'};
}
// Compares the installation with what this package (generated/ and runtime) would install now.
// A shim that only records another Node which still exists is not outdated.
function outdatedFiles(userRoot,m,loc){
  let p;try{p=plan({userRoot,clients:m.clients});}catch(e){return {outdated:[],error:e.message};}
  const owned=new Set(m.files.map(f=>f.path)),planned=new Set(p.changes.map(c=>c.path)),outdated=[];
  for(const c of p.changes){
    if(c.before===c.after||(c.before===null&&owned.has(c.path)))continue;
    if(c.path===join(loc.store,'bin/node')){const node=shimNode(c.before);if(node&&c.before===nodeShim(node)&&runnable(node))continue;}
    outdated.push({path:c.path,kind:c.kind,reason:owned.has(c.path)?'differs-from-package':'new-in-package'});
  }
  for(const f of m.files)if(!planned.has(f.path))outdated.push({path:f.path,kind:f.kind,reason:'no-longer-shipped'});
  return {outdated};
}

// Shared config (rule block, hooks, plugin list): remove only what Agent Workflow owns.
// The recorded original is reused only when the file is byte-identical to applying the
// current owned part to it, i.e. nobody edited the file after the first install. A sync
// refreshes afterHash but never the original, so a hash match alone is not that proof.
function unblock(text){
  const a=text.indexOf(START),b=text.indexOf(END);if(a<0)return text;
  let start=a,end=b+END.length;
  if(text[end]==='\n')end++;
  if(text.slice(start-2,start)==='\n\n')start--;
  return text.slice(0,start)+text.slice(end);
}
function onlyOwned(f,text){
  if(f.kind==='block')return !text.trim();
  return Object.keys(json(text)).length===0&&text.replace(/\s/g,'')==='{}';
}
function removeOwned(f,before){
  let stripped,rebuilt;
  if(f.kind==='block'){
    const owned=blockContent(before);block(before,null);
    if(hash(owned??'')!==f.blockHash)throw Error('Edited managed block: '+f.path);
    stripped=unblock(before);
    rebuilt=block(f.original,owned.slice(START.length+1,-(END.length+1)));
  } else if(f.kind==='hooks'){
    checkOwnedHooks(before,f.command);stripped=hooks(before,f.command,true);
    try{rebuilt=hooks(f.original,f.command);}catch{rebuilt=null;}
  } else if(f.kind==='plugin'){
    stripped=pluginConfig(before,f.plugin,true);
    try{rebuilt=pluginConfig(f.original,f.plugin);}catch{rebuilt=null;}
  } else throw Error('Unsupported manifest entry');
  if(rebuilt===before)return f.original;
  if(f.original===null&&onlyOwned(f,stripped))return null;
  return stripped;
}

export function uninstall({userRoot,dryRun=false}={}){
  const loc=locations(userRoot);
  const connections=join(loc.store,'connections');
  const receipts=existsSync(connections)?readdirSync(connections).filter(n=>n.endsWith('.json')):[];
  if(receipts.length){
    const projects=receipts.map(n=>{try{return json(read(join(connections,n))).project;}catch{return null;}});
    const live=projects.filter(p=>typeof p==='string'&&existsSync(p)),gone=projects.filter(p=>typeof p==='string'&&!existsSync(p)),bad=projects.filter(p=>typeof p!=='string').length;
    throw Error('Disconnect project MCP registrations before uninstalling Agent Workflow.'+(live.length?` Connected: ${live.join(', ')}; run agent-workflow disconnect --project PATH for each (same --clients as connect).`:'')+(gone.length?` Project no longer exists: ${gone.join(', ')}; run agent-workflow disconnect --prune.`:'')+(bad?` ${bad} unreadable receipt(s) in ${connections}; inspect them manually.`:''));
  }
  if(!read(join(loc.store,'installation.json')))return {uninstalled:false,reason:'not-installed'};
  return lock(loc.store,()=>{
    const path=join(loc.store,'installation.json'),raw=read(path);if(!raw)return {uninstalled:false,reason:'not-installed'};
    const m=json(raw);validateManifest(m,loc);
    const changes=[];
    for(const f of m.files){
      noSymlinks(f.path);const before=read(f.path);if(before===null)continue;
      let after;
      if(f.kind==='file'){if(hash(before)!==f.afterHash)throw Error('Edited owned file; preserve it before uninstall: '+f.path);after=f.original;}
      else after=removeOwned(f,before);
      changes.push({path:f.path,before,after});
    }
    if(dryRun)return {dryRun:true,changes:changes.map(f=>f.path)};
    const completed=[];
    try{
      for(const f of changes){if(read(f.path)!==f.before)throw Error('Concurrent change detected: '+f.path);if(f.after===null)unlinkSync(f.path);else atomic(f.path,f.after);completed.push(f);}
      unlinkSync(path);
    }catch(e){for(const f of completed.reverse())if(read(f.path)===f.after)atomic(f.path,f.before);throw e;}
    return {uninstalled:true,files:changes.length,retained:'Unrelated config, user edits outside managed blocks, empty directories, optional tools'};
  });
}
