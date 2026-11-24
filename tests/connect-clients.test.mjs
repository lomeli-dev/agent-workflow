import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as parseToml} from 'smol-toml';
import {json,locations,PACKAGE,uninstall,install} from '../lib/install.mjs';
import {connect,CONNECT_CLIENTS,parseConnectClients,connectionReceipts} from '../lib/connect.mjs';
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=realpathSync(mkdtempSync(join(tmpdir(),'aw-conn-')));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
function setup(t){const home=fixture(t),root=fixture(t);spawnSync('git',['init','-q'],{cwd:root});return {home,root};}
const launcher=(entry,root)=>{const args=entry.args??entry.command.slice(1);return args[args.indexOf('--project')+1]===root&&args.includes('mcp')&&args.includes('--tool');};

test('connect --clients all writes every client format, is idempotent and disconnect restores the project',t=>{
  const {home,root}=setup(t);
  assert.deepEqual(CONNECT_CLIENTS,['claude','codex','opencode','qwen','kimi','agy','commandcode','pi','mimo','dsh']);
  assert.deepEqual(parseConnectClients('all'),CONNECT_CLIENTS);
  // Pre-existing user configuration in shared files.
  const originals={
    '.mcp.json':'{"mcpServers":{"mine":{"command":"my-server"}}}\n',
    '.qwen/settings.json':'// project\n{"ui":{"theme":"dark"}}\n',
    'mimocode.jsonc':'// mimo\n{"model":"x"}\n',
  };
  for(const [p,s] of Object.entries(originals))put(root,p,s);
  const args={project:root,userRoot:home,clients:CONNECT_CLIENTS,tools:['serena','codegraph']};
  connect(args);
  const mcp=json(read(join(root,'.mcp.json'))).mcpServers;assert.deepEqual(Object.keys(mcp),['mine','aw-serena','aw-codegraph']);assert(launcher(mcp['aw-serena'],root));
  assert(launcher(json(read(join(root,'.qwen/settings.json'))).mcpServers['aw-codegraph'],root));assert.equal(json(read(join(root,'.qwen/settings.json'))).ui.theme,'dark');
  assert(launcher(json(read(join(root,'.pi/mcp.json'))).mcpServers['aw-serena'],root));
  const mimo=json(read(join(root,'mimocode.jsonc')));assert.equal(mimo.model,'x');assert.equal(mimo.mcp['aw-serena'].type,'local');assert(launcher(mimo.mcp['aw-serena'],root));
  assert(!existsSync(join(root,'mimocode.json')),'MiMo uses the file that exists');
  assert.equal(json(read(join(root,'.agents/plugins/agent-workflow-mcp/plugin.json'))).name,'agent-workflow-mcp');
  assert(launcher(json(read(join(root,'.agents/plugins/agent-workflow-mcp/mcp_config.json'))).mcpServers['aw-codegraph'],root));
  assert(launcher(json(read(join(root,'.dsh/agent-workflow-mcp.json'))).mcpServers['aw-codegraph'],root),'dsh reads it through the profile rows');
  assert.equal(parseToml(read(join(root,'.codex/config.toml'))).mcp_servers['aw-serena'].args.includes(root),true);
  assert(json(read(join(root,'opencode.jsonc'))).mcp.servers['aw-serena']);
  // One receipt; .mcp.json is shared by claude, commandcode and kimi.
  const receipt=json(read(connectionReceipts(home)[0].receipt));assert.equal(receipt.schemaVersion,2);
  assert.deepEqual(receipt.files.find(f=>f.path===join(root,'.mcp.json')).clients,['claude','kimi','commandcode']);
  const snapshot=Object.fromEntries(receipt.files.map(f=>[f.path,read(f.path)]));
  connect(args);for(const [p,s] of Object.entries(snapshot))assert.equal(read(p),s,'idempotent: '+p);
  // User edits outside the owned entries survive disconnect.
  writeFileSync(join(root,'.qwen/settings.json'),read(join(root,'.qwen/settings.json')).replace('"dark"','"light"'));
  // Clients stamp files that connect created (Qwen $version, MiMo $schema); that alone does not keep them.
  const oc=json(read(join(root,'opencode.jsonc')));writeFileSync(join(root,'opencode.jsonc'),JSON.stringify({$schema:'x',...oc}));
  const pi=json(read(join(root,'.pi/mcp.json')));pi.mcpServers.other={command:'x'};writeFileSync(join(root,'.pi/mcp.json'),JSON.stringify(pi));
  connect({...args,remove:true});
  assert.equal(read(join(root,'.mcp.json')),originals['.mcp.json']);assert.equal(read(join(root,'mimocode.jsonc')),originals['mimocode.jsonc']);
  assert.deepEqual(json(read(join(root,'.qwen/settings.json'))),{ui:{theme:'light'}});
  assert.deepEqual(json(read(join(root,'.pi/mcp.json'))),{mcpServers:{other:{command:'x'}}});
  for(const p of ['.agents/plugins/agent-workflow-mcp/plugin.json','.agents/plugins/agent-workflow-mcp/mcp_config.json','.dsh/agent-workflow-mcp.json','.codex/config.toml','opencode.jsonc','mimocode.json'])assert(!existsSync(join(root,p)),p);
  assert.equal(connectionReceipts(home).length,0);
});

