// Fast front for `agent-workflow mcp`. It answers `initialize` and the first `tools/list` from a
// per-tool cache of the real server's last answers, and passes every message (those two
// included) to the real server, started as a child (`AW_MCP_INNER=1`). Replies of the child to
// requests the front already answered only refresh the cache.
//
// Why: Kimi Code 2.7 builds a session's tool list when it binds the agent profile, a few
// milliseconds after it starts the MCP servers; a server whose tools arrive later is missing for
// the whole `kimi -p` session. The real servers need ~0.1-1 s (Node wrappers, Python). The front
// loads only Node builtins and gate.mjs, so a warmed cache answers in ~30 ms.
//
// Never used when the project is opted out (the child answers as disabled) or without a cache
// entry for the requested protocol version. Writes only <store>/mcp-cache/<tool>.json.
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,renameSync,mkdirSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {status,mcpProject} from './gate.mjs';

const PACKAGE=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const BIN=join(PACKAGE,'bin/agent-workflow.mjs');
export const FRONT_TOOLS=['serena','codegraph','playwright-mcp','devtools','context7'];
function option(args,name){const i=args.indexOf(name);return i>=0&&typeof args[i+1]==='string'?args[i+1]:undefined;}
// Same store as locations(userRoot).store, without importing install.mjs.
export function cacheFile(tool,userRoot){return join(realpathSync(resolve(userRoot??homedir())),'.local/share/agent-workflow/mcp-cache',tool+'.json');}
function version(){try{return JSON.parse(readFileSync(join(PACKAGE,'package.json'),'utf8')).version;}catch{return null;}}
function load(path,v){try{const c=JSON.parse(readFileSync(path,'utf8'));return c&&c.version===v&&typeof c.initialize==='object'?c:null;}catch{return null;}}
function save(path,cache){try{mkdirSync(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(cache)+'\n',{mode:0o600});renameSync(tmp,path);}catch{/* cache is an optimization */}}
function enabled(project){try{return status(mcpProject(project,process.cwd()).project).enabled;}catch{return false;}}

export function front(args=process.argv.slice(3)){
  const tool=option(args,'--tool'),project=option(args,'--project'),userRoot=option(args,'--user-root');
  const child=spawn(process.execPath,[BIN,'mcp',...args],{env:{...process.env,AW_MCP_INNER:'1'},stdio:['pipe','pipe','inherit']});
  const v=version(),usable=FRONT_TOOLS.includes(tool)&&typeof project==='string'&&v!==null&&enabled(project);
  const path=usable?cacheFile(tool,userRoot):null;let cache=usable?load(path,v):null;
  const fresh=cache??{version:v,initialize:{},tools:null};
  const answered=new Set(),pending=new Map();let listed=false;
  const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
  const toChild=line=>{if(child.stdin.writable)child.stdin.write(line+'\n');};
  let inBuf='',outBuf='';
  process.stdin.on('data',chunk=>{
    inBuf+=chunk;const lines=inBuf.split('\n');inBuf=lines.pop();
    for(const line of lines){
      let m=null;try{m=JSON.parse(line);}catch{}
      if(m&&m.id!==undefined&&usable){
        if(m.method==='initialize'){const pv=m.params?.protocolVersion;pending.set(m.id,{kind:'initialize',pv});if(cache?.initialize[pv]){send({jsonrpc:'2.0',id:m.id,result:cache.initialize[pv]});answered.add(m.id);}}
        else if(m.method==='tools/list'&&!m.params?.cursor){pending.set(m.id,{kind:'tools'});if(cache?.tools&&!listed){send({jsonrpc:'2.0',id:m.id,result:{tools:cache.tools}});answered.add(m.id);listed=true;}}
      }
      toChild(line);
    }
  });
  process.stdin.on('end',()=>{if(inBuf)toChild(inBuf);child.stdin.end();});
  child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{
    outBuf+=chunk;const lines=outBuf.split('\n');outBuf=lines.pop();
    for(const line of lines){
      let m=null;try{m=JSON.parse(line);}catch{}
      const p=m&&m.id!==undefined&&m.method===undefined?pending.get(m.id):undefined;
      if(p){
        pending.delete(m.id);
        if(m.result&&p.kind==='initialize'&&typeof p.pv==='string'){fresh.initialize={...fresh.initialize,[p.pv]:m.result};save(path,fresh);}
        if(m.result&&p.kind==='tools'&&Array.isArray(m.result.tools)&&!m.result.nextCursor){
          const changed=JSON.stringify(fresh.tools)!==JSON.stringify(m.result.tools);fresh.tools=m.result.tools;if(changed)save(path,fresh);
          if(changed&&answered.has(m.id))send({jsonrpc:'2.0',method:'notifications/tools/list_changed'});
        }
        if(answered.delete(m.id))continue;
      }
      process.stdout.write(line+'\n');
    }
  });
  const stop=()=>child.kill('SIGTERM');process.once('SIGTERM',stop);process.once('SIGINT',stop);
  return new Promise(ok=>child.on('close',code=>{if(outBuf)process.stdout.write(outBuf);process.exitCode=code??1;ok();}));
}

// Starts the front once per tool and asks for initialize + tools/list so that the next client
// start is answered from the cache. Used by `connect --approve` for Kimi.
export const WARM_PROTOCOL_VERSIONS=['2025-11-25'];
export function warm({tools,project,userRoot,timeoutMs=90000}){
  return Promise.all(tools.flatMap(tool=>WARM_PROTOCOL_VERSIONS.map(pv=>new Promise(ok=>{
    const p=spawn(process.execPath,[BIN,'mcp','--tool',tool,'--project',project,...(userRoot?['--user-root',userRoot]:[])],{cwd:project,stdio:['pipe','pipe','ignore']});
    let buf='',done=false;const finish=r=>{if(done)return;done=true;clearTimeout(timer);p.stdin.end();p.kill('SIGTERM');ok({tool,protocolVersion:pv,...r});};
    const timer=setTimeout(()=>finish({ok:false,error:'timeout'}),timeoutMs);
    p.on('error',e=>finish({ok:false,error:e.message}));p.on('close',()=>finish({ok:false,error:'server exited'}));
    p.stdout.on('data',d=>{buf+=d;const lines=buf.split('\n');buf=lines.pop();for(const l of lines){let m;try{m=JSON.parse(l);}catch{continue;}
      if(m.id===1){p.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');}
      if(m.id===2)setTimeout(()=>finish({ok:Array.isArray(m.result?.tools),tools:m.result?.tools?.length??0}),300);}});
    p.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:pv,capabilities:{},clientInfo:{name:'agent-workflow-warm',version:version()??'0'}}})+'\n');
  }))));
}
