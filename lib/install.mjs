import {readFileSync,existsSync,unlinkSync,realpathSync,readdirSync,accessSync,statSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parse,modify,applyEdits,parseTree,findNodeAtLocation} from 'jsonc-parser';
import {parse as parseToml} from 'smol-toml';
import {hash,read,noSymlinks,atomic,lock,block,blockContent,unblock,blockInner,START} from './files.mjs';
import {codexBinary,listHooksSync} from './codex-app-server.mjs';

export const PACKAGE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Default set for install/sync/connect. The extra clients are installed only when named
// explicitly (--clients qwen,... or --clients all).
export const CORE_CLIENTS=['claude','codex','opencode'];
export const EXTRA_CLIENTS=['qwen','kimi','agy','commandcode','pi','mimo','dsh'];
export const ALL_CLIENTS=[...CORE_CLIENTS,...EXTRA_CLIENTS];
export const CLIENTS=CORE_CLIENTS;
export const VERSION=JSON.parse(readFileSync(join(PACKAGE,'package.json'),'utf8')).version;
export function parseClients(value){
  if(value===undefined||value===null||value==='')return CLIENTS;
  if(value==='all')return ALL_CLIENTS;
  return String(value).split(',').map(c=>c.trim()).filter(Boolean);
}
// --guard LIST|none; undefined keeps the installed choice.
export function parseGuard(value){
  if(value===undefined||value===null)return undefined;
  if(value==='none')return [];
  const list=String(value).split(',').map(c=>c.trim()).filter(Boolean);
  if(!list.length)throw Error('Use --guard with claude, codex or none');
  return list;
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
    dsh:env('DSH_HOME')??join(home,'.dsh'),
  };
}

// Clients that discover user skills in ~/.agents/skills. They share one copy there instead of
// receiving a duplicate in their own folder. (DeepSeek Harness scans $DSH_AGENTS_HOME/skills,
// default ~/.agents/skills.)
const SHARED_SKILL_READERS=['codex','qwen','kimi','commandcode','pi','mimo','dsh'];
// Global instruction file per client (MiMo is resolved by mimoRuleFile).
function ruleFile(client,loc){
  return {claude:join(loc.claude,'CLAUDE.md'),codex:join(loc.codex,'AGENTS.md'),opencode:join(loc.opencode,'AGENTS.md'),
    qwen:join(loc.qwen,'QWEN.md'),kimi:join(loc.kimi,'AGENTS.md'),agy:join(loc.gemini,'GEMINI.md'),commandcode:join(loc.commandcode,'AGENTS.md'),
    pi:join(loc.pi,'AGENTS.md'),mimo:join(loc.mimo,'AGENTS.md'),dsh:join(loc.dsh,'AGENTS.md')}[client]??null;
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
  map('.agents/skills/aw-start/','dsh',join(loc.dsh,'skills/aw-start'));
  map('.agents/agents/','agy',join(loc.gemini,'config/agents'));
  for(const [prefix,client,dir] of [['.qwen/','qwen',loc.qwen],['.kimi-code/','kimi',loc.kimi],['.commandcode/','commandcode',loc.commandcode],['.pi/','pi',loc.pi],['.mimocode/','mimo',loc.mimo]])
    for(const sub of ['agents/','commands/','prompts/','skills/aw-start/'])map(prefix+sub,client,join(dir,sub));
  return out;
}

// Hook registrations. Claude and Codex keep their historical command (no --client) so existing
// installations do not drift or need renewed hook trust.
// The PreToolUse entry (validation guard) uses the same command as the reminder hooks, plus a
// matcher for the client's shell tool; the runtime answers it with a deny or nothing.
const GUARD_EVENT='PreToolUse';
const claudeItem=(command,event,spec)=>({...(event===GUARD_EVENT?{matcher:spec.guard}:{}),hooks:[{type:'command',command,timeout:3}]});
const claudeOwned=(g,command)=>Array.isArray(g?.hooks)&&g.hooks.length===1&&g.hooks[0]?.command===command;
const CLAUDE_EVENTS=['SessionStart','SubagentStart','PreCompact'];
// events: reminder events always installed. guard: shell-tool matcher of the PreToolUse
// validation guard. optInGuard: only with --guard (Claude, Codex), see GUARD_OPT_IN.
const HOOK_SPECS={
  claude:{file:loc=>join(loc.claude,'settings.json'),base:['hooks'],events:CLAUDE_EVENTS,item:claudeItem,owned:claudeOwned,guard:'Bash',optInGuard:true},
  codex:{file:loc=>join(loc.codex,'hooks.json'),base:['hooks'],events:CLAUDE_EVENTS,item:claudeItem,owned:claudeOwned,guard:'Bash',optInGuard:true},
  qwen:{file:loc=>join(loc.qwen,'settings.json'),base:['hooks'],events:CLAUDE_EVENTS,item:claudeItem,owned:claudeOwned,arg:true,guard:'run_shell_command'},
  commandcode:{file:loc=>join(loc.commandcode,'settings.json'),base:['hooks'],events:['SessionStart'],item:claudeItem,owned:claudeOwned,arg:true,guard:'^SHELL$'},
  // Antigravity: flat handlers for SessionStart, a matcher group for PreToolUse (run_command).
  agy:{file:loc=>join(loc.gemini,'config/hooks.json'),base:['agent-workflow'],events:['SessionStart'],item:(command,event,spec)=>event===GUARD_EVENT?claudeItem(command,event,spec):{type:'command',command,timeout:3},owned:(g,command)=>g?.command===command||claudeOwned(g,command),arg:true,guard:'run_command'},
};
export const GUARD_OPT_IN=Object.keys(HOOK_SPECS).filter(c=>HOOK_SPECS[c].optInGuard);
// Without --guard and without a recorded choice (new installs, and 0.5.x installs that never
// enabled it), 0.6.0 installs the Claude guard, and the Codex one when --trust-codex approves it.
export function defaultGuard(clients,trustCodex){return GUARD_OPT_IN.filter(c=>clients.includes(c)&&(c==='claude'||(c==='codex'&&!!trustCodex)));}

