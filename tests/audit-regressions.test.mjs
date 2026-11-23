import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {install,uninstall,locations,json,PACKAGE} from '../lib/install.mjs';
import {connect} from '../lib/connect.mjs';
import {hash} from '../lib/files.mjs';
import {spawnSync} from 'node:child_process';
function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-audit-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>readFileSync(p,'utf8');
test('global hooks and plugin array preserve comments inside unrelated entries',t=>{
 const home=fixture(t);
 const settings=put(home,'.claude/settings.json','{"hooks":{"SessionStart":[/* user hook comment */ {"hooks":[{"type":"command","command":"mine"}]}]}}');
 const plugin=put(home,'.config/opencode/opencode.jsonc','{"plugins":[/* user plugin comment */ "mine"]}');
 install({userRoot:home});assert(read(settings).includes('user hook comment'));assert(read(plugin).includes('user plugin comment'));
 assert.equal(install({userRoot:home}).changedFiles,0);
 writeFileSync(settings,read(settings)+'\n// later edit');writeFileSync(plugin,read(plugin)+'\n// later edit');
 uninstall({userRoot:home});assert(read(settings).includes('user hook comment'));assert(read(plugin).includes('user plugin comment'));assert(read(settings).includes('later edit'));assert(read(plugin).includes('later edit'));
});
test('global sync refuses alternate OpenCode path; uninstall cleans original path',t=>{
 const home=fixture(t),p=put(home,'.config/opencode/opencode.json','{}');install({userRoot:home});
 const q=put(home,'.config/opencode/opencode.jsonc','// new config\n{}');
 assert.throws(()=>install({userRoot:home}),/config selection changed/);uninstall({userRoot:home});assert.equal(read(p),'{}');assert.equal(read(q),'// new config\n{}');
});
test('global sync refuses deleted managed rules',t=>{
 const home=fixture(t);install({userRoot:home});writeFileSync(join(home,'.codex/AGENTS.md'),'Personal text');
 assert.throws(()=>install({userRoot:home}),/block/);assert.equal(read(join(home,'.codex/AGENTS.md')),'Personal text');
});
test('project disconnect uses owned OpenCode path despite new higher priority file',t=>{
 const home=fixture(t),root=fixture(t),args={project:root,userRoot:home,clients:['opencode'],tools:['serena']};
 const p=put(root,'opencode.json','{}');connect(args);const q=put(root,'opencode.jsonc','// new config\n{}');
 assert.throws(()=>connect(args),/config selection changed/);connect({...args,remove:true});assert.equal(read(p),'{}');assert.equal(read(q),'// new config\n{}');
});
test('project Codex missing or duplicate block fails before receipt removal',t=>{
 const home=fixture(t),root=fixture(t),args={project:root,userRoot:home,clients:['codex'],tools:['serena']};
 connect(args);const p=join(root,'.codex/config.toml'),initial=read(p);writeFileSync(p,'# user removed block');
 assert.throws(()=>connect({...args,remove:true}),/block/);assert.throws(()=>connect(args),/block/);
 writeFileSync(p,initial+initial);assert.throws(()=>connect({...args,remove:true}),/block/);
});
test('nested connection and preview cannot promote an opted-out path to enabled Git root',t=>{
 const home=fixture(t),root=fixture(t);mkdirSync(join(root,'.git'));const sub=join(root,'nested');mkdirSync(sub);put(sub,'.agent-workflow.json','{"schemaVersion":1,"enabled":false}');
 assert.throws(()=>connect({project:sub,userRoot:home}),/repository root/);
 const r=spawnSync(process.execPath,[join(PACKAGE,'bin/agent-workflow.mjs'),'mcp-config','--project',sub],{encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/repository root/);assert(!existsSync(join(root,'.mcp.json')));
});
test('malformed receipt entries and altered backup fail closed',t=>{
 const home=fixture(t),root=fixture(t),args={project:root,userRoot:home,clients:['claude'],tools:['serena']};connect(args);
 const state=join(locations(home).store,'connections',hash(realpathSync(root))+'.json'),original=read(state),config=read(join(root,'.mcp.json'));
 let data=JSON.parse(original);data.files[0].original='{"changed":true}';writeFileSync(state,JSON.stringify(data));assert.throws(()=>connect({...args,remove:true}),/checksum/);
 data=JSON.parse(original);data.files[0].entries={mine:{command:'mine'}};writeFileSync(state,JSON.stringify(data));assert.throws(()=>connect({...args,remove:true}),/owned MCP/);assert.equal(read(join(root,'.mcp.json')),config);
});
test('invalid MCP container and duplicate clients preserve user data',t=>{
 const home=fixture(t),root=fixture(t);const p=put(root,'.mcp.json','{"mcpServers":["mine"]}');
 assert.throws(()=>connect({project:root,userRoot:home,clients:['claude']}),/container/);assert.equal(read(p),'{"mcpServers":["mine"]}');assert.throws(()=>connect({project:root,userRoot:home,clients:['claude','claude']}),/duplicate/);
});

test('catalog and disabled MCP reject inherited object property names',async()=>{
 const {selectModules}=await import('../lib/catalog.mjs');const {parseSelection}=await import('../lib/selector.mjs');const {disabledReply}=await import('../lib/mcp-launch.mjs');
 for(const name of ['constructor','toString','__proto__']){
  assert.throws(()=>selectModules({tools:[name]}),/Unknown/);assert.throws(()=>selectModules({profile:name}),/Unknown/);assert.throws(()=>parseSelection(name),/Unknown/);
  assert.equal(disabledReply({jsonrpc:'2.0',id:1,method:name}).error.code,-32601);
 }
});

test('optional LSP probe reports missing and malformed servers without aborting the audit',async t=>{
 const {probeServer}=await import('../scripts/probe-lsp.mjs');const root=fixture(t);
 assert.equal((await probeServer('missing',null,[],root,process.env)).error,'not-installed');
 const invalid=await probeServer('bad',process.execPath,['-e',"process.stdout.write('Content-Length: 1\\r\\n\\r\\nx');setTimeout(()=>{},1000)"],root,process.env);
 assert.equal(invalid.error,'invalid-json');
 const script="const s=JSON.stringify({jsonrpc:'2.0',id:1,result:{capabilities:{}}});process.stdout.write('Content-Length: '+Buffer.byteLength(s)+'\\r\\n\\r\\n'+s);setTimeout(()=>{},1000)";
 assert.equal((await probeServer('good',process.execPath,['-e',script],root,process.env)).verified,true);
});

test('special project config fails closed without blocking hooks',async t=>{
 if(process.platform==='win32'){t.skip('POSIX FIFO fixture');return;}
 const root=fixture(t),p=join(root,'.agent-workflow.json');const r=spawnSync('mkfifo',[p],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const {status}=await import('../lib/gate.mjs');assert.equal(status(root).enabled,false);
 const hook=spawnSync(process.execPath,[join(PACKAGE,'lib/hook.mjs')],{input:JSON.stringify({cwd:root,hook_event_name:'SessionStart'}),encoding:'utf8',timeout:2000});assert.equal(hook.status,0);assert.equal(hook.stdout,'');
});

test('uninstall removes a trailing owned hook from compact JSON without corrupting it',t=>{
 const home=fixture(t);install({userRoot:home});const p=join(home,'.claude/settings.json');
 const v=json(read(p));v.hooks.SessionStart.unshift({hooks:[{type:'command',command:'mine'}]});writeFileSync(p,JSON.stringify(v));
 uninstall({userRoot:home});assert.deepEqual(json(read(p)),{hooks:{SessionStart:[{hooks:[{type:'command',command:'mine'}]}]}});
});
