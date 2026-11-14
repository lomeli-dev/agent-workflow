import {MCP} from './probe-modules.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
const root=mkdtempSync(join(tmpdir(),'aw-functional-'));spawnSync('git',['init','-q',root]);writeFileSync(join(root,'sample.py'),'def workflow_sum(a: int, b: int) -> int:\n    return a + b\n\nresult = workflow_sum(2, 3)\n');
const http=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Agent Workflow Fixture</title><h1>AW_BROWSER_OK</h1><button onclick="this.textContent=\'Clicked\'">Test</button>');});await new Promise(ok=>http.listen(0,'127.0.0.1',ok));
const url=`http://127.0.0.1:${http.address().port}`,results=[];
const cases={
 serena:{name:'find_symbol',arguments:{name_path_pattern:'workflow_sum',relative_path:'sample.py',include_body:false}},
 codegraph:{name:'codegraph_find_by_signature',arguments:{namePattern:'workflow_sum',limit:5}},
 'playwright-mcp':{name:'browser_navigate',arguments:{url}},
 devtools:{name:'new_page',arguments:{url}},
 context7:{name:'resolve-library-id',arguments:{libraryName:'Node.js',query:'Node.js documentation for fs.readFile; public test query'}},
};
try{
 for(const [id,request] of Object.entries(cases)){
  const c=new MCP(id,root);try{
   await c.start();let result=await c.request('tools/call',request);if(id==='playwright-mcp'&&!result.isError){const list=await c.request('tools/list');if(!list.tools.find(t=>t.name==='browser_evaluate')?.inputSchema.properties.function)throw Error('Evaluate capability missing');result=await c.request('tools/call',{name:'browser_evaluate',arguments:{function:'() => document.body.innerText'}});}const text=(result.content??[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');
   let verified=!result.isError;
   if(['serena','codegraph'].includes(id))verified=verified&&text.includes('workflow_sum')&&!/Error|not initialized|No active project/.test(text);
   if(id==='playwright-mcp')verified=verified&&text.includes('AW_BROWSER_OK');
   if(id==='devtools')verified=verified&&text.includes(url);
   if(id==='context7')verified=verified&&text.includes('/');
   results.push({id,operation:request.name,verified,evidence:'Synthetic/public fixture assertion; response contents omitted'});
  }catch(e){results.push({id,verified:false,error:e.message});}finally{await c.close();}
 }
 console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.verified))process.exitCode=1;
}finally{http.closeAllConnections();await new Promise(ok=>http.close(ok));rmSync(root,{recursive:true,force:true});}