// DeepSeek Harness (dsh). Hooks run through the official @deepseek-ai/dsh-hooks-claude-code bridge,
// which reads one Claude-format hooks.json (configPath) per process. Agent Workflow owns that file
// in its store and mounts the bridge with an `insert` row in a managed YAML block of each profile's
// user patch layer, <dsh>/profiles/<name>/cordis.patch.yml (never cordis.yml). The bridge is a
// package of the profile; it is never installed here (see notices).
const DSH_PLUGIN='@deepseek-ai/dsh-hooks-claude-code';
const DSH_EVENTS=['SessionStart','SubagentStart',GUARD_EVENT];
const dshHooksFile=loc=>join(loc.store,'dsh/hooks.json');
const PROFILE_NAME=/^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
function dshPatchProfile(path,loc){
  const dir=dirname(path),name=dir.slice(join(loc.dsh,'profiles').length+1);
  return path===join(loc.dsh,'profiles',name,'cordis.patch.yml')&&PROFILE_NAME.test(name)&&name!=='node_modules'?name:null;
}
// The bridge imports its peer @deepseek-ai/dsh-hook-protocol, which the dsh package does not ship
// and pnpm does not add (autoInstallPeers: false): without it in the profile the entry fails to
// import (dsh boots with "1 entry did not activate"), or resolves an older copy from
// profiles/node_modules and fails on a missing export. Both packages are read, never installed.
const DSH_PROTOCOL='@deepseek-ai/dsh-hook-protocol';
const pkg=(dir,name)=>{try{return json(read(join(dir,'node_modules',name,'package.json')));}catch{return null;}};
// Profiles are the directories of <dsh>/profiles with a cordis.yml or package.json (the shared
// profiles/node_modules is not one). hasPlugin: the bridge and its matching peer are in the profile.
export function dshProfiles(loc){
  const root=join(loc.dsh,'profiles');let names=[];
  try{names=readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory()&&PROFILE_NAME.test(d.name)&&d.name!=='node_modules').map(d=>d.name).sort();}catch{}
  return names.flatMap(name=>{
    const dir=join(root,name);if(!existsSync(join(dir,'cordis.yml'))&&!existsSync(join(dir,'package.json')))return [];
    const plugin=pkg(dir,DSH_PLUGIN),version=typeof plugin?.version==='string'?plugin.version:null;
    const wanted=version===null?null:String(plugin.peerDependencies?.[DSH_PROTOCOL]??version).replace(/^[\^~=]/,''),protocol=pkg(dir,DSH_PROTOCOL)?.version??null;
    return [{name,dir,patch:join(dir,'cordis.patch.yml'),version,protocol,wanted,hasPlugin:version!==null&&protocol!==null&&protocol===wanted}];
  });
}
const dshHooks=command=>JSON.stringify({hooks:Object.fromEntries(DSH_EVENTS.map(e=>[e,[claudeItem(command,e,{guard:'^bash$'})]]))},null,2)+'\n';
// Project MCP for dsh (0.6.1). dsh composes profiles from bundles, the profile and home patch layers
// and --patch overlays only; there is no project layer. Each profile block therefore carries one
// @deepseek-ai/dsh-mcp-client row per MCP module (dsh ships that plugin), enabled only when the
// directory dsh starts in has .dsh/agent-workflow-mcp.json (written by connect) listing that
// server; command and args come from that file. Outside connected projects the rows stay disabled.
export const DSH_MCP_TOOLS=['serena','codegraph','playwright-mcp','devtools','context7'];
export const DSH_PROJECT_MCP='.dsh/agent-workflow-mcp.json';
const dshServer=name=>`((n)=>{try{return JSON.parse(process.getBuiltinModule('node:fs').readFileSync(process.cwd()+'/${DSH_PROJECT_MCP}','utf8')).mcpServers[n]}catch{return undefined}})(${JSON.stringify(name)})`;
const dshMcpRow=tool=>{const n='aw-'+tool;return [`    - id: agent-workflow-mcp-${tool}`,"      name: '@deepseek-ai/dsh-mcp-client'",`      disabled: !!js ${JSON.stringify('!'+dshServer(n))}`,'      config:',`        serverName: ${n}`,'        transport: stdio',`        command: !!js ${JSON.stringify(`(${dshServer(n)}??{}).command??'false'`)}`,`        args: !!js ${JSON.stringify(`(${dshServer(n)}??{}).args??[]`)}`].join('\n');};
const dshInsert=(loc,hooks)=>['- insert:',...(hooks?['    - id: agent-workflow-hooks',`      name: '${DSH_PLUGIN}'`,'      config:',`        configPath: ${JSON.stringify(dshHooksFile(loc))}`]:[]),...DSH_MCP_TOOLS.map(dshMcpRow)].join('\n');
// cordis.patch.yml must be a top-level YAML list. Only the block layout written by dsh and people
// (`- ` items at column 0, comments, or a lone `[]`) is edited; anything else is left untouched.
const yamlLines=text=>(text??'').split('\n').filter(l=>l.trim()&&!/^\s*#/.test(l));
function yamlText(text,path){
  if(text===null)return;const lines=yamlLines(text);
  if(lines.length===1&&lines[0].trim()==='[]')return;
  if(lines.length&&!/^-(\s|$)/.test(lines[0])||lines.some(l=>!/^(-(\s|$)|\s)/.test(l)))throw Error('Unsupported cordis.patch.yml layout (expected a block list of patches); not modified: '+path);
}
function dshEditable(path){try{const text=read(path);yamlText(text===null?null:unblock(text,'yaml'),path);return true;}catch{return false;}}
// The empty flow list `[]` cannot be followed by block items: it is dropped when the block is
// added and restored when removing the block leaves no patch.
const dropEmptyList=text=>text===null?null:yamlLines(text).length===1&&yamlLines(text)[0].trim()==='[]'?text.replace(/^\s*\[\]\s*$\n?/m,''):text;
const restoreEmptyList=text=>yamlLines(text).length?text:text+(text&&!text.endsWith('\n')?'\n':'')+'[]\n';
// Events recorded for a manifest hook entry; entries written before 0.5.0 have no list.
function entryEvents(f,spec){
  if(f.events===undefined)return spec.events;
  const allowed=[...spec.events,...(spec.guard?[GUARD_EVENT]:[])];
  if(!Array.isArray(f.events)||spec.events.some(e=>!f.events.includes(e))||f.events.some(e=>!allowed.includes(e))||new Set(f.events).size!==f.events.length)throw Error('Invalid hook events in installation manifest');
  return f.events;
}
function specFor(f,loc){
  if(f.client!==undefined){if(!Object.hasOwn(HOOK_SPECS,f.client))throw Error('Invalid hook owner in installation manifest');return HOOK_SPECS[f.client];}
  return f.path===HOOK_SPECS.claude.file(loc)?HOOK_SPECS.claude:HOOK_SPECS.codex;
}
// Kimi has no JSON settings: its hooks are [[hooks]] tables in config.toml (strict schema:
// event, matcher, command, timeout). The guard goes in a TOML managed block after the user's text.
const KIMI_GUARD=command=>['[[hooks]]','event = "PreToolUse"','matcher = "^Bash$"',`command = ${JSON.stringify(command)}`,'timeout = 3'].join('\n');
function tomlText(text,path){if(text===null)return;try{parseToml(text);}catch{throw Error('Invalid TOML configuration; not overwritten: '+path);}}
// Files whose content is generated from a template that points at the installed runtime.
const PLUGIN_FILES={
  pi:{path:loc=>join(loc.pi,'extensions/agent-workflow.js'),template:'lib/pi-extension.mjs'},
  mimo:{path:loc=>join(loc.mimo,'plugins/agent-workflow.js'),template:'lib/mimo-plugin.mjs'},
};

function allowedPaths(loc){
  const allowed=new Set([join(loc.opencode,'opencode.json'),join(loc.opencode,'opencode.jsonc'),join(loc.store,'bin/node'),join(loc.store,'opencode-plugin/index.mjs'),join(loc.store,'opencode-plugin/package.json')]);
  for(const n of ['gate.mjs','hook.mjs','validation-guard.mjs'])allowed.add(join(loc.store,'runtime',n));
  allowed.add(join(loc.kimi,'config.toml'));allowed.add(dshHooksFile(loc));
  for(const c of ALL_CLIENTS){const r=ruleFile(c,loc);if(r)allowed.add(r);}
  for(const s of Object.values(HOOK_SPECS))allowed.add(s.file(loc));
  for(const p of Object.values(PLUGIN_FILES))allowed.add(p.path(loc));
  const generated=json(read(join(PACKAGE,'generated/manifest.json')));
  for(const n of Object.keys(generated.files))for(const d of destinations(n,ALL_CLIENTS,loc))allowed.add(d);
  return allowed;
}
function validateManifest(m,loc){
  if(m.schemaVersion!==1||m.home!==loc.home||!Array.isArray(m.clients)||!m.clients.length||m.clients.some(c=>!ALL_CLIENTS.includes(c))||!Array.isArray(m.files))throw Error('Invalid installation manifest');
  if(m.guard!==undefined&&(!Array.isArray(m.guard)||m.guard.some(c=>!GUARD_OPT_IN.includes(c)||!m.clients.includes(c))||new Set(m.guard).size!==m.guard.length))throw Error('Invalid installation manifest');
  const allowed=allowedPaths(loc),seen=new Set();
  for(const f of m.files){
    const dshPatch=typeof f.path==='string'&&dshPatchProfile(f.path,loc)!==null;
    if((!allowed.has(f.path)&&!dshPatch)||seen.has(f.path)||!['file','block','hooks','plugin'].includes(f.kind)||!(f.original===null||typeof f.original==='string')||!/^[a-f0-9]{64}$/.test(f.afterHash))throw Error('Invalid owned path or entry in installation manifest');
    if(f.kind==='hooks'&&specFor(f,loc).file(loc)!==f.path)throw Error('Invalid owned path or entry in installation manifest');
    if(f.kind==='hooks')entryEvents(f,specFor(f,loc));
    if((f.path===join(loc.kimi,'config.toml'))!==(f.kind==='block'&&f.syntax==='toml')||dshPatch!==(f.kind==='block'&&f.syntax==='yaml')||(f.syntax!==undefined&&!(f.kind==='block'&&['md','toml','yaml'].includes(f.syntax))))throw Error('Invalid owned path or entry in installation manifest');
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
function checkOwnedHooks(text,command,spec=HOOK_SPECS.claude,events=spec.events){
  const value=json(text);
  for(const event of events){
    const groups=at(value,[...spec.base,event]);
    if(!Array.isArray(groups))throw Error('Managed hook missing or changed: '+event);
    const matches=groups.filter(g=>spec.owned(g,command));
    if(matches.length!==1||JSON.stringify(matches[0])!==JSON.stringify(spec.item(command,event,spec)))throw Error('Managed hook missing or changed: '+event);
  }
}
// Adds (or with remove=true strips) the owned hook entries, editing JSONC in place so comments
// and unrelated entries survive. Empty containers left by removal are deleted.
export function hooks(text,command,remove=false,spec=HOOK_SPECS.claude,events=spec.events){
  let result=text??'{}\n';const obj=json(result);
  for(let i=1;i<=spec.base.length;i++){const v=at(obj,spec.base.slice(0,i));if(v!==undefined&&(!v||Array.isArray(v)||typeof v!=='object'))throw Error('Unsupported hooks configuration');}
  for(const event of events){
    const path=[...spec.base,event],item=spec.item(command,event,spec);
    const original=at(json(result),path)??[];if(!Array.isArray(original))throw Error('Hook event is not an array');
    const indices=original.flatMap((g,i)=>spec.owned(g,command)?[i]:[]);
    if(!remove&&indices.length===1&&JSON.stringify(original[indices[0]])===JSON.stringify(item))continue;
    for(const i of indices.reverse())result=set(result,[...path,i],undefined);
    const current=at(json(result),path);
    if(!remove)result=current?set(result,[...path,current.length],item,true):set(result,path,[item]);
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

// guard: clients of GUARD_OPT_IN that get the PreToolUse validation guard. Undefined keeps the
// recorded choice (manifest `guard`; for 0.5.x manifests, the PreToolUse entries they have, and
// when they have none, defaultGuard); [] removes it. Other hook clients always get it.
export function plan({userRoot,clients=CLIENTS,nodePath,guard,trustCodex}={}){
  const loc=locations(userRoot);
  if(!Array.isArray(clients)||!clients.length||new Set(clients).size!==clients.length||clients.some(c=>!ALL_CLIENTS.includes(c)))throw Error('Use --clients with any of '+ALL_CLIENTS.join(',')+' (or all), without duplicates');
  clients=ALL_CLIENTS.filter(c=>clients.includes(c));
  const statePath=join(loc.store,'installation.json'),prior=read(statePath)?json(read(statePath)):null;
  if(prior)validateManifest(prior,loc);
  // Adding clients to an existing installation is a sync; removing them needs uninstall first,
  // because files owned only by a dropped client would otherwise leave the manifest untracked.
  if(prior&&prior.clients.some(c=>!clients.includes(c)))throw Error('Client set changed: uninstall first, then install the chosen set (adding clients with sync is allowed)');
  if(guard!==undefined&&(!Array.isArray(guard)||new Set(guard).size!==guard.length||guard.some(c=>!GUARD_OPT_IN.includes(c)||!clients.includes(c))))throw Error('Use --guard with any of '+GUARD_OPT_IN.join(',')+' that are also in --clients, or none');
  const oldGuard=client=>{const spec=HOOK_SPECS[client],old=prior?.files.find(f=>f.kind==='hooks'&&f.path===spec.file(loc));return !!old&&entryEvents(old,spec).includes(GUARD_EVENT);};
  // New opt-in clients added by a sync follow the default unless the choice is explicit.
  const chosen=guard??(Array.isArray(prior?.guard)?[...prior.guard,...defaultGuard(clients.filter(c=>!prior.clients.includes(c)),trustCodex)]:prior&&GUARD_OPT_IN.some(c=>prior.clients.includes(c)&&oldGuard(c))?GUARD_OPT_IN.filter(oldGuard):defaultGuard(clients,trustCodex));
  const guarded=client=>{const spec=HOOK_SPECS[client];if(!spec.guard)return false;return !spec.optInGuard||chosen.includes(client);};
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
    ops.push({path:spec.file(loc),kind:'hooks',client,command:spec.arg?`${base} '--client' ${quote(client)}`:base,events:[...spec.events,...(guarded(client)?[GUARD_EVENT]:[])]});
  if(clients.includes('kimi'))ops.push({path:join(loc.kimi,'config.toml'),kind:'block',syntax:'toml',content:KIMI_GUARD(`${base} '--client' 'kimi'`)});
  if(clients.includes('dsh')){
    ops.push({path:dshHooksFile(loc),kind:'file',content:dshHooks(`${base} '--client' 'dsh'`)});
    // Every profile gets the project-MCP rows; the hooks row only where the bridge and its peer are
    // installed. A profile whose user layer has a layout this installer does not edit is skipped
    // (notice) unless its block is already owned. Owned blocks of removed profiles stay tracked.
    const owned=new Set((prior?.files??[]).filter(f=>f.kind==='block'&&f.syntax==='yaml').map(f=>f.path));
    for(const p of dshProfiles(loc)){
      if(!owned.has(p.patch)&&!dshEditable(p.patch))continue;
      ops.push({path:p.patch,kind:'block',syntax:'yaml',content:dshInsert(loc,p.hasPlugin)});
    }
    for(const path of owned)if(!ops.some(o=>o.path===path)&&existsSync(dirname(path)))ops.push({path,kind:'block',syntax:'yaml',content:dshInsert(loc,false)});
  }
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
    const owned=op.kind==='block'?blockContent(before,op.syntax):null;
    if(op.kind==='block'&&((old&&!owned)||(owned&&(!old||hash(owned)!==old.blockHash))))throw Error('Edited/unowned managed block: '+op.path);
    if(op.syntax==='toml')tomlText(before,op.path);
    if(op.syntax==='yaml')yamlText(before===null?null:unblock(before,'yaml'),op.path);
    const spec=op.kind==='hooks'?HOOK_SPECS[op.client]:null,oldSpec=op.kind==='hooks'&&old?specFor(old,loc):null,oldEvents=oldSpec?entryEvents(old,oldSpec):null;
    if(oldSpec)checkOwnedHooks(before,old.command,oldSpec,oldEvents);
    if(op.kind==='plugin'&&old&&(json(before).plugins??[]).filter(p=>p===old.plugin).length!==1)throw Error('Managed plugin registration changed');
    // A changed command replaces every owned group. Otherwise only events that were dropped are
    // removed and new ones appended: unchanged groups keep their position (Codex trust keys use it).
    let start=before;
    if(oldSpec&&old.command!==op.command)start=hooks(before,old.command,true,oldSpec,oldEvents);
    else if(oldSpec&&oldEvents.some(e=>!op.events.includes(e)))start=hooks(before,old.command,true,oldSpec,oldEvents.filter(e=>!op.events.includes(e)));
    const after=op.kind==='file'?op.content:op.kind==='block'?block(op.syntax==='yaml'?dropEmptyList(before):before,op.content,op.syntax):op.kind==='hooks'?hooks(start,op.command,false,spec,op.events):pluginConfig(before,op.plugin);
    if(op.syntax==='toml')tomlText(after,op.path);
    return {...op,before,after,original:old?old.original:before,afterHash:hash(after),blockHash:op.kind==='block'?hash(blockContent(after,op.syntax)):null};
  });
  return {loc,statePath,clients,changes,prior,guard:GUARD_OPT_IN.filter(c=>clients.includes(c)&&guarded(c))};
}

// Codex runs a hook only when hooks.state."<hooks.json>:<event>:<group>:<handler>".trusted_hash in
// config.toml equals the hook's current hash, and enabled is not false (a missing enabled means
// enabled). The source of truth is `codex app-server` hooks/list (trustStatus, enabled), used when
// Codex is available. Otherwise config.toml is read: a missing trusted_hash or enabled = false is
// reported; whether a present trusted_hash still matches cannot be computed without Codex (the hash
// is Codex's normalized TOML identity), so that check is skipped and said so (hashChecked: false).
// Read-only. Trust is written only by `agent-workflow trust --client codex` / --trust-codex.
const snake=e=>e.replace(/([a-z])([A-Z])/g,'$1_$2').toLowerCase();
export const CODEX_TRUST_FIX='Run `agent-workflow trust --client codex` (trusts only the Agent Workflow hooks, same as approving them in Codex /hooks), or open Codex, run /hooks and trust them. Do not use --dangerously-bypass-hook-trust.';
const CODEX_DISABLED_FIX='The hook is disabled in Codex (enabled = false, e.g. turned off in /hooks); re-enable it in /hooks if you want it to run. Agent Workflow never changes enabled.';
export function codexCommand(loc){
  const raw=read(join(loc.store,'installation.json'));
  if(raw){try{const f=json(raw).files?.find(x=>x.kind==='hooks'&&x.path===HOOK_SPECS.codex.file(loc));if(typeof f?.command==='string')return f.command;}catch{}}
  return `${quote(join(loc.store,'bin/node'))} ${quote(join(loc.store,'runtime/hook.mjs'))}`;
}
// Environment for a Codex child: an isolated user-root points CODEX_HOME and HOME at it.
export function codexEnv(loc,userRoot){return userRoot?{...process.env,HOME:loc.home,CODEX_HOME:loc.codex}:{...process.env,CODEX_HOME:loc.codex};}
function canonical(p){try{return realpathSync(p);}catch{return p;}}
// Agent Workflow hooks among hooks/list entries: user hooks.json under this CODEX_HOME, command
// handler, exact Agent Workflow command (shim + store runtime). Anything else is never selected.
export function ownCodexHooks(list,loc,command){
  const file=HOOK_SPECS.codex.file(loc),paths=new Set([file,canonical(file)]);
  return list.filter(h=>h.handlerType==='command'&&h.command===command&&!h.isManaged&&!h.pluginId&&paths.has(h.sourcePath)&&typeof h.key==='string'&&h.key.startsWith(h.sourcePath+':'));
}
// Owned hook locations in hooks.json (event, group index), for keys and missing-hook detection.
function ownedCodexEntries(loc,command){
  const file=HOOK_SPECS.codex.file(loc);let groups;
  try{groups=json(read(file)).hooks??{};}catch{return [];}
  const out=[];
  for(const event of [...CLAUDE_EVENTS,GUARD_EVENT]){const i=(Array.isArray(groups[event])?groups[event]:[]).findIndex(g=>claudeOwned(g,command));if(i>=0)out.push({event,key:`${file}:${snake(event)}:${i}:0`});}
  return out;
}
const summary=h=>({event:h.event,key:h.key,trustStatus:h.trustStatus,enabled:h.enabled});
export function codexTrustState(loc,command,{userRoot,codex}={}){
  const expected=ownedCodexEntries(loc,command);if(!expected.length)return {source:'none',hooks:[],warnings:[]};
  const bin=codex===undefined?codexBinary():codex||null;let appServerError=null;
  if(bin){
    const r=listHooksSync({bin,env:codexEnv(loc,userRoot),cwd:loc.home});
    if(r.ok){
      const file=HOOK_SPECS.codex.file(loc),byKey=new Map(ownCodexHooks(r.hooks,loc,command).map(h=>[file+h.key.slice(h.sourcePath.length),h]));
      const hooks=[],warnings=[];
      for(const {event,key} of expected){
        const h=byKey.get(key);
        if(!h){warnings.push({issue:'codex-hook-not-listed',event,key,fix:'Codex did not list this Agent Workflow hook; check ~/.codex/hooks.json and `codex app-server` hooks/list errors'});continue;}
        const s={event,key:h.key,trustStatus:h.trustStatus,enabled:h.enabled,currentHash:h.currentHash};hooks.push(s);
        if(h.trustStatus==='untrusted')warnings.push({issue:'codex-hook-untrusted',event,key:h.key,fix:CODEX_TRUST_FIX});
        else if(h.trustStatus==='modified')warnings.push({issue:'codex-hook-modified',event,key:h.key,fix:CODEX_TRUST_FIX});
        if(h.enabled===false)warnings.push({issue:'codex-hook-disabled',event,key:h.key,fix:CODEX_DISABLED_FIX});
      }
      return {source:'codex app-server',hashChecked:true,hooks,warnings};
    }
    appServerError=r.error;
  }
  const config=join(loc.codex,'config.toml');let state;
  try{const text=read(config);state=text===null?{}:parseToml(text)?.hooks?.state??{};}
  catch{return {source:'config.toml',hashChecked:false,...(appServerError?{appServerError}:{}),hooks:[],warnings:[{issue:'codex-hook-trust-unknown',path:config,fix:CODEX_TRUST_FIX}]};}
  const hooks=[],warnings=[];
  for(const {event,key} of expected){
    const entry=state[key]&&typeof state[key]==='object'?state[key]:{},enabled=entry.enabled!==false,trusted=typeof entry.trusted_hash==='string'&&entry.trusted_hash!=='';
    hooks.push({event,key,trustStatus:trusted?'trusted-unverified':'untrusted',enabled});
    if(!trusted)warnings.push({issue:'codex-hook-untrusted',event,key,fix:CODEX_TRUST_FIX});
    if(!enabled)warnings.push({issue:'codex-hook-disabled',event,key,fix:CODEX_DISABLED_FIX});
  }
  return {source:'config.toml',hashChecked:false,...(appServerError?{appServerError}:bin?{}:{note:'Codex not found (or AGENT_WORKFLOW_CODEX=none): a present trusted_hash is not compared with the current hook hash'}),hooks:hooks.map(summary),warnings};
}
export function codexHookTrust(loc,command,options){return codexTrustState(loc,command,options).warnings;}
// Native conditions that keep an installed piece from taking effect. Reported, never changed.
function notices(clients,loc){
  const out=[];
  if(clients.includes('mimo')&&!existsSync(join(loc.mimo,'AGENTS.md')))out.push(existsSync(join(loc.home,'.claude/CLAUDE.md'))&&(read(join(loc.home,'.claude/CLAUDE.md'))??'').includes(START)?'MiMo reads ~/.claude/CLAUDE.md (no ~/.config/mimocode/AGENTS.md), which carries the Agent Workflow block':'MiMo reads ~/.claude/CLAUDE.md, which has no Agent Workflow block: install the claude client too, or create ~/.config/mimocode/AGENTS.md and sync (MiMo then stops reading CLAUDE.md)');
  if(clients.includes('kimi'))out.push('Kimi Code: rule, skill, agents, aw-start and the PreToolUse validation guard (managed block in config.toml) installed; no reminder hook (Kimi 2.7 does not inject SessionStart hook output)');
  if(clients.includes('commandcode'))out.push('Command Code may ask to trust hooks per project; never bypassed');
  if(clients.includes('codex'))out.push('Codex aw-reviewer is not read-only: Codex 0.171 ignores the role sandbox_mode and a subagent inherits the parent sandbox. For a read-only review run a separate process: codex exec -s read-only "<review task>"');
  if(clients.includes('dsh')){
    const profiles=dshProfiles(loc),known=profiles.find(p=>p.version)?.version??'$(dsh --version)';
    // Both packages at the bridge's version: the bridge pins its peer to the same release.
    const add=p=>{const v=p.version??known;return `dsh plugin --profile ${p.name} add -w ${DSH_PLUGIN}@${v} ${DSH_PROTOCOL}@${p.wanted??v}`;};
    if(!profiles.length)out.push(`DeepSeek Harness: rule (${join(loc.dsh,'AGENTS.md')}) and skills installed; no profile in ${join(loc.dsh,'profiles')} yet, so no hooks and no project MCP rows. Boot a profile once (e.g. dsh headless), add the hooks bridge (${add({name:'<profile>'})}) and sync again`);
    for(const p of profiles){
      const block=blockContent(read(p.patch),'yaml'),mounted=block!==null;
      const missing=p.version===null?DSH_PLUGIN:`${DSH_PROTOCOL}@${p.wanted} (peer of ${DSH_PLUGIN}; found ${p.protocol??'none'} in the profile)`;
      if(!mounted&&!dshEditable(p.patch))out.push(`DeepSeek Harness profile ${p.name}: cordis.patch.yml is not a block list of patches, so it was left untouched (no hooks, no project MCP rows)`);
      else if(!p.hasPlugin&&mounted&&block.includes('agent-workflow-hooks'))out.push(`DeepSeek Harness profile ${p.name}: its cordis.patch.yml mounts ${DSH_PLUGIN} but ${missing} is missing, so dsh skips the entry ("did not activate"). Run agent-workflow sync --global to drop it, or add the packages (${add(p)})`);
      else if(!p.hasPlugin)out.push(`DeepSeek Harness profile ${p.name}: ${missing} missing, so no Agent Workflow hooks there (rule, skills and project MCP rows still load). To add them: ${add(p)}, then agent-workflow sync --global`);
    }
    if(process.env.DSH_AGENTS_HOME&&loc.home===realpathSync(homedir())&&resolve(process.env.DSH_AGENTS_HOME)!==join(loc.home,'.agents'))out.push('DeepSeek Harness: DSH_AGENTS_HOME is set, so dsh does not scan ~/.agents/skills, where the shared aw-workflow skill is installed');
  }
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
      const files=p.changes.map(({path,kind,original,afterHash,blockHash,command,plugin,client,events,syntax})=>({path,kind,original,afterHash,blockHash,command,plugin,...(kind==='hooks'?{client,events}:{}),...(syntax?{syntax}:{})}));
      atomic(p.statePath,JSON.stringify({schemaVersion:1,version:VERSION,home:p.loc.home,clients:p.clients,guard:p.guard,files},null,2)+'\n');
    } catch(e){
      for(const f of completed.reverse())if(read(f.path)!==null&&hash(read(f.path))===f.afterHash){if(f.before===null)unlinkSync(f.path);else atomic(f.path,f.before);}
      throw e;
    }
    const n=notices(p.clients,p.loc);
    const codexHook=p.changes.find(f=>f.kind==='hooks'&&f.client==='codex');
    // With trustCodex the caller trusts the hooks next and reports the state afterwards.
    const warnings=codexHook&&!options.trustCodex?codexHookTrust(p.loc,codexHook.command,{userRoot:options.userRoot}):[];
    return {installed:true,changedFiles:changed.length,clients:p.clients,hookTrust:'Client hook approval may still be required; never bypassed (Codex: agent-workflow trust --client codex, or --trust-codex)',models:'Inherited; no global defaults changed',...(n.length?{notices:n}:{}),...(warnings.length?{warnings}:{})};
  });
}

