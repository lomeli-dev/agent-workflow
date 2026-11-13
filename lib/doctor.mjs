import {existsSync,accessSync,constants,readFileSync,mkdirSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {locations} from './install.mjs';
import {noSymlinks,atomic} from './files.mjs';

const TOOLS={
  rg:['rg','--version'],git:['git','--version'],node:[process.execPath,'--version'],npm:['npm','--version'],
  go:['go','version'],gopls:['gopls','version'],typescript:['typescript-language-server','--version'],
  rust:['rust-analyzer','--version'],python:['pyright','--version'],'ast-grep':['ast-grep','--version'],
  claude:['claude','--version'],codex:['codex','--version'],opencode:['opencode2','--version'],
};
export function executable(name,extra=[]){
  if(name.includes('/'))return existsSync(name)?name:null;
  for(const d of [...extra,...(process.env.PATH??'').split(delimiter)]){
    const p=join(d,name);try{accessSync(p,constants.X_OK);return p;}catch{}
  }
  return null;
}
function managedPaths(loc){return [join(loc.store,'tools/node/node_modules/.bin'),join(loc.store,'tools/bin')];}
export function doctor({userRoot}={}){
  const loc=locations(userRoot),tools={};
  for(const [id,args] of Object.entries(TOOLS)){
    let path=executable(args[0],managedPaths(loc));
    if(id==='opencode'&&!path)path=executable('opencode',managedPaths(loc));
    if(!path){tools[id]={available:false};continue;}
    const r=spawnSync(path,args.slice(1),{encoding:'utf8',timeout:5000,maxBuffer:8192});
    // Version commands only; no auth/config/transcript output is inspected.
    const version=(r.stdout??'').trim().split('\n')[0].slice(0,160);
    tools[id]={available:r.status===0,path,version:r.status===0?version:null,error:r.status!==0?'version-command-failed':null};
  }
  return {platform:process.platform,node:process.version,tools,scope:'Executable/version checks on this host only',nativeLspIntegration:'not-verified',next:'Configure the actual client LSP adapter and exercise definition/references/diagnostics before claiming integration'};
}

export const DEPENDENCIES={
  typescript:{packages:['typescript-language-server@5.3.0','typescript@7.0.2']},
  python:{packages:['pyright@1.1.414']},
  'ast-grep':{packages:['@ast-grep/cli@0.51.2']},
  gopls:{go:'golang.org/x/tools/gopls@v0.23.0'},
};
export function setup({userRoot,tool,apply=false}={}){
  if(!DEPENDENCIES[tool])throw Error('Supported setup tools: '+Object.keys(DEPENDENCIES).join(', '));
  const loc=locations(userRoot),spec=DEPENDENCIES[tool];
  const bin=executable(TOOLS[tool][0],managedPaths(loc));
  if(bin){const r=spawnSync(bin,TOOLS[tool].slice(1),{encoding:'utf8',timeout:5000,maxBuffer:8192});if(r.status===0)return {tool,action:'reuse',path:bin,changed:false};}
  const target=spec.go?join(loc.store,'tools/bin'):join(loc.store,'tools/node');noSymlinks(target);
  const command=spec.go?['go','install',spec.go]:['npm','install','--prefix',target,'--save-exact','--no-audit','--no-fund',...spec.packages];
  if(!apply)return {tool,action:'install-proposed',command,target,requires:'Repeat with --apply; may download dependencies and execute package lifecycle scripts',nativeLspIntegration:'still requires client-specific configuration and proof'};
  const exe=executable(command[0]);if(!exe)throw Error(command[0]+' is required; not installed automatically');
  mkdirSync(target,{recursive:true,mode:0o700});
  const env=spec.go?{...process.env,GOBIN:target}:process.env;
  const r=spawnSync(exe,command.slice(1),{env,stdio:'inherit',timeout:300000});
  if(r.status!==0)throw Error('Dependency setup failed or timed out; inspect the managed tools directory before retrying');
  const installed=executable(TOOLS[tool][0],managedPaths(loc));
  const check=installed&&spawnSync(installed,TOOLS[tool].slice(1),{encoding:'utf8',timeout:5000,maxBuffer:8192});
  if(!check||check.status!==0)throw Error('Install completed but executable check failed');
  atomic(join(loc.store,'tools',tool+'.json'),JSON.stringify({tool,packages:spec.packages??[spec.go],path:installed})+'\n');
  return {tool,action:'installed',path:installed,nativeLspIntegration:'not-verified',shellProfileChanged:false};
}
