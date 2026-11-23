import {readFileSync,existsSync,unlinkSync,realpathSync,readdirSync,accessSync,statSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,modify,applyEdits,parseTree,findNodeAtLocation} from 'jsonc-parser';
import {parse as parseToml} from 'smol-toml';
import {hash,read,noSymlinks,atomic,lock,block,blockContent,START,END} from './files.mjs';

export const PACKAGE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Default set for install/sync/connect. The extra clients are installed only when named
// explicitly (--clients qwen,... or --clients all).
export const CORE_CLIENTS=['claude','codex','opencode'];
export const EXTRA_CLIENTS=['qwen','kimi','agy','commandcode','pi','mimo'];
export const ALL_CLIENTS=[...CORE_CLIENTS,...EXTRA_CLIENTS];
export const CLIENTS=CORE_CLIENTS;
export const VERSION=JSON.parse(readFileSync(join(PACKAGE,'package.json'),'utf8')).version;
export function parseClients(value){
  if(value===undefined||value===null||value==='')return CLIENTS;
  if(value==='all')return ALL_CLIENTS;
  return String(value).split(',').map(c=>c.trim()).filter(Boolean);
}

export function locations(userRoot){
  const home=realpathSync(resolve(userRoot??homedir()));
  const native=!userRoot;
  const env=name=>native&&process.env[name]?resolve(process.env[name]):null;
  const config=env('XDG_CONFIG_HOME')??join(home,'.config');
  return {
    home,config,
    codex:env('CODEX_HOME')??join(home,'.codex'),
    claude:env('CLAUDE_CONFIG_DIR')??join(home,'.claude'),
    opencode:join(config,'opencode'),
    store:join(home,'.local/share/agent-workflow'),
    skills:join(home,'.agents/skills'),
    qwen:env('QWEN_HOME')??join(home,'.qwen'),
    kimi:env('KIMI_CODE_HOME')??join(home,'.kimi-code'),
    gemini:join(home,'.gemini'),
    commandcode:join(home,'.commandcode'),
    pi:env('PI_CODING_AGENT_DIR')??join(home,'.pi/agent'),
    mimo:join(config,'mimocode'),
  };
}

// Clients that discover user skills in ~/.agents/skills. They share one copy there instead of
// receiving a duplicate in their own folder.
const SHARED_SKILL_READERS=['codex','qwen','kimi','commandcode','pi','mimo'];
// Global instruction file per client (MiMo is resolved by mimoRuleFile).
function ruleFile(client,loc){
  return {claude:join(loc.claude,'CLAUDE.md'),codex:join(loc.codex,'AGENTS.md'),opencode:join(loc.opencode,'AGENTS.md'),
    qwen:join(loc.qwen,'QWEN.md'),kimi:join(loc.kimi,'AGENTS.md'),agy:join(loc.gemini,'GEMINI.md'),commandcode:join(loc.commandcode,'AGENTS.md'),
    pi:join(loc.pi,'AGENTS.md'),mimo:join(loc.mimo,'AGENTS.md')}[client]??null;
}
// MiMo loads the first existing of $MIMOCODE_CONFIG_DIR/AGENTS.md, ~/.config/mimocode/AGENTS.md and
// ~/.claude/CLAUDE.md. Creating its own AGENTS.md would silently stop it from reading Claude's
// file, so the block goes there only when that file already exists (or was installed before), or
// when there is no Claude file to fall back to. Otherwise MiMo gets the rule from CLAUDE.md.
function mimoFallback(loc,clients,native){
  if(native&&process.env.MIMOCODE_DISABLE_CLAUDE_CODE_PROMPT)return false;
  return existsSync(join(loc.home,'.claude/CLAUDE.md'))||(clients.includes('claude')&&loc.claude===join(loc.home,'.claude'));
}
function mimoRuleFile(loc,clients,prior,native){
  const own=join(loc.mimo,'AGENTS.md');
  if(prior?.files.some(f=>f.path===own)||existsSync(own)||!mimoFallback(loc,clients,native))return own;
  return null;
}
// Maps one generated artifact (Rulesync project layout) to its global destinations.
function destinations(name,clients,loc){
  const out=[],has=c=>clients.includes(c);
  const map=(prefix,client,dir)=>{if(name.startsWith(prefix)&&has(client))out.push(join(dir,name.slice(prefix.length)));};
  map('.claude/','claude',loc.claude);
  map('.codex/','codex',loc.codex);
  map('.opencode/','opencode',loc.opencode);
  if(name.startsWith('.agents/skills/aw-workflow/')){
    if(SHARED_SKILL_READERS.some(has))out.push(join(loc.skills,name.slice(15)));
    if(has('agy'))out.push(join(loc.gemini,'config/skills',name.slice(15)));
  }
  map('.agents/skills/aw-start/','agy',join(loc.gemini,'config/skills/aw-start'));
  map('.agents/agents/','agy',join(loc.gemini,'config/agents'));
  for(const [prefix,client,dir] of [['.qwen/','qwen',loc.qwen],['.kimi-code/','kimi',loc.kimi],['.commandcode/','commandcode',loc.commandcode],['.pi/','pi',loc.pi],['.mimocode/','mimo',loc.mimo]])
    for(const sub of ['agents/','commands/','prompts/','skills/aw-start/'])map(prefix+sub,client,join(dir,sub));
  return out;
}

