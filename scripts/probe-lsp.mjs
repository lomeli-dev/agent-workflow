// Optional live startup probes. No language server is installed automatically.
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {findBin,toolEnvironment} from '../lib/modules.mjs';
import {locations} from '../lib/install.mjs';

export function probeServer(id,command,args,root,env,timeout=15000){
 if(!command)return Promise.resolve({id,verified:false,error:'not-installed'});
 return new Promise(resolve=>{
  let buf=Buffer.alloc(0),done=false;
  const child=spawn(command,args,{cwd:root,env,stdio:['pipe','pipe','ignore']});
  const finish=result=>{
   if(done)return;done=true;clearTimeout(timer);child.kill();
   const force=setTimeout(()=>child.kill('SIGKILL'),1000);force.unref();child.once('exit',()=>clearTimeout(force));
   resolve({id,...result});
  };
  const timer=setTimeout(()=>finish({verified:false,error:'timeout'}),timeout);
  child.on('error',()=>finish({verified:false,error:'launch-failed'}));
  child.on('exit',()=>finish({verified:false,error:'early-exit'}));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{
   if(done)return;
   buf=Buffer.concat([buf,chunk]);if(buf.length>4*1024*1024)return finish({verified:false,error:'response-too-large'});
   while(!done){
    const split=buf.indexOf('\r\n\r\n');if(split<0)return;
    const match=/Content-Length:\s*(\d+)/i.exec(buf.subarray(0,split).toString());
    if(!match)return finish({verified:false,error:'invalid-framing'});
    const length=Number(match[1]);if(length>4*1024*1024)return finish({verified:false,error:'response-too-large'});
    if(buf.length<split+4+length)return;
    let msg;try{msg=JSON.parse(buf.subarray(split+4,split+4+length).toString());}catch{return finish({verified:false,error:'invalid-json'});}
    buf=buf.subarray(split+4+length);
    if(msg?.id===1)finish({verified:!!msg.result?.capabilities,check:'LSP initialize',server:msg.result?.serverInfo?.name??null,error:msg.error?'initialize-rejected':null});
   }
  });
  const text=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{processId:null,rootUri:pathToFileURL(root).href,capabilities:{},workspaceFolders:[]}});
  child.stdin.write('Content-Length: '+Buffer.byteLength(text)+'\r\n\r\n'+text);
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const loc=locations(),root=mkdtempSync(join(tmpdir(),'aw-lsp-')),results=[];
 try{
  for(const [id,name,args] of [['gopls','gopls',[]],['typescript','typescript-language-server',['--stdio']],['python','pyright-langserver',['--stdio']],['rust','rust-analyzer',[]],['bash','bash-language-server',['start']],['yaml','yaml-language-server',['--stdio']]])
   results.push(await probeServer(id,findBin(name,loc),args,root,toolEnvironment(loc)));
 }finally{rmSync(root,{recursive:true,force:true});}
 console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.verified))process.exitCode=1;
}