test('connect refuses unowned or edited whole files and name collisions, without writing anything',t=>{
  const {home,root}=setup(t);
  put(root,'.agents/plugins/agent-workflow-mcp/plugin.json','{"name":"mine"}\n');
  assert.throws(()=>connect({project:root,userRoot:home,clients:['agy']}),/Unowned project MCP file/);assert.equal(read(join(root,'.agents/plugins/agent-workflow-mcp/plugin.json')),'{"name":"mine"}\n');
  rmSync(join(root,'.agents'),{recursive:true});
  put(root,'.pi/mcp.json','{"mcpServers":{"aw-serena":{"command":"other"}}}');
  assert.throws(()=>connect({project:root,userRoot:home,clients:['agy','pi']}),/collision: aw-serena/);assert(!existsSync(join(root,'.agents')));
  rmSync(join(root,'.pi'),{recursive:true});
  connect({project:root,userRoot:home,clients:['agy']});
  const cfg=join(root,'.agents/plugins/agent-workflow-mcp/mcp_config.json');writeFileSync(cfg,read(cfg).replace('aw-serena','aw-mine'));
  assert.throws(()=>connect({project:root,userRoot:home,clients:['agy'],remove:true}),/Edited project MCP file/);
  assert.throws(()=>connect({project:root,userRoot:home,clients:['agy','qwen']}),/client set changed/);
  assert.throws(()=>connect({project:root,userRoot:home,clients:['nope']}),/Unsupported or duplicate client/);
});