// Hook registrations. Claude and Codex keep their historical command (no --client) so existing
// installations do not drift or need renewed hook trust.
const claudeItem=command=>({hooks:[{type:'command',command,timeout:3}]});
const claudeOwned=(g,command)=>Array.isArray(g?.hooks)&&g.hooks.length===1&&g.hooks[0]?.command===command;
const CLAUDE_EVENTS=['SessionStart','SubagentStart','PreCompact'];
const HOOK_SPECS={
  claude:{file:loc=>join(loc.claude,'settings.json'),base:['hooks'],events:CLAUDE_EVENTS,item:claudeItem,owned:claudeOwned},
  codex:{file:loc=>join(loc.codex,'hooks.json'),base:['hooks'],events:CLAUDE_EVENTS,item:claudeItem,owned:claudeOwned},
  qwen:{file:loc=>join(loc.qwen,'settings.json'),base:['hooks'],events:CLAUDE_EVENTS,item:claudeItem,owned:claudeOwned,arg:true},
  commandcode:{file:loc=>join(loc.commandcode,'settings.json'),base:['hooks'],events:['SessionStart'],item:claudeItem,owned:claudeOwned,arg:true},
  agy:{file:loc=>join(loc.gemini,'config/hooks.json'),base:['agent-workflow'],events:['SessionStart'],item:command=>({type:'command',command,timeout:3}),owned:(g,command)=>g?.command===command,arg:true},
};
function specFor(f,loc){
  if(f.client!==undefined){if(!Object.hasOwn(HOOK_SPECS,f.client))throw Error('Invalid hook owner in installation manifest');return HOOK_SPECS[f.client];}
  return f.path===HOOK_SPECS.claude.file(loc)?HOOK_SPECS.claude:HOOK_SPECS.codex;
}
// Files whose content is generated from a template that points at the installed runtime.
const PLUGIN_FILES={
  pi:{path:loc=>join(loc.pi,'extensions/agent-workflow.js'),template:'lib/pi-extension.mjs'},
  mimo:{path:loc=>join(loc.mimo,'plugins/agent-workflow.js'),template:'lib/mimo-plugin.mjs'},
};

