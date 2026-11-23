// Minimal client for `codex app-server` (JSON-RPC over stdio, one JSON object per line, no
// "jsonrpc" field), limited to what the Codex TUI uses for /hooks: hooks/list and
// config/batchWrite of hooks.state.<key>.trusted_hash. No model request is made.
// This module imports nothing from install.mjs so install.mjs can use it without a cycle.
import {spawn,spawnSync} from 'node:child_process';
import {accessSync,constants,statSync} from 'node:fs';
import {join,delimiter,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const SELF=fileURLToPath(import.meta.url);
const CLIENT_INFO={name:'agent-workflow',title:'Agent Workflow',version:'1'};

// AGENT_WORKFLOW_CODEX=PATH selects the Codex executable; AGENT_WORKFLOW_CODEX=none disables the
// app-server path (verify then reads config.toml). Otherwise `codex` is looked up in PATH.
export function codexBinary(env=process.env){
  const forced=env.AGENT_WORKFLOW_CODEX;
  if(forced==='none')return null;
  const ok=p=>{try{accessSync(p,constants.X_OK);return statSync(p).isFile();}catch{return false;}};
  if(forced)return isAbsolute(forced)&&ok(forced)?forced:null;
  for(const d of (env.PATH??'').split(delimiter)){if(!d)continue;const p=join(d,'codex');if(ok(p))return p;}
  return null;
}

// Starts an app-server session. Every call rejects on a JSON-RPC error, a premature exit or the
// overall timeout; close() always kills the child.
export async function openSession({bin,env,cwd,timeoutMs=30000}){
  const child=spawn(bin,['app-server'],{cwd,env,stdio:['pipe','pipe','pipe']});
  const pending=new Map();let buffer='',stderr='',id=0,closed=false,failure=null;
  const fail=err=>{if(failure)return;failure=err;for(const {reject} of pending.values())reject(err);pending.clear();};
  const timer=setTimeout(()=>{fail(Error(`codex app-server did not answer within ${timeoutMs/1000}s`));child.kill();},timeoutMs);
  child.on('error',e=>fail(Error('Could not start codex app-server: '+e.message)));
  child.on('exit',(code,signal)=>{closed=true;fail(Error(`codex app-server exited (${signal??code})`+(stderr.trim()?': '+stderr.trim().slice(-400):'')));});
  child.stderr.on('data',d=>{stderr=(stderr+d).slice(-4000);});
  child.stdin.on('error',()=>{});
  child.stdout.on('data',d=>{
    buffer+=d;let i;
    while((i=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(!line)continue;
      let m;try{m=JSON.parse(line);}catch{continue;}
      if(m.id===undefined||!pending.has(m.id)||m.method!==undefined)continue;
      const {resolve,reject,method}=pending.get(m.id);pending.delete(m.id);
      if(m.error)reject(Error(`codex app-server ${method} failed: `+(m.error.message??JSON.stringify(m.error))));else resolve(m.result);
    }
  });
  const send=message=>{if(closed||failure)throw failure??Error('codex app-server is closed');child.stdin.write(JSON.stringify(message)+'\n');};
  const request=(method,params)=>new Promise((resolve,reject)=>{
    if(failure)return reject(failure);
    const k=++id;pending.set(k,{resolve,reject,method});
    try{send({id:k,method,params});}catch(e){pending.delete(k);reject(e);}
  });
  const close=()=>{clearTimeout(timer);if(!closed){closed=true;child.kill();}};
  try{
    await request('initialize',{clientInfo:CLIENT_INFO});
    send({method:'initialized',params:{}});
  }catch(e){close();throw e;}
  return {request,close};
}

export async function listHooks(session,cwd){
  const result=await session.request('hooks/list',{cwds:[cwd]});
  if(!Array.isArray(result?.data))throw Error('codex app-server hooks/list returned an unexpected shape');
  const seen=new Map();
  for(const entry of result.data)for(const h of entry.hooks??[])if(typeof h?.key==='string'&&!seen.has(h.key))seen.set(h.key,h);
  return [...seen.values()];
}

// Same request as the TUI's write_hook_trusts: upsert keeps every other hooks.state entry.
export async function writeTrust(session,hooks){
  const value=Object.fromEntries(hooks.map(h=>[h.key,{trusted_hash:h.currentHash}]));
  return session.request('config/batchWrite',{edits:[{keyPath:'hooks.state',value,mergeStrategy:'upsert'}],filePath:null,expectedVersion:null,reloadUserConfig:true});
}

// Synchronous hooks/list for verify/doctor: runs this file in a child Node process, which keeps
// stdin open until the answer arrives (app-server stops reading at EOF).
export function listHooksSync({bin,env,cwd,timeoutMs=20000}){
  const r=spawnSync(process.execPath,[SELF,'list'],{input:JSON.stringify({bin,cwd,timeoutMs}),env,cwd,encoding:'utf8',timeout:timeoutMs+5000,maxBuffer:16*1024*1024});
  if(r.error)return {ok:false,error:r.error.message};
  try{return JSON.parse(r.stdout);}catch{return {ok:false,error:'codex app-server helper failed'+(r.stderr?': '+r.stderr.trim().slice(-400):'')};}
}

if(process.argv[1]===SELF&&process.argv[2]==='list'){
  let input='';for await(const c of process.stdin)input+=c;
  const {bin,cwd,timeoutMs}=JSON.parse(input);let session;
  try{session=await openSession({bin,env:process.env,cwd,timeoutMs});const hooks=await listHooks(session,cwd);process.stdout.write(JSON.stringify({ok:true,hooks}));}
  catch(e){process.stdout.write(JSON.stringify({ok:false,error:e.message}));}
  finally{session?.close();}
}
