import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const cli=resolve('bin/agent-workflow.mjs');
function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'aw-claude-lean-'));
 try{
  const fake=join(root,'claude');
  writeFileSync(fake,`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.AW_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.AW_EXIT || 0));\n`);
  chmodSync(fake,0o755);
  const output=join(root,'args.json');
  const call=(args,extra={})=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:'utf8',env:{...process.env,PATH:root,AW_ARGS_FILE:output,...extra}});
  fn({root,output,call});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('lean Claude forwards arguments, selects empty MCP, and propagates child status',()=>fixture(({output,call})=>{
 const p=call(['claude-lean','--','--print','hello','--model','example'],{AW_EXIT:'17'});
 assert.equal(p.status,17);assert.match(p.stderr,/MCP servers are disabled/);
 assert.deepEqual(JSON.parse(readFileSync(output,'utf8')),['--print','hello','--model','example','--strict-mcp-config','--mcp-config','{"mcpServers":{}}']);
}));
test('lean Claude forwards an explicitly selected MCP file without reading or changing it',()=>fixture(({root,output,call})=>{
 const path=join(root,'selected.json'),content='{"mcpServers":{}}\n';writeFileSync(path,content);
 const p=call(['claude-lean','--mcp-file',path,'--','--print','hello']);assert.equal(p.status,0);
 assert.equal(readFileSync(path,'utf8'),content);assert.deepEqual(JSON.parse(readFileSync(output,'utf8')),['--print','hello','--strict-mcp-config','--mcp-config',path]);
}));
test('lean Claude rejects conflicting options and missing configuration before starting the child',()=>fixture(({root,call})=>{
 for(const args of [['claude-lean','--','--mcp-config','other'],['claude-lean','--','--strict-mcp-config'],['claude-lean','--mcp-file',join(root,'missing'),'--','hello']]){
  const p=call(args);assert.equal(p.status,1);assert.match(p.stderr,/MCP configuration|--mcp-file/);
 }
}));
