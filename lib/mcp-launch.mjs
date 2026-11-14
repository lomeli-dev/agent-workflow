import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {locations} from './install.mjs';
import {status} from './gate.mjs';
import {findBin,toolEnvironment} from './modules.mjs';
export const MCP_TOOLS=['serena','codegraph','playwright-mcp','devtools','context7'];
export const DEFAULT_MCP_TOOLS=['serena','codegraph','context7'];
export function mcpLaunch(tool,project,loc){
 if(!MCP_TOOLS.includes(tool))throw Error('Not an MCP module: '+tool);
 const name={serena:'serena',codegraph:'codegraph-mcp','playwright-mcp':'playwright-mcp',devtools:'chrome-devtools-mcp',context7:'context7-mcp'}[tool];
 const command=findBin(name,loc);if(!command)throw Error('Module is not installed: '+tool);
 const args={
  serena:['start-mcp-server','--project',project,'--agent-interface','tools','--open-web-dashboard','false','--enable-web-dashboard','false','--enable-gui-log-window','false','--mode','interactive','--mode','editing','--mode','no-memories','--mode','no-onboarding'],
  codegraph:['--workspace',project,'--graph-only','--profile','graph','--exclude','node_modules','--exclude','.git','--exclude','.memory'],
  'playwright-mcp':['--headless','--isolated'],
  devtools:['--headless','--isolated','--no-usage-statistics'],
  context7:[],
 }[tool];
 return {command,args,env:toolEnvironment(loc)};
}
export function disabledReply(req){
 if(req.id===undefined)return null;
 if(req.method==='initialize')return {jsonrpc:'2.0',id:req.id,result:{protocolVersion:req.params?.protocolVersion??'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'agent-workflow-disabled',version:'0.2.1'}}};
 const values={'tools/list':{tools:[]},'resources/list':{resources:[]},'resources/templates/list':{resourceTemplates:[]},'prompts/list':{prompts:[]},ping:{}};
 if(Object.hasOwn(values,req.method))return {jsonrpc:'2.0',id:req.id,result:values[req.method]};
 return {jsonrpc:'2.0',id:req.id,error:{code:-32601,message:'Agent Workflow disabled in this project'}};
}
export async function serveMcp({tool,project,userRoot}){
 if(!project)throw Error('MCP launch requires an explicit --project; never index the user home by default');
 if(!MCP_TOOLS.includes(tool))throw Error('Unsupported MCP module');
 const gate=status(project);
 if(!gate.enabled){
  const lines=createInterface({input:process.stdin});for await(const line of lines){try{const r=disabledReply(JSON.parse(line));if(r)process.stdout.write(JSON.stringify(r)+'\n');}catch{}}
  return;
 }
 const cfg=mcpLaunch(tool,project,locations(userRoot));
 await new Promise((ok,bad)=>{
  const child=spawn(cfg.command,cfg.args,{env:cfg.env,cwd:project,stdio:['pipe','pipe','inherit']});
  process.stdin.pipe(child.stdin);child.stdout.pipe(process.stdout);child.stdin.on('error',()=>{});
  const terminate=()=>child.kill('SIGTERM');process.once('SIGTERM',terminate);process.once('SIGINT',terminate);
  child.on('error',bad);child.on('close',code=>{process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',terminate);process.exitCode=code??1;ok();});
 });
}
