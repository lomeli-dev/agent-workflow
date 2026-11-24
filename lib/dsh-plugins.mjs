// DeepSeek Harness hook packages (0.7.0, opt-in with --dsh-plugins or --all-in).
// The hooks bridge @deepseek-ai/dsh-hooks-claude-code needs its peer @deepseek-ai/dsh-hook-protocol
// at the same version in each profile, and dsh does not add the peer. With the flag, the profiles in
// <dsh>/profiles that lack them get `dsh plugin --profile P add -w <pkg>@<dsh version>` (-w is pnpm's
// --workspace-root: a profile directory is a pnpm workspace root, and pnpm refuses to add packages
// there without it). What was added is recorded in the installation manifest, and uninstall removes
// only that, with `dsh plugin --profile P remove -w <pkg>`. A package the user already has at another
// version is never replaced (the profile is skipped and reported). The API key is never handled.
import {spawnSync} from 'node:child_process';
import {accessSync,statSync,constants} from 'node:fs';
import {join,isAbsolute,delimiter} from 'node:path';
import {dshProfiles,pkg,DSH_PLUGIN,DSH_PROTOCOL,DSH_VERSION} from './install.mjs';

// AGENT_WORKFLOW_DSH=PATH|none chooses the executable (tests) or disables the step.
export function dshBinary(env=process.env){
  const forced=env.AGENT_WORKFLOW_DSH;
  if(forced==='none')return null;
  const ok=p=>{try{accessSync(p,constants.X_OK);return statSync(p).isFile();}catch{return false;}};
  if(forced)return isAbsolute(forced)&&ok(forced)?forced:null;
  for(const d of (env.PATH??'').split(delimiter)){if(!d)continue;const p=join(d,'dsh');if(ok(p))return p;}
  return null;
}
// The child gets DSH_HOME (the user-root's .dsh with --user-root). HOME is left alone: dsh runs pnpm
// through corepack, whose cache lives under HOME, and a redirected HOME makes it fail to start.
const dshEnv=loc=>({...process.env,DSH_HOME:loc.dsh});
const run=(bin,args,env)=>spawnSync(bin,args,{env,encoding:'utf8',timeout:300000});
const tail=r=>((r.error?.message??'')+' '+(r.stderr??'')+' '+(r.stdout??'')).trim().slice(-400);
export const addCommand=(profile,packages)=>['plugin','--profile',profile,'add','-w',...packages.map(p=>`${p.name}@${p.version}`)];
export const removeCommand=(profile,names)=>['plugin','--profile',profile,'remove','-w',...names];
const shown=args=>'dsh '+args.join(' ');

export function dshVersion(bin,env){
  const r=run(bin,['--version'],env);if(r.status!==0)return null;
  const v=(r.stdout??'').trim().split(/\s+/).pop()??'';return DSH_VERSION.test(v)?v:null;
}
// What --dsh-plugins would add: per profile, the missing packages at the version dsh reports.
export function planDshPlugins(loc,userRoot){
  const bin=dshBinary();if(!bin)return {found:false,planned:[],skipped:[],note:'dsh not found in PATH (or AGENT_WORKFLOW_DSH=none): nothing added'};
  const env=dshEnv(loc,userRoot),version=dshVersion(bin,env);
  if(!version)return {found:true,bin,planned:[],skipped:[],error:'Could not read the dsh version (dsh --version)'};
  const profiles=dshProfiles(loc),planned=[],skipped=[];
  if(!profiles.length)return {found:true,bin,version,planned,skipped,note:'No dsh profile yet: start dsh once (for example dsh headless), then sync again with --dsh-plugins'};
  for(const p of profiles){
    if(p.hasPlugin)continue;
    // The bridge pins its peer; when the user already has the bridge, its peer version wins.
    const want=[{name:DSH_PLUGIN,version:p.version??version},{name:DSH_PROTOCOL,version:p.wanted??version}];
    const present=want.map(w=>({...w,found:pkg(p.dir,w.name)?.version??null}));
    const conflict=present.find(w=>w.found!==null&&w.found!==w.version);
    if(conflict){skipped.push({profile:p.name,reason:`${conflict.name}@${conflict.found} is already in the profile (wanted ${conflict.version}); not replaced`});continue;}
    const packages=present.filter(w=>w.found===null).map(({name,version})=>({name,version}));
    if(packages.length)planned.push({profile:p.name,packages,command:shown(addCommand(p.name,packages))});
  }
  return {found:true,bin,version,planned,skipped};
}
// Runs the planned adds. On a failure, the packages added by this call are removed again.
export function addDshPlugins(plan,loc,userRoot){
  const env=dshEnv(loc,userRoot),added=[];
  for(const item of plan.planned){
    const r=run(plan.bin,addCommand(item.profile,item.packages),env);
    const dir=dshProfiles(loc).find(p=>p.name===item.profile)?.dir;
    const ok=r.status===0&&dir&&item.packages.every(p=>pkg(dir,p.name)?.version===p.version);
    if(!ok){
      const done=dir?item.packages.filter(p=>pkg(dir,p.name)?.version===p.version):[];
      removeDshPlugins([...added,...(done.length?[{profile:item.profile,packages:done}]:[])],loc,userRoot,plan.bin);
      throw Error(`dsh plugin add failed for profile ${item.profile} (${item.command}): ${tail(r)}`);
    }
    added.push({profile:item.profile,packages:item.packages});
  }
  return added;
}
// Removal of recorded packages that are still present at the recorded version.
export function planDshRemoval(records,loc){
  const dirs=new Map(dshProfiles(loc).map(p=>[p.name,p.dir]));
  return (records??[]).flatMap(r=>{const dir=dirs.get(r.profile);if(!dir)return [];const names=r.packages.filter(p=>pkg(dir,p.name)?.version===p.version).map(p=>p.name);return names.length?[{profile:r.profile,names,command:shown(removeCommand(r.profile,names))}]:[];});
}
export function removeDshPlugins(records,loc,userRoot,bin=dshBinary()){
  const items=planDshRemoval(records,loc),removed=[],errors=[];
  if(!items.length)return {removed,errors};
  if(!bin)return {removed,errors:items.map(i=>({profile:i.profile,error:'dsh not found; run it by hand',command:i.command}))};
  const env=dshEnv(loc,userRoot);
  for(const i of items){const r=run(bin,removeCommand(i.profile,i.names),env);if(r.status===0)removed.push({profile:i.profile,packages:i.names});else errors.push({profile:i.profile,error:tail(r),command:i.command});}
  return {removed,errors};
}
