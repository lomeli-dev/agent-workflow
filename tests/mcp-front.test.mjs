import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {PACKAGE,install,json,locations} from '../lib/install.mjs';
import {connect,connectionReceipts} from '../lib/connect.mjs';
import {cacheFile,warm,FRONT_TOOLS} from '../lib/mcp-front.mjs';
import {MCP_TOOLS} from '../lib/mcp-launch.mjs';
import {DSH_MCP_TOOLS} from '../lib/install.mjs';

test('the front, the dsh profile rows and the launcher know the same MCP modules',()=>{assert.deepEqual(FRONT_TOOLS,MCP_TOOLS);assert.deepEqual(DSH_MCP_TOOLS,MCP_TOOLS);});
import {hash} from '../lib/files.mjs';
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=realpathSync(mkdtempSync(join(tmpdir(),'aw-front-')));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
// A stand-in for context7-mcp in the managed tool dir: answers initialize after DELAY ms, lists the
// tools named in TOOLS, echoes tools/call.
function fakeServer(home,{delay=1200,tools=['one']}={}){
  const body=`#!${process.execPath}
let buf='';process.stdin.on('data',d=>{buf+=d;const l=buf.split('\\n');buf=l.pop();for(const x of l){const m=JSON.parse(x);const r=res=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:res})+'\\n');
 if(m.method==='initialize')setTimeout(()=>r({protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fake',version:'1'}}),${delay});
 else if(m.method==='tools/list')r({tools:${JSON.stringify(tools)}.map(name=>({name,inputSchema:{type:'object'}}))});
 else if(m.method==='tools/call')r({content:[{type:'text',text:'called '+m.params.name}]});}});
`;
  const p=put(home,'.local/share/agent-workflow/tools/bin/context7-mcp',body);chmodSync(p,0o755);
}
// Starts `agent-workflow mcp`, sends initialize + initialized + tools/list (+ an optional call) and
// records when each answer arrived.
function session(home,project,{call=false,wait=2500}={}){
  return new Promise(ok=>{
    const p=spawn(process.execPath,[cli,'mcp','--tool','context7','--project',project,'--user-root',home],{cwd:project,stdio:['pipe','pipe','ignore']});
    const t0=Date.now(),got=[];let buf='';
    p.stdout.on('data',d=>{buf+=d;const l=buf.split('\n');buf=l.pop();for(const x of l)got.push({ms:Date.now()-t0,...JSON.parse(x)});});
    const w=m=>p.stdin.write(JSON.stringify({jsonrpc:'2.0',...m})+'\n');
    w({id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'t',version:'1'}}});w({method:'notifications/initialized'});w({id:2,method:'tools/list'});
    if(call)w({id:3,method:'tools/call',params:{name:'one',arguments:{}}});
    setTimeout(()=>{p.stdin.end();p.kill();ok(got);},wait);
  });
}
function project(t){const p=fixture(t);spawnSync('git',['init','-q'],{cwd:p});return p;}

test('mcp front: a cold start passes through and fills the cache; a warm start answers initialize and tools/list at once',async t=>{
  const home=fixture(t),p=project(t);fakeServer(home);
  const cold=await session(home,p);
  assert.equal(cold.find(m=>m.id===1).ms>=1000,true,'cold initialize waits for the server');
  assert.deepEqual(cold.find(m=>m.id===2).result.tools.map(x=>x.name),['one']);
  const cache=json(read(cacheFile('context7',home)));
  assert.deepEqual(Object.keys(cache.initialize),['2025-11-25']);assert.equal(cache.initialize['2025-11-25'].serverInfo.name,'fake');assert.equal(cache.tools.length,1);
  const warmRun=await session(home,p,{call:true});
  const ids=warmRun.map(m=>m.id);
  assert(warmRun.find(m=>m.id===1).ms<700,'initialize from cache');assert(warmRun.find(m=>m.id===2).ms<700,'tools/list from cache');
  assert.equal(ids.filter(i=>i===1).length,1,'the server reply to an answered request is not forwarded');assert.equal(ids.filter(i=>i===2).length,1);
  assert.equal(warmRun.find(m=>m.id===3).result.content[0].text,'called one','other requests reach the server');
});

test('mcp front: changed tools refresh the cache and notify; opted-out projects never use the cache',async t=>{
  const home=fixture(t),p=project(t);fakeServer(home,{delay:300});await session(home,p,{wait:1200});
  fakeServer(home,{delay:300,tools:['one','two']});
  const changed=await session(home,p,{wait:1500});
  assert.deepEqual(changed.find(m=>m.id===2).result.tools.map(x=>x.name),['one'],'first answer comes from the old cache');
  assert(changed.some(m=>m.method==='notifications/tools/list_changed'),'client told to list again');
  assert.equal(json(read(cacheFile('context7',home))).tools.length,2);
  put(p,'.agent-workflow.json','{"schemaVersion":1,"enabled":false}');
  const off=await session(home,p,{wait:1200});
  assert.equal(off.find(m=>m.id===1).result.serverInfo.name,'agent-workflow-disabled');assert.deepEqual(off.find(m=>m.id===2).result.tools,[]);
});

