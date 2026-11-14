import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as toml} from 'smol-toml';
import {CATALOG,selectModules} from '../lib/catalog.mjs';
import {parseSelection} from '../lib/selector.mjs';
import {releaseAsset} from '../lib/modules.mjs';
import {disabledReply} from '../lib/mcp-launch.mjs';
import {connect} from '../lib/connect.mjs';
import {PACKAGE,json,uninstall} from '../lib/install.mjs';
function fixture(t){const root=mkdtempSync(join(tmpdir(),'aw-module-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
test('selector handles all, numeric choices, names, duplicates and invalid input',()=>{
 assert.deepEqual(parseSelection('todo'),selectModules({all:true}));assert.deepEqual(parseSelection('1, serena,1'),['gopls','serena']);assert.deepEqual(parseSelection(''),[]);assert.throws(()=>parseSelection('999'),/Unknown/);assert.throws(()=>selectModules({all:true,tools:['serena']}),/Choose/);assert(!Object.keys(CATALOG).some(s=>/eslint|prettier|ruff|shellcheck|tmux/.test(s)));
});
test('native release selects platform-specific checksum-protected assets',()=>{
 assert.match(releaseAsset('github','darwin','arm64').asset,/macOS_arm64.zip$/);assert.match(releaseAsset('gitleaks','linux','x64').asset,/linux_x64.tar.gz$/);assert.throws(()=>releaseAsset('github','win32','x64'),/supports/);
});
test('disabled MCP responds without starting backend',t=>{
 const root=fixture(t);writeFileSync(join(root,'.agent-workflow.json'),'{"schemaVersion":1,"enabled":false}');
 const input=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05'}},{jsonrpc:'2.0',id:2,method:'tools/list'}].map(JSON.stringify).join('\n')+'\n';
 const r=spawnSync(process.execPath,[join(PACKAGE,'bin/agent-workflow.mjs'),'mcp','--tool','serena','--project',root],{input,encoding:'utf8',timeout:3000});assert.equal(r.status,0,r.stderr);const lines=r.stdout.trim().split('\n').map(JSON.parse);assert.deepEqual(lines[1].result.tools,[]);assert.equal(disabledReply({method:'notifications/initialized'}),null);
});
test('connect/disconnect preserves all three native formats and comments',t=>{
 const root=fixture(t),home=fixture(t);mkdirSync(join(root,'.git'));mkdirSync(join(root,'.codex'));
 const originals={'.mcp.json':'{"mcpServers":{"mine":{"command":"keep"}}}', '.codex/config.toml':'# user\nmodel = "keep"\n[mcp_servers.mine]\ncommand="keep"\n', 'opencode.jsonc':'// comment\n{"mcp":{"servers":{"mine":{"type":"local","command":["keep"]}}}}'};
 for(const [p,s] of Object.entries(originals))writeFileSync(join(root,p),s);
 const args={project:root,userRoot:home,tools:['serena','codegraph']};connect(args);connect(args);
 assert.equal(toml(readFileSync(join(root,'.codex/config.toml'),'utf8')).model,'keep');assert.equal(json(readFileSync(join(root,'opencode.jsonc'),'utf8')).mcp.servers['aw-serena'].type,'local');
 connect({...args,remove:true});for(const [p,s] of Object.entries(originals))assert.equal(readFileSync(join(root,p),'utf8'),s);
});
test('unowned MCP collision and owned drift refuse before writing',t=>{
 const root=fixture(t),home=fixture(t);writeFileSync(join(root,'.mcp.json'),'{"mcpServers":{"aw-serena":{"command":"mine"}}}');
 assert.throws(()=>connect({project:root,userRoot:home,tools:['serena']}),/collision/);assert(!existsSync(join(root,'.codex')));
});

test('uninstall refuses active project registrations',t=>{
 const root=fixture(t),home=fixture(t);connect({project:root,userRoot:home,tools:['serena']});
 assert.throws(()=>uninstall({userRoot:home}),/Disconnect project/);
 connect({project:root,userRoot:home,remove:true});
 assert.equal(uninstall({userRoot:home}).reason,'not-installed');
});

test('Playwright browser engine is explicit only in all automatic selections',()=>{
 assert(!selectModules({all:true}).includes('playwright'));
 assert(!selectModules({profile:'web'}).includes('playwright'));
 assert(!parseSelection('all').includes('playwright'));
 assert.deepEqual(selectModules({tools:['playwright']}),['playwright']);
 assert.deepEqual(parseSelection('playwright'),['playwright']);
 assert(selectModules({profile:'web'}).includes('playwright-mcp'));
});
