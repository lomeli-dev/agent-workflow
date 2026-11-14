// Opt-in live probes against disposable fixtures; never run automatically on startup.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PACKAGE} from '../lib/install.mjs';
export class MCP {
 constructor(tool,project){
  this.id=0;this.pending=new Map();this.lines='';this.errors='';
  this.child=spawn(process.execPath,[join(PACKAGE,'bin/agent-workflow.mjs'),'mcp','--tool',tool,'--project',project],{stdio:['pipe','pipe','pipe']});
  this.child.stderr.on('data',b=>{this.errors=(this.errors+b).slice(-2500);});
  this.child.stdout.on('data',b=>{this.lines+=b;let n;while((n=this.lines.indexOf('\n'))>=0){const s=this.lines.slice(0,n);this.lines=this.lines.slice(n+1);try{const r=JSON.parse(s),p=this.pending.get(r.id);if(p){clearTimeout(p.timer);this.pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}}catch{}}});
  this.child.on('error',e=>this.fail(e));this.child.on('close',code=>this.fail(Error('MCP exited '+code+': '+this.errors.slice(-800))));
 }
 fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 request(method,params={}){return new Promise((resolve,reject)=>{const id=++this.id;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('MCP timeout: '+method));},60000);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 async start(){const r=await this.request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'agent-workflow-fixture',version:'0.2.0'}});this.child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');return r;}
 async close(){this.child.stdin.end();this.child.kill('SIGTERM');await new Promise(ok=>{const t=setTimeout(()=>{this.child.kill('SIGKILL');ok();},2500);this.child.once('close',()=>{clearTimeout(t);ok();});});}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const root=mkdtempSync(join(tmpdir(),'aw-mcp-fixture-'));spawnSync('git',['init','-q',root]);writeFileSync(join(root,'sample.py'),'def workflow_sum(a: int, b: int) -> int:\n    return a + b\n\nresult = workflow_sum(2, 3)\n');
 const ids=process.argv.slice(2);const report=[];
 try{
  for(const id of ids){const c=new MCP(id,root);try{
   const init=await c.start(),list=await c.request('tools/list');
   report.push({id,state:'initialized',server:init.serverInfo,toolCount:list.tools.length,selectedSchemas:list.tools.filter(t=>/find_symbol|get_symbols_overview|codegraph.*(search|symbol)|browser_navigate|list_pages|resolve-library-id/.test(t.name)).map(t=>({name:t.name,inputSchema:t.inputSchema})).slice(0,4)});
  }catch(e){report.push({id,state:'failed',error:e.message});}finally{await c.close();}}
  console.log(JSON.stringify(report,null,2));if(report.some(r=>r.state==='failed'))process.exitCode=1;
 }finally{rmSync(root,{recursive:true,force:true});}
}
