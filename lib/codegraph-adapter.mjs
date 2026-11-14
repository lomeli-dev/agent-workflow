import {createInterface} from 'node:readline';
import {findSymbols} from './symbols.mjs';
export const COVERAGE_NOTE='AW_CODEGRAPH_COVERAGE: Native graph coverage does not include .mjs/.cjs/.mts/.cts in the tested engine. An empty graph result is not proof of absence. Use agent_workflow_symbols with the original relative file path for named declarations; it does not supply graph relationships.';
export const SYMBOL_TOOL={name:'agent_workflow_symbols',description:'Find named JS/TS declarations in an explicit original file, including .mjs/.cjs/.mts/.cts. Uses the TypeScript parser, not CodeGraph; no relationship graph or project execution. Useful when graph coverage is missing.',inputSchema:{type:'object',properties:{file:{type:'string',description:'Project-relative module path'},name:{type:'string',description:'Optional exact declaration name'},limit:{type:'integer',minimum:1,maximum:500}},required:['file'],additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}};
export function decorateGraphResult(method,result){
 if(method==='tools/list'&&Array.isArray(result?.tools))return {...result,tools:[...result.tools.map(t=>t.name==='codegraph_find_by_signature'?{...t,description:(t.description??'')+' '+COVERAGE_NOTE}:t),SYMBOL_TOOL]};
 if(method==='tools/call'&&Array.isArray(result?.content)&&result.content.some(c=>c.type==='text'&&typeof c.text==='string'&&c.text.trim()==='[]'))return {...result,content:[...result.content,{type:'text',text:COVERAGE_NOTE}]};
 return result;
}
export function adaptCodegraph(child,{project,userRoot,input=process.stdin,output=process.stdout}){
 const pending=new Map(),incoming=createInterface({input}),outgoing=createInterface({input:child.stdout});
 const write=message=>output.write(JSON.stringify(message)+'\n');
 incoming.on('line',line=>{
  let req;try{req=JSON.parse(line);}catch{return;}
  if(req?.method==='tools/call'&&req.params?.name===SYMBOL_TOOL.name){
   if(req.id===undefined)return;
   try{const args=req.params.arguments??{};if(Object.keys(args).some(k=>!['file','name','limit'].includes(k)))throw Error('Unexpected symbol argument');const data=findSymbols({...args,project,userRoot});write({jsonrpc:'2.0',id:req.id,result:{content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data}});}
   catch(e){write({jsonrpc:'2.0',id:req.id,result:{isError:true,content:[{type:'text',text:e.message}]}});}
   return;
  }
  if(req?.id!==undefined&&['tools/list','tools/call'].includes(req.method)){if(pending.size>=1000){write({jsonrpc:'2.0',id:req.id,error:{code:-32000,message:'Too many pending requests'}});return;}pending.set(req.id,req.method);}
  child.stdin.write(line+'\n');
 });
 incoming.on('close',()=>child.stdin.end());
 outgoing.on('line',line=>{
  let response;try{response=JSON.parse(line);}catch{return;}
  const method=pending.get(response?.id);pending.delete(response?.id);
  if(method&&response.result)response.result=decorateGraphResult(method,response.result);
  write(response);
 });
 return ()=>{incoming.close();outgoing.close();pending.clear();};
}