test('--approve writes Claude enabledMcpjsonServers and runs qwen mcp approve; disconnect removes only what it added',t=>{
  const {home,root}=setup(t),bin=fixture(t),log=join(bin,'qwen.log');
  // A fake qwen that records its arguments, working directory and QWEN_HOME.
  put(bin,'qwen',`#!/bin/sh\necho "$* | $(pwd) | $QWEN_HOME" >> '${log}'\n`);chmodSync(join(bin,'qwen'),0o755);
  const local=put(root,'.claude/settings.local.json','{"enabledMcpjsonServers":["mine"],"permissions":{"allow":[]}}\n');
  const path=process.env.PATH;process.env.PATH=bin+':'+path;t.after(()=>{process.env.PATH=path;});
  const r=connect({project:root,userRoot:home,clients:['claude','qwen'],tools:['serena','codegraph'],approve:true});
  assert.deepEqual(json(read(local)).enabledMcpjsonServers,['mine','aw-serena','aw-codegraph']);
  assert.deepEqual(r.qwenApproval.map(a=>[a.name,a.ok]),[['aw-serena',true],['aw-codegraph',true]]);
  assert.deepEqual(read(log).trim().split('\n'),['mcp approve aw-serena','mcp approve aw-codegraph'].map(a=>`${a} | ${root} | ${locations(home).qwen}`));
  assert.equal(r.approval,undefined,'nothing left to approve for claude/qwen');
  // A reconnect without --approve keeps the recorded approval.
  connect({project:root,userRoot:home,clients:['claude','qwen'],tools:['serena','codegraph']});assert.deepEqual(json(read(local)).enabledMcpjsonServers,['mine','aw-serena','aw-codegraph']);
  connect({project:root,userRoot:home,clients:['claude','qwen'],remove:true});
  assert.deepEqual(json(read(local)),{enabledMcpjsonServers:['mine'],permissions:{allow:[]}});
  // Without --approve, the result names what each client still needs.
  const other=setup(t);const plain=connect({project:other.root,userRoot:other.home,clients:['claude','pi','dsh','commandcode']});
  assert.deepEqual(Object.keys(plain.approval),['claude','pi','dsh']);assert.match(connect({project:fixture(t),userRoot:other.home,clients:['kimi','agy']}).approval.agy,/mcp\(agent-workflow-mcp_aw-<tool>\/\*\)/);assert(!existsSync(join(other.root,'.claude/settings.local.json')));
  // An approval file created by connect is removed again.
  const fresh=setup(t);connect({project:fresh.root,userRoot:fresh.home,clients:['claude'],approve:true});connect({project:fresh.root,userRoot:fresh.home,clients:['claude'],remove:true});
  assert(!existsSync(join(fresh.root,'.claude/settings.local.json')));
});

test('a 0.5.x receipt (one file per client) still disconnects cleanly',t=>{
  const {home,root}=setup(t);const original='{"mcpServers":{}}\n';put(root,'.mcp.json',original);
  connect({project:root,userRoot:home,clients:['claude'],tools:['serena']});
  const p=connectionReceipts(home)[0].receipt,r=json(read(p));
  const legacy={project:r.project,clients:r.clients,tools:r.tools,files:r.files.map(({clients,kind,...f})=>({...f,client:clients[0]}))};
  writeFileSync(p,JSON.stringify(legacy));
  connect({project:root,userRoot:home,clients:['claude'],remove:true});assert.equal(read(join(root,'.mcp.json')),original);
  // Tampered legacy receipts are still rejected.
  connect({project:root,userRoot:home,clients:['claude'],tools:['serena']});const r2=json(read(p));
  writeFileSync(p,JSON.stringify({...r2,files:r2.files.map(f=>({...f,path:join(root,'.qwen/settings.json')}))}));
  assert.throws(()=>connect({project:root,userRoot:home,clients:['claude'],remove:true}),/Invalid connection receipt/);
});

test('CLI connect --clients all --dry-run lists every file; --approve only with connect; uninstall waits for disconnect',t=>{
  const {home,root}=setup(t);
  const r=spawnSync(process.execPath,[cli,'connect','--project',root,'--clients','all','--dry-run','--user-root',home],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const files=JSON.parse(r.stdout).files;for(const p of ['.mcp.json','.qwen/settings.json','.pi/mcp.json','mimocode.json','.agents/plugins/agent-workflow-mcp/mcp_config.json','.dsh/agent-workflow-mcp.json'])assert(files.includes(join(root,p)),p);
  assert.equal(files.filter(f=>f===join(root,'.mcp.json')).length,1);
  const bad=spawnSync(process.execPath,[cli,'disconnect','--project',root,'--approve','--user-root',home],{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/--approve is only for connect/);
  install({userRoot:home,clients:['claude']});connect({project:root,userRoot:home,clients:['pi','mimo']});
  assert.throws(()=>uninstall({userRoot:home}),/Disconnect project/);connect({project:root,userRoot:home,clients:['pi','mimo'],remove:true});assert.equal(uninstall({userRoot:home}).uninstalled,true);
});
