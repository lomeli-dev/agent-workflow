import {existsSync,accessSync,constants,readFileSync,mkdirSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {locations,verify} from './install.mjs';
import {connectionReceipts} from './connect.mjs';
import {CATALOG} from './catalog.mjs';
import {modulePlan,setupModules} from './modules.mjs';

const TOOLS={
  rg:['rg','--version'],git:['git','--version'],node:[process.execPath,'--version'],npm:['npm','--version'],
  go:['go','version'],gopls:['gopls','version'],typescript:['typescript-language-server','--version'],
  rust:['rust-analyzer','--version'],python:['pyright','--version'],'ast-grep':['ast-grep','--version'],
  claude:['claude','--version'],codex:['codex','--version'],opencode:['opencode','--version'],
  qwen:['qwen','--version'],kimi:['kimi','--version'],agy:['agy','--version'],
  commandcode:['commandcode','--version'],pi:['pi','--version'],mimo:['mimo','--version'],
};
export function executable(name,extra=[]){
  if(name.includes('/'))return existsSync(name)?name:null;
  for(const d of [...extra,...(process.env.PATH??'').split(delimiter)]){
    const p=join(d,name);try{accessSync(p,constants.X_OK);return p;}catch{}
  }
  return null;
}
// Same receipt checks as verify, including the Node/runtime the installed hooks call.
export function installation(userRoot){
  try{const v=verify({userRoot});return {ok:v.ok,installed:v.installed,issues:v.issues,...(v.outdated?{outdated:v.outdated}:{}),...(v.next?{next:v.next}:{}),...(v.warnings?{warnings:v.warnings}:{}),...(v.notices?{notices:v.notices}:{}),...(v.codexHookTrust?{codexHookTrust:v.codexHookTrust}:{})};}
  catch(e){return {ok:false,installed:true,issues:[{issue:e.message}]};}
}
function managedPaths(loc){return [join(loc.store,'tools/node/node_modules/.bin'),join(loc.store,'tools/bin')];}
export async function doctor({userRoot}={}){
  const loc=locations(userRoot),tools={};
  for(const [id,args] of Object.entries(TOOLS)){
    let path=executable(args[0],managedPaths(loc));
    if(!path){tools[id]={available:false};continue;}
    const r=spawnSync(path,args.slice(1),{encoding:'utf8',timeout:5000,maxBuffer:8192});
    // Version commands only; no auth/config/transcript output is inspected.
    const version=(r.stdout??'').trim().split('\n')[0].slice(0,160);
    tools[id]={available:r.status===0,path,version:r.status===0?version:null,error:r.status!==0?'version-command-failed':null};
  }
  const modules=(await modulePlan({userRoot,tools:Object.keys(CATALOG)})).modules;
  const connections=connectionReceipts(userRoot).map(({project,exists})=>exists?{project,exists}:{project,exists,fix:'agent-workflow disconnect --prune'});
  return {platform:process.platform,node:process.version,tools,installation:installation(userRoot),connections,modules,scope:'Executable/version checks on this host only',nativeLspIntegration:'not-verified',next:'Configure the actual client LSP adapter and exercise definition/references/diagnostics before claiming integration'};
}

export function setup(options={}){return setupModules({...options,tools:options.tool?[options.tool]:[]});}