export function verify({userRoot,codex}={}){
  const loc=locations(userRoot),raw=read(join(loc.store,'installation.json'));if(!raw)return {ok:false,installed:false,issues:['not-installed']};
  const m=json(raw),issues=[];validateManifest(m,loc);
  for(const f of m.files){
    try{
      noSymlinks(f.path);const text=read(f.path);
      if(text===null){issues.push({path:f.path,issue:'missing'});continue;}
      if(f.kind==='file'&&hash(text)!==f.afterHash)issues.push({path:f.path,issue:'edited'});
      if(f.kind==='block'&&hash(blockContent(text,f.syntax)??'')!==f.blockHash)issues.push({path:f.path,issue:f.syntax==='toml'||f.syntax==='yaml'?'managed-block-drift':'rule-block-drift'});
      if(f.kind==='hooks'){const spec=specFor(f,loc);checkOwnedHooks(text,f.command,spec,entryEvents(f,spec));for(const h of hookHealth(f.command,loc))issues.push({path:f.path,...h});}
      if(f.kind==='plugin'&&!(json(text).plugins??[]).includes(f.plugin))issues.push({path:f.path,issue:'plugin-missing'});
    }catch(e){issues.push({path:f.path,issue:e.message});}
  }
  const {outdated,error}=outdatedFiles(userRoot,m,loc);
  const result={ok:issues.length===0&&outdated.length===0&&!error,installed:true,status:issues.length?'drift':error?'unknown':outdated.length?'outdated':'ok',installedVersion:m.version??null,packageVersion:VERSION,clients:m.clients,issues,outdated};
  if(error)result.outdatedCheck=error;
  if(outdated.length)result.next='Installed files differ from this package: agent-workflow sync --global --clients '+m.clients.join(',')+' --dry-run, then the same command without --dry-run';
  const n=notices(m.clients,loc);if(n.length)result.notices=n;
  const codexHook=m.files.find(f=>f.kind==='hooks'&&specFor(f,loc)===HOOK_SPECS.codex);
  if(codexHook){
    const {warnings,hooks,...trust}=codexTrustState(loc,codexHook.command,{userRoot,codex});
    result.codexHookTrust={...trust,hooks};if(warnings.length)result.warnings=warnings;
  }
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
function onlyOwned(f,text){
  if(f.kind==='block'&&f.syntax==='yaml')return yamlLines(text).every(l=>l.trim()==='[]');
  if(f.kind==='block')return !text.trim();
  return Object.keys(json(text)).length===0&&text.replace(/\s/g,'')==='{}';
}
function removeOwned(f,before,loc){
  let stripped,rebuilt,spec=null;
  if(f.kind==='block'){
    const owned=blockContent(before,f.syntax);block(before,null,f.syntax);
    if(hash(owned??'')!==f.blockHash)throw Error('Edited managed block: '+f.path);
    stripped=unblock(before,f.syntax);
    rebuilt=block(f.syntax==='yaml'?dropEmptyList(f.original):f.original,blockInner(owned,f.syntax),f.syntax);
    if(f.syntax==='yaml')stripped=restoreEmptyList(stripped);
  } else if(f.kind==='hooks'){
    spec=specFor(f,loc);const events=entryEvents(f,spec);checkOwnedHooks(before,f.command,spec,events);stripped=hooks(before,f.command,true,spec,events);
    try{rebuilt=hooks(f.original,f.command,false,spec,events);}catch{rebuilt=null;}
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
