// `agent-workflow trust --client codex` and `install/sync --trust-codex`: approve the Agent Workflow
// Codex hooks the same way the Codex TUI /hooks does (hooks/list -> currentHash, then
// config/batchWrite hooks.state.<key>.trusted_hash, written by Codex itself). Only hooks whose
// command is the Agent Workflow shim + store runtime in the user hooks.json are selected; every
// other hook and hooks.state entry is left as it is. enabled is never changed.
import {locations,install,codexCommand,codexEnv,ownCodexHooks,codexHookTrust,CODEX_TRUST_FIX} from './install.mjs';
import {codexBinary,openSession,listHooks,writeTrust} from './codex-app-server.mjs';

const EQUIVALENCE='Equivalent to approving these hooks in Codex /hooks; only Agent Workflow hooks are trusted, other hooks and their trust are untouched';
const view=h=>({key:h.key,event:h.eventName,trustStatus:h.trustStatus,enabled:h.enabled});

export async function trustCodex({userRoot,dryRun=false,codex}={}){
  const loc=locations(userRoot),command=codexCommand(loc);
  const bin=codex===undefined?codexBinary():codex||null;
  if(!bin)throw Error('Codex CLI not found in PATH (or AGENT_WORKFLOW_CODEX=none); nothing changed. Install Codex or approve the hooks with /hooks');
  let session;
  try{session=await openSession({bin,env:codexEnv(loc,userRoot),cwd:loc.home});}
  catch(e){throw Error(e.message+'; nothing changed');}
  try{
    let own;
    try{own=ownCodexHooks(await listHooks(session,loc.home),loc,command);}catch(e){throw Error(e.message+'; nothing changed');}
    const before=own.map(view),todo=own.filter(h=>h.trustStatus==='untrusted'||h.trustStatus==='modified');
    const base={client:'codex',dryRun,codexHome:loc.codex,before,toTrust:todo.map(h=>h.key)};
    if(!own.length)return {...base,trusted:0,note:'No Agent Workflow hooks found in Codex hooks/list; run agent-workflow sync --global first'};
    if(dryRun||!todo.length)return {...base,trusted:0,...(dryRun?{note:EQUIVALENCE}:{})};
    try{await writeTrust(session,todo);}catch(e){throw Error(e.message+'; config.toml not changed by Agent Workflow');}
    const after=ownCodexHooks(await listHooks(session,loc.home),loc,command).map(view);
    const pending=after.filter(h=>todo.some(t=>t.key===h.key)&&h.trustStatus!=='trusted');
    return {...base,trusted:todo.length,after,ok:pending.length===0,...(pending.length?{error:'Codex still reports these hooks as not trusted',pending}:{}),note:EQUIVALENCE};
  }finally{session.close();}
}

// install/sync followed by trust when --trust-codex is given. The install result stands even if
// trust fails afterwards; the failure is reported and the exit status is non-zero.
export async function installAndTrust(options){
  const clients=options.clients;
  if(!options.trustCodex)return install(options);
  if(!clients?.includes('codex'))throw Error('--trust-codex needs codex in --clients');
  if(options.dryRun){
    const r=install(options);
    return {...r,codexTrust:{dryRun:true,codexFound:!!codexBinary(),note:'After writing hooks.json the Agent Workflow Codex hooks would be trusted. '+EQUIVALENCE}};
  }
  const r=install(options);
  try{
    const t=await trustCodex({userRoot:options.userRoot});
    const warnings=codexHookTrust(locations(options.userRoot),codexCommand(locations(options.userRoot)),{userRoot:options.userRoot});
    const {warnings:_,...rest}=r;
    return {...rest,codexTrust:t,...(warnings.length?{warnings}:{}),...(t.ok===false?{ok:false}:{})};
  }catch(e){
    const warnings=codexHookTrust(locations(options.userRoot),codexCommand(locations(options.userRoot)),{userRoot:options.userRoot});
    return {...r,ok:false,codexTrust:{ok:false,error:e.message,fix:CODEX_TRUST_FIX},...(warnings.length?{warnings}:{})};
  }
}