function allowedPaths(loc){
  const allowed=new Set([join(loc.opencode,'opencode.json'),join(loc.opencode,'opencode.jsonc'),join(loc.store,'bin/node'),join(loc.store,'opencode-plugin/index.mjs'),join(loc.store,'opencode-plugin/package.json')]);
  for(const n of ['gate.mjs','hook.mjs','validation-guard.mjs'])allowed.add(join(loc.store,'runtime',n));
  for(const c of ALL_CLIENTS){const r=ruleFile(c,loc);if(r)allowed.add(r);}
  for(const s of Object.values(HOOK_SPECS))allowed.add(s.file(loc));
  for(const p of Object.values(PLUGIN_FILES))allowed.add(p.path(loc));
  const generated=json(read(join(PACKAGE,'generated/manifest.json')));
  for(const n of Object.keys(generated.files))for(const d of destinations(n,ALL_CLIENTS,loc))allowed.add(d);
  return allowed;
}
function validateManifest(m,loc){
  if(m.schemaVersion!==1||m.home!==loc.home||!Array.isArray(m.clients)||!m.clients.length||m.clients.some(c=>!ALL_CLIENTS.includes(c))||!Array.isArray(m.files))throw Error('Invalid installation manifest');
  const allowed=allowedPaths(loc),seen=new Set();
  for(const f of m.files){
    if(!allowed.has(f.path)||seen.has(f.path)||!['file','block','hooks','plugin'].includes(f.kind)||!(f.original===null||typeof f.original==='string')||!/^[a-f0-9]{64}$/.test(f.afterHash))throw Error('Invalid owned path or entry in installation manifest');
    if(f.kind==='hooks'&&specFor(f,loc).file(loc)!==f.path)throw Error('Invalid owned path or entry in installation manifest');
    seen.add(f.path);
  }
}
export function json(text){const errors=[];const value=parse(text??'{}',errors,{allowTrailingComma:true});if(errors.length||!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid JSON/JSONC configuration; not overwritten');return value;}
function valid(text){const errors=[];parse(text,errors,{allowTrailingComma:true});return errors.length===0;}
function set(text,path,value,insert=false){
  text??='{}\n';
  const result=applyEdits(text,modify(text,path,value,{isArrayInsertion:insert,formattingOptions:{insertSpaces:true,tabSize:2}}));
  if(value!==undefined||valid(result))return result;
  // jsonc-parser 3.3.1 can emit invalid JSON when it removes the last element of a compact array
  // of objects ([{"a":1},{"b":2}] -> [{"a":1}}]). Fall back to cutting the node and its separator.
  const node=findNodeAtLocation(parseTree(text),path),target=node?.parent?.type==='property'?node.parent:node,siblings=target?.parent?.children??[];
  const i=siblings.indexOf(target);if(i<0)throw Error('Invalid JSON/JSONC configuration; not overwritten');
  const start=i>0?siblings[i-1].offset+siblings[i-1].length:target.offset,end=i>0?target.offset+target.length:siblings[1]?siblings[1].offset:target.offset+target.length;
  const cut=text.slice(0,start)+text.slice(end);
  if(!valid(cut))throw Error('Invalid JSON/JSONC configuration; not overwritten');
  return cut;
}
function quote(s){return "'"+s.replaceAll("'","'\\''")+"'";}
function at(value,path){let v=value;for(const k of path){if(!v||typeof v!=='object'||Array.isArray(v)||!Object.hasOwn(v,k))return undefined;v=v[k];}return v;}
function checkOwnedHooks(text,command,spec=HOOK_SPECS.claude){
  const value=json(text);
  for(const event of spec.events){
    const groups=at(value,[...spec.base,event]);
    if(!Array.isArray(groups))throw Error('Managed hook missing or changed: '+event);
    const matches=groups.filter(g=>spec.owned(g,command));
    if(matches.length!==1||JSON.stringify(matches[0])!==JSON.stringify(spec.item(command)))throw Error('Managed hook missing or changed: '+event);
  }
}
// Adds (or with remove=true strips) the owned hook entries, editing JSONC in place so comments
// and unrelated entries survive. Empty containers left by removal are deleted.
export function hooks(text,command,remove=false,spec=HOOK_SPECS.claude){
  let result=text??'{}\n';const obj=json(result);
  for(let i=1;i<=spec.base.length;i++){const v=at(obj,spec.base.slice(0,i));if(v!==undefined&&(!v||Array.isArray(v)||typeof v!=='object'))throw Error('Unsupported hooks configuration');}
  for(const event of spec.events){
    const path=[...spec.base,event];
    const original=at(json(result),path)??[];if(!Array.isArray(original))throw Error('Hook event is not an array');
    const indices=original.flatMap((g,i)=>spec.owned(g,command)?[i]:[]);
    if(!remove&&indices.length===1&&JSON.stringify(original[indices[0]])===JSON.stringify(spec.item(command)))continue;
    for(const i of indices.reverse())result=set(result,[...path,i],undefined);
    const current=at(json(result),path);
    if(!remove)result=current?set(result,[...path,current.length],spec.item(command),true):set(result,path,[spec.item(command)]);
    else if(current?.length===0)result=set(result,path,undefined);
  }
  if(remove)for(let i=spec.base.length;i>0;i--){const v=at(json(result),spec.base.slice(0,i));if(v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===0)result=set(result,spec.base.slice(0,i),undefined);}
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
  const loc=locations(userRoot);
  if(!Array.isArray(clients)||!clients.length||new Set(clients).size!==clients.length||clients.some(c=>!ALL_CLIENTS.includes(c)))throw Error('Use --clients with any of '+ALL_CLIENTS.join(',')+' (or all), without duplicates');
  clients=ALL_CLIENTS.filter(c=>clients.includes(c));
  const statePath=join(loc.store,'installation.json'),prior=read(statePath)?json(read(statePath)):null;
  if(prior)validateManifest(prior,loc);
  // Adding clients to an existing installation is a sync; removing them needs uninstall first,
  // because files owned only by a dropped client would otherwise leave the manifest untracked.
  if(prior&&prior.clients.some(c=>!clients.includes(c)))throw Error('Client set changed: uninstall first, then install the chosen set (adding clients with sync is allowed)');
  const manifest=json(read(join(PACKAGE,'generated/manifest.json'))),ops=[];
  for(const [name,digest] of Object.entries(manifest.files)){
    const source=join(PACKAGE,'generated',name),content=readFileSync(source,'utf8');if(hash(content)!==digest)throw Error('Generated artifact drift: run npm run build');
    for(const dest of destinations(name,clients,loc))ops.push({path:dest,kind:'file',content});
  }
  const rule=readFileSync(join(PACKAGE,'generated/AGENTS.md'),'utf8');
  for(const client of clients){const path=client==='mimo'?mimoRuleFile(loc,clients,prior,!userRoot):ruleFile(client,loc);if(path)ops.push({path,kind:'block',content:rule});}
  for(const name of ['gate.mjs','hook.mjs','validation-guard.mjs'])ops.push({path:join(loc.store,'runtime',name),kind:'file',content:readFileSync(join(PACKAGE,'lib',name),'utf8')});
  const shim=join(loc.store,'bin/node');
  ops.push({path:shim,kind:'file',content:nodeShim(nodePath??process.execPath),mode:0o755});
  const base=`${quote(shim)} ${quote(join(loc.store,'runtime/hook.mjs'))}`;
  for(const [client,spec] of Object.entries(HOOK_SPECS))if(clients.includes(client))
    ops.push({path:spec.file(loc),kind:'hooks',client,command:spec.arg?`${base} '--client' ${quote(client)}`:base});
  const gateUrl=pathToFileURL(join(loc.store,'runtime/gate.mjs')).href;
  for(const [client,p] of Object.entries(PLUGIN_FILES))if(clients.includes(client))
    ops.push({path:p.path(loc),kind:'file',content:readFileSync(join(PACKAGE,p.template),'utf8').replace("'__AW_GATE_URL__'",JSON.stringify(gateUrl))});
  if(clients.includes('opencode')){
    const dir=join(loc.store,'opencode-plugin');
    ops.push({path:join(dir,'index.mjs'),kind:'file',content:readFileSync(join(PACKAGE,'lib/opencode-plugin.mjs'),'utf8')});
    ops.push({path:join(dir,'package.json'),kind:'file',content:JSON.stringify({name:'agent-workflow-local',version:VERSION,type:'module',exports:'./index.mjs'})+'\n'});
    const config=existsSync(join(loc.opencode,'opencode.jsonc'))?join(loc.opencode,'opencode.jsonc'):existsSync(join(loc.opencode,'opencode.json'))?join(loc.opencode,'opencode.json'):join(loc.opencode,'opencode.jsonc');
    const ownedConfig=prior?.files.find(f=>f.kind==='plugin')?.path;
    if(ownedConfig&&ownedConfig!==config)throw Error('OpenCode config selection changed; uninstall the recorded integration before reinstalling');
    ops.push({path:config,kind:'plugin',plugin:dir});
  }
  const changes=ops.map(op=>{
    noSymlinks(op.path);const before=read(op.path),old=prior?.files.find(f=>f.path===op.path);
    if(op.kind==='file'&&before!==null&&(!old||hash(before)!==old.afterHash))throw Error('Unowned or edited destination: '+op.path);
    if(op.kind==='block'&&((old&&!blockContent(before))||(blockContent(before)&&(!old||hash(blockContent(before))!==old.blockHash))))throw Error('Edited/unowned rule block: '+op.path);
    const spec=op.kind==='hooks'?HOOK_SPECS[op.client]:null;
    if(op.kind==='hooks'&&old)checkOwnedHooks(before,old.command,specFor(old,loc));
    if(op.kind==='plugin'&&old&&(json(before).plugins??[]).filter(p=>p===old.plugin).length!==1)throw Error('Managed plugin registration changed');
    const start=op.kind==='hooks'&&old&&old.command!==op.command?hooks(before,old.command,true,specFor(old,loc)):before;
    const after=op.kind==='file'?op.content:op.kind==='block'?block(before,op.content):op.kind==='hooks'?hooks(start,op.command,false,spec):pluginConfig(before,op.plugin);
    return {...op,before,after,original:old?old.original:before,afterHash:hash(after),blockHash:op.kind==='block'?hash(blockContent(after)):null};
  });
  return {loc,statePath,clients,changes,prior};
}

// Codex records hook approval in config.toml as hooks.state."<hooks.json>:<event>:<group>:<handler>"
// with enabled = true once trusted. A missing or disabled entry for an Agent Workflow hook means
// Codex will not run it (it asks for review after the hook is new or its command changed). The
// trusted hash itself is not recomputed here, so an approval that went stale with enabled = true
// still left is not detected. Read-only: trust is never written or bypassed.
const snake=e=>e.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
export function codexHookTrust(loc,command){
  const file=HOOK_SPECS.codex.file(loc),fix='Open Codex interactively, run /hooks, review and trust the Agent Workflow hooks (SessionStart, SubagentStart, PreCompact); repeat after every agent-workflow sync that changes them. Do not use --dangerously-bypass-hook-trust.';
  let groups,state;
  try{groups=json(read(file)).hooks??{};}catch{return [];}
  try{const text=read(join(loc.codex,'config.toml'));state=text===null?{}:parseToml(text)?.hooks?.state??{};}catch{return [{issue:'codex-hook-trust-unknown',path:join(loc.codex,'config.toml'),fix}];}
  const out=[];
  for(const event of CLAUDE_EVENTS){
    const i=(groups[event]??[]).findIndex(g=>claudeOwned(g,command));if(i<0)continue;
    const key=`${file}:${snake(event)}:${i}:0`,entry=state[key];
    if(!entry)out.push({issue:'codex-hook-untrusted',event,key,fix});
    else if(entry.enabled!==true)out.push({issue:'codex-hook-not-enabled',event,key,fix});
  }
  return out;
}
// Native conditions that keep an installed piece from taking effect. Reported, never changed.
function notices(clients,loc){
  const out=[];
  if(clients.includes('mimo')&&!existsSync(join(loc.mimo,'AGENTS.md')))out.push(existsSync(join(loc.home,'.claude/CLAUDE.md'))&&(read(join(loc.home,'.claude/CLAUDE.md'))??'').includes(START)?'MiMo reads ~/.claude/CLAUDE.md (no ~/.config/mimocode/AGENTS.md), which carries the Agent Workflow block':'MiMo reads ~/.claude/CLAUDE.md, which has no Agent Workflow block: install the claude client too, or create ~/.config/mimocode/AGENTS.md and sync (MiMo then stops reading CLAUDE.md)');
  if(clients.includes('kimi'))out.push('Kimi Code: rule, skill, agents and aw-start installed; no hook (Kimi 2.7 does not inject SessionStart hook output)');
  if(clients.includes('commandcode'))out.push('Command Code may ask to trust hooks per project; never bypassed');
  return out;
}

export function install(options={}){
  const loc=locations(options.userRoot);
  if(options.dryRun){const p=plan(options);return {dryRun:true,changes:p.changes.filter(f=>f.before!==f.after).map(f=>({path:f.path,kind:f.kind})),clients:p.clients};}
  return lock(loc.store,()=>{
    const p=plan(options);const changed=p.changes.filter(f=>f.before!==f.after);
    const completed=[];
    try {
      for(const f of changed){if(read(f.path)!==f.before)throw Error('Concurrent change detected: '+f.path);atomic(f.path,f.after,f.mode);completed.push(f);}
      // Original config backup may contain private settings; store locally with private permissions only.
      const files=p.changes.map(({path,kind,original,afterHash,blockHash,command,plugin,client})=>({path,kind,original,afterHash,blockHash,command,plugin,...(kind==='hooks'?{client}:{})}));
      atomic(p.statePath,JSON.stringify({schemaVersion:1,version:VERSION,home:p.loc.home,clients:p.clients,files},null,2)+'\n');
    } catch(e){
      for(const f of completed.reverse())if(read(f.path)!==null&&hash(read(f.path))===f.afterHash){if(f.before===null)unlinkSync(f.path);else atomic(f.path,f.before);}
      throw e;
    }
    const n=notices(p.clients,p.loc);
    const codexHook=p.changes.find(f=>f.kind==='hooks'&&f.client==='codex');
    const warnings=codexHook?codexHookTrust(p.loc,codexHook.command):[];
    return {installed:true,changedFiles:changed.length,clients:p.clients,hookTrust:'Client hook approval may still be required; never bypassed',models:'Inherited; no global defaults changed',...(n.length?{notices:n}:{}),...(warnings.length?{warnings}:{})};
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
      if(f.kind==='hooks'){checkOwnedHooks(text,f.command,specFor(f,loc));for(const h of hookHealth(f.command,loc))issues.push({path:f.path,...h});}
      if(f.kind==='plugin'&&!(json(text).plugins??[]).includes(f.plugin))issues.push({path:f.path,issue:'plugin-missing'});
    }catch(e){issues.push({path:f.path,issue:e.message});}
  }
  const {outdated,error}=outdatedFiles(userRoot,m,loc);
  const result={ok:issues.length===0&&outdated.length===0&&!error,installed:true,status:issues.length?'drift':error?'unknown':outdated.length?'outdated':'ok',installedVersion:m.version??null,packageVersion:VERSION,clients:m.clients,issues,outdated};
  if(error)result.outdatedCheck=error;
  if(outdated.length)result.next='Installed files differ from this package: agent-workflow sync --global --clients '+m.clients.join(',')+' --dry-run, then the same command without --dry-run';
  const n=notices(m.clients,loc);if(n.length)result.notices=n;
  const codexHook=m.files.find(f=>f.kind==='hooks'&&specFor(f,loc)===HOOK_SPECS.codex);
  const warnings=codexHook?codexHookTrust(loc,codexHook.command):[];if(warnings.length)result.warnings=warnings;
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
function removeOwned(f,before,loc){
  let stripped,rebuilt,spec=null;
  if(f.kind==='block'){
    const owned=blockContent(before);block(before,null);
    if(hash(owned??'')!==f.blockHash)throw Error('Edited managed block: '+f.path);
    stripped=unblock(before);
    rebuilt=block(f.original,owned.slice(START.length+1,-(END.length+1)));
  } else if(f.kind==='hooks'){
    spec=specFor(f,loc);checkOwnedHooks(before,f.command,spec);stripped=hooks(before,f.command,true,spec);
    try{rebuilt=hooks(f.original,f.command,false,spec);}catch{rebuilt=null;}
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
      else after=removeOwned(f,before,loc);
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