test('mcp front: the cache is per package version; warm() fills it for the protocol Kimi requests',async t=>{
  const home=fixture(t),p=project(t);fakeServer(home,{delay:100});
  put(home,'.local/share/agent-workflow/mcp-cache/context7.json',JSON.stringify({version:'0.0.1',initialize:{'2025-11-25':{serverInfo:{name:'stale'}}},tools:[]}));
  const stale=await session(home,p,{wait:1000});assert.equal(stale.find(m=>m.id===1).result.serverInfo.name,'fake','another version is ignored');
  rmSync(join(home,'.local/share/agent-workflow/mcp-cache'),{recursive:true});
  const r=await warm({tools:['context7'],project:p,userRoot:home});
  assert.deepEqual(r.map(x=>[x.tool,x.protocolVersion,x.ok,x.tools]),[['context7','2025-11-25',true,1]]);
  assert.equal(json(read(cacheFile('context7',home))).initialize['2025-11-25'].serverInfo.name,'fake');
});

test('connect: dsh writes .dsh/agent-workflow-mcp.json and retires the 0.6.0 --patch file when unedited',t=>{
  const home=fixture(t),root=project(t);
  connect({project:root,userRoot:home,clients:['dsh'],tools:['codegraph']});
  const p=connectionReceipts(home)[0].receipt,r=json(read(p));
  // Rewrite the receipt as 0.6.0 left it: a whole owned YAML patch file.
  const yml=put(root,'.dsh/agent-workflow.cordis.yml','# Agent Workflow project MCP servers (0.6.0)\n- insert: []\n');
  rmSync(join(root,'.dsh/agent-workflow-mcp.json'));
  writeFileSync(p,JSON.stringify({...r,files:[{path:yml,clients:['dsh'],kind:'files',original:null,originalHash:hash(''),afterHash:hash(read(yml))}]}));
  connect({project:root,userRoot:home,clients:['dsh'],tools:['codegraph']});
  assert(!existsSync(yml),'retired');assert(json(read(join(root,'.dsh/agent-workflow-mcp.json'))).mcpServers['aw-codegraph']);
  assert.deepEqual(json(read(p)).files.map(f=>f.path),[join(root,'.dsh/agent-workflow-mcp.json')]);
  // An edited legacy file is never deleted.
  const r2=json(read(p));put(root,'.dsh/agent-workflow.cordis.yml','# mine\n');
  writeFileSync(p,JSON.stringify({...r2,files:[...r2.files,{path:yml,clients:['dsh'],kind:'files',original:null,originalHash:hash(''),afterHash:hash('other')}]}));
  assert.throws(()=>connect({project:root,userRoot:home,clients:['dsh'],tools:['codegraph']}),/Edited project MCP file/);assert.equal(read(yml),'# mine\n');
});

test('dsh profile rows are enabled only where .dsh/agent-workflow-mcp.json lists the server, with its command and args',t=>{
  const home=fixture(t),root=project(t),other=project(t);
  put(home,'.dsh/profiles/headless/cordis.yml','[]\n');put(home,'.dsh/profiles/headless/package.json','{}\n');
  install({userRoot:home,clients:['dsh']});
  const block=read(join(home,'.dsh/profiles/headless/cordis.patch.yml'));
  const row=tool=>{const m=new RegExp(`- id: agent-workflow-mcp-${tool}\\n {6}name: '@deepseek-ai/dsh-mcp-client'\\n {6}disabled: !!js (".*")\\n {6}config:\\n {8}serverName: aw-${tool}\\n {8}transport: stdio\\n {8}command: !!js (".*")\\n {8}args: !!js (".*")`).exec(block);assert(m,tool);return m.slice(1).map(s=>JSON.parse(s));};
  const evalIn=(dir,expr)=>new Function('process','return ('+expr+')')({cwd:()=>dir,getBuiltinModule:n=>process.getBuiltinModule(n)});
  connect({project:root,userRoot:home,clients:['dsh'],tools:['codegraph']});
  const [disabled,command,args]=row('codegraph');
  assert.equal(evalIn(root,disabled),false);assert.equal(evalIn(root,command),process.execPath);assert.deepEqual(evalIn(root,args).slice(1,6),['mcp','--tool','codegraph','--project',root]);
  assert.equal(evalIn(other,disabled),true,'no file elsewhere');assert.equal(evalIn(other,command),'false');assert.deepEqual(evalIn(other,args),[]);
  const [serena]=row('serena');assert.equal(evalIn(root,serena),true,'not connected for this project');
  for(const tool of ['playwright-mcp','devtools','context7'])assert(row(tool));
  assert.equal(locations(home).dsh,join(home,'.dsh'));
});
