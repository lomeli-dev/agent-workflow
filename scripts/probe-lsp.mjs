import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {findBin,toolEnvironment} from '../lib/modules.mjs';
import {locations} from '../lib/install.mjs';
const loc=locations(),root=mkdtempSync(join(tmpdir(),'aw-lsp-')),results=[];
try {for(const [id,name,args] of [['gopls','gopls',[]],['typescript','typescript-language-server',['--stdio']],['python','pyright-langserver',['--stdio']],['rust','rust-analyzer',[]],['bash','bash-language-server',['start']],['yaml','yaml-language-server',['--stdio']]]){
 const result=await new Promise(resolve=>{let buf=Buffer.alloc(0),done=false;const child=spawn(findBin(name,loc),args,{cwd:root,env:toolEnvironment(loc),stdio:['pipe','pipe','ignore']});const finish=r=>{if(done)return;done=true;clearTimeout(timer);child.kill();resolve({id,...r});};const timer=setTimeout(()=>finish({verified:false,error:'timeout'}),15000);
 child.on('error',e=>finish({verified:false,error:e.message})); child.on('exit',()=>finish({verified:false,error:'early exit'}));child.stdin.on('error',()=>{});
 child.stdout.on('data',b=>{buf=Buffer.concat([buf,b]);while(true){const split=buf.indexOf('\r\n\r\n');if(split<0)return;const len=Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0,split).toString())?.[1]);if(!Number.isFinite(len))return finish({verified:false,error:'framing'});if(buf.length<split+4+len)return;const msg=JSON.parse(buf.subarray(split+4,split+4+len));buf=buf.subarray(split+4+len);if(msg.id===1)finish({verified:!!msg.result?.capabilities,check:'LSP initialize',server:msg.result?.serverInfo?.name??null,error:msg.error??null});}});
 const text=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{processId:null,rootUri:pathToFileURL(root).href,capabilities:{},workspaceFolders:[]}});child.stdin.write('Content-Length: '+Buffer.byteLength(text)+'\r\n\r\n'+text);
 });results.push(result);
}}finally{rmSync(root,{recursive:true,force:true});}
console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.verified))process.exitCode=1;
