import {existsSync,accessSync,constants,mkdirSync,mkdtempSync,rmSync,readFileSync,writeFileSync,chmodSync,copyFileSync,realpathSync} from 'node:fs';
import {join,delimiter,basename,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {locations} from './install.mjs';
import {atomic,noSymlinks,read} from './files.mjs';
import {CATALOG,selectModules} from './catalog.mjs';

export function toolDirs(loc){return [join(loc.store,'tools/node/node_modules/.bin'),join(loc.store,'tools/bin')];}
export function findBin(name,loc){
 for(const d of [...toolDirs(loc),...(process.env.PATH??'').split(delimiter)]){
  const p=join(d,name);try{accessSync(p,constants.X_OK);return p;}catch{}
 }
 return null;
}
export function toolEnvironment(loc){return {...process.env,PATH:[...toolDirs(loc),process.env.PATH??''].join(delimiter),CODEGRAPH_TELEMETRY:'off',CODEGRAPH_SKIP_MODEL_FETCH:'1',PLAYWRIGHT_BROWSERS_PATH:join(loc.store,'tools/browsers'),UV_TOOL_DIR:join(loc.store,'tools/uv'),UV_TOOL_BIN_DIR:join(loc.store,'tools/bin')};}
export function run(command,args,{env=process.env,cwd,timeout=300000}={}){
 return new Promise((resolveResult,reject)=>{
  const p=spawn(command,args,{env,cwd,stdio:['ignore','pipe','pipe']});let out='',err='',timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;p.kill('SIGTERM');setTimeout(()=>p.kill('SIGKILL'),2000).unref();},timeout);
  p.stdout.on('data',b=>{out=(out+b).slice(-8192);});p.stderr.on('data',b=>{err=(err+b).slice(-8192);});
  p.on('error',e=>{clearTimeout(timer);reject(e);});p.on('close',code=>{clearTimeout(timer);resolveResult({code,out,err,timedOut});});
 });
}
export async function probe(id,loc){
 const spec=CATALOG[id],path=findBin(spec.bin,loc);if(!path)return {available:false,path:null};
 if(id==='typescript'){try{createRequire(realpathSync(path)).resolve('typescript/lib/tsserver.js');}catch{return {available:false,path,check:'missing-compatible-tsserver'};}}
 if(spec.probeFile)return {available:true,path,check:'executable-only; this probe does not test the LSP protocol'};
 const r=await run(path,spec.probe,{env:toolEnvironment(loc),timeout:10000});
 return {available:r.code===0,path,check:r.code===0?(spec.probe.includes('--version')||spec.probe.includes('version')?'version':'help'):'failed',version:r.code===0?(r.out.trim().split('\n')[0]??'').slice(0,120):null};
}
export async function modulePlan(options={}){
 const loc=locations(options.userRoot),ids=selectModules(options),modules=[];
 // Bound version probes; no model requests or client reconfiguration.
 for(let n=0;n<ids.length;n+=4){await Promise.all(ids.slice(n,n+4).map(async id=>{
  const spec=CATALOG[id],current=await probe(id,loc);modules.push({id,label:spec.label,group:spec.group,action:current.available?'reuse':'install',current,packages:spec.packages??[spec.go??spec.uv??(spec.rustup?'rustup component rust-analyzer':`${spec.release.repo}@${spec.release.version}`)]});
 }));}
 modules.sort((a,b)=>ids.indexOf(a.id)-ids.indexOf(b.id));return {loc,ids,modules};
}
async function checked(command,args,options){const r=await run(command,args,options);if(r.code!==0)throw Error(`${basename(command)} ${args[0]??''} failed${r.timedOut?' (timeout; inspect before retrying)':''}: ${r.err.slice(-1200)||r.out.slice(-1200)}`);return r;}
export function releaseAsset(id,platform=process.platform,arch=process.arch){
 if(!['darwin','linux'].includes(platform)||!['arm64','x64'].includes(arch))throw Error('Native release supports macOS/Linux arm64/x64 only');
 const s=CATALOG[id].release,v=s.version;
 const asset=id==='gitleaks'?`gitleaks_${v}_${platform}_${arch}.tar.gz`:`gh_${v}_${platform==='darwin'?'macOS':'linux'}_${arch==='x64'?'amd64':arch}.${platform==='darwin'?'zip':'tar.gz'}`;
 const checksums=id==='gitleaks'?`gitleaks_${v}_checksums.txt`:`gh_${v}_checksums.txt`;
 return {asset,base:`https://github.com/${s.repo}/releases/download/v${v}`,checksums,bin:CATALOG[id].bin};
}
async function download(url){const r=await fetch(url,{signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('Download failed: '+r.status);const data=Buffer.from(await r.arrayBuffer());if(data.length>180*1024*1024)throw Error('Release artifact too large');return data;}
async function nativeInstall(id,loc){
 const info=releaseAsset(id),root=mkdtempSync(join(tmpdir(),'aw-release-'));
 try{
  const [artifact,checks]=await Promise.all([download(info.base+'/'+info.asset),download(info.base+'/'+info.checksums)]);
  const expected=checks.toString().split('\n').map(x=>x.trim().split(/\s+/)).find(x=>x.at(-1)?.replace(/^\*/,'')===info.asset)?.[0];
  if(!expected||createHash('sha256').update(artifact).digest('hex')!==expected.toLowerCase())throw Error('Release checksum mismatch');
  const archive=join(root,info.asset);writeFileSync(archive,artifact);
  // List archive and extract only the regular binary member to stdout; never unpack arbitrary paths.
  const zip=info.asset.endsWith('.zip'),listing=await checked(zip?'unzip':'tar',zip?['-Z1',archive]:['-tzf',archive],{timeout:10000});
  const names=listing.out.split('\n').filter(n=>basename(n)===info.bin&&!n.split('/').includes('..')&&!n.startsWith('/'));
  if(names.length!==1)throw Error('Unexpected release layout');
  const target=join(loc.store,'tools/bin',info.bin);noSymlinks(target);mkdirSync(resolve(target,'..'),{recursive:true,mode:0o700});
  const temp=join(root,'binary');
  await new Promise((ok,bad)=>{
   const child=spawn(zip?'unzip':'tar',zip?['-p',archive,names[0]]:['-xOzf',archive,names[0]],{stdio:['ignore','pipe','pipe']});const chunks=[];let size=0;
   child.stdout.on('data',b=>{size+=b.length;if(size>100*1024*1024)child.kill();else chunks.push(b);});child.on('error',bad);child.on('close',code=>{if(code!==0)return bad(Error('Binary extraction failed'));writeFileSync(temp,Buffer.concat(chunks),{mode:0o700});ok();});
  });
  await checked(temp,CATALOG[id].probe,{timeout:10000});copyFileSync(temp,target);chmodSync(target,0o700);
 }finally{rmSync(root,{recursive:true,force:true});}
}

export async function setupModules(options={}){
 const plan=await modulePlan(options);if(!plan.ids.length)throw Error('Select modules with --tool, --tools, --profile, --all or --interactive');
 if(!options.apply)return {apply:false,modules:plan.modules,note:'No installation or client connection performed. Add --apply to install; no linter/formatter/task daemon is included.'};
 const {loc}=plan;noSymlinks(join(loc.store,'tools'));mkdirSync(join(loc.store,'tools'),{recursive:true,mode:0o700});
 const lockPath=join(loc.store,'tools/setup.lock');let lock;
 try{const fs=await import('node:fs');lock=fs.openSync(lockPath,'wx',0o600);}catch{throw Error('Tool setup already locked; inspect the running operation before retrying');}
 const results=[];
 try{
  const missing=plan.modules.filter(m=>m.action==='install'),npmModules=missing.filter(m=>CATALOG[m.id].packages);
  if(npmModules.length){
   const target=join(loc.store,'tools/node'),pkgs=[...new Set(npmModules.flatMap(m=>CATALOG[m.id].packages))];
   try{await checked('npm',['install','--prefix',target,'--save-exact','--no-audit','--no-fund',...pkgs],{env:toolEnvironment(loc)});}catch(e){results.push({id:'npm-batch',state:'failed',error:e.message});}
  }
  for(const m of plan.modules){
   const s=CATALOG[m.id];options.onProgress?.(m.id);
   try{
    if(m.action==='install'&&!s.packages){
     if(s.go){if(!findBin('go',loc))throw Error('Go toolchain prerequisite missing');await checked('go',['install',s.go],{env:{...toolEnvironment(loc),GOBIN:join(loc.store,'tools/bin')}});}
     else if(s.uv){if(!findBin('uv',loc))throw Error('uv prerequisite missing');await checked('uv',['tool','install','--python',s.python,s.uv],{env:toolEnvironment(loc)});}
     else if(s.rustup){if(!findBin('rustup',loc))throw Error('Rust toolchain prerequisite missing');await checked('rustup',['component','add','rust-analyzer'],{env:toolEnvironment(loc)});}
     else if(s.release)await nativeInstall(m.id,loc);
    }
    let p=await probe(m.id,loc);
    if(s.engine&&!p.available){const fetcher=findBin('codegraph-mcp-fetch-engine',loc);if(fetcher){await checked(fetcher,[],{env:toolEnvironment(loc)});p=await probe(m.id,loc);}}
    if(!p.available)throw Error('Executable installed but functional launcher probe failed');
    if(s.browser){await checked(p.path,['install','chromium'],{env:toolEnvironment(loc)});}
    const result={id:m.id,state:m.action==='reuse'?'reused':'installed',...p,clientIntegration:'not-connected-by-setup'};results.push(result);
    atomic(join(loc.store,'tools',m.id+'.json'),JSON.stringify(result,null,2)+'\n');
   }catch(e){results.push({id:m.id,state:'failed',error:e.message});}
  }
  atomic(join(loc.store,'tools/last-setup.json'),JSON.stringify({modules:results},null,2)+'\n');
  return {apply:true,ok:results.every(r=>r.state!=='failed'),modules:results,note:'Client connections are a separate step. No formatter/linter or persistent-task service installed.'};
 }finally{const fs=await import('node:fs');fs.closeSync(lock);fs.unlinkSync(lockPath);}
}
