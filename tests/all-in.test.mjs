import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,copyFileSync,chmodSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,uninstall,verify,json,locations,PACKAGE,AGY_ALLOW,agySettings} from '../lib/install.mjs';
import {connect,CONNECT_CLIENTS} from '../lib/connect.mjs';
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t,prefix='aw-allin-'){const p=realpathSync(mkdtempSync(join(tmpdir(),prefix)));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
const run=(args,env={})=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,AGENT_WORKFLOW_CODEX:'none',...env}});
const out=r=>JSON.parse(r.stdout);
const BRIDGE='@deepseek-ai/dsh-hooks-claude-code',PEER='@deepseek-ai/dsh-hook-protocol',V='0.2.2-rc.5';

test('--agy-allow adds owned permissions.allow entries, adopts existing ones without duplicates and uninstall removes them',t=>{
  const root=fixture(t),l=locations(root);
  const original='{\n  // mine\n  "model": "x",\n  "permissions": {"allow": ["run_command(ls)", "mcp(agent-workflow-mcp_aw-serena/*)"]},\n  "trustedWorkspaces": ["/p"]\n}\n';
  const settings=put(root,'.gemini/antigravity-cli/settings.json',original);
  assert.equal(agySettings(l),settings);
  assert.throws(()=>install({userRoot:root,clients:['claude'],agyAllow:true}),/needs agy/);
  install({userRoot:root,clients:['agy'],agyAllow:true});
  const allow=json(read(settings)).permissions.allow;
  assert.deepEqual(allow,['run_command(ls)',...AGY_ALLOW],'existing entry adopted in place, the others appended once');
  assert(read(settings).includes('// mine'),'comments and other keys kept');
  const m=json(read(join(l.store,'installation.json'))),f=m.files.find(x=>x.kind==='allow');
  assert.deepEqual(f.entries,AGY_ALLOW);assert.deepEqual(f.adopted,['mcp(agent-workflow-mcp_aw-serena/*)']);
  assert.equal(install({userRoot:root,clients:['agy']}).changedFiles,0,'a sync without the flag keeps the recorded entries');
  assert.equal(verify({userRoot:root}).ok,true);
  // A removed entry is drift for verify and comes back on sync.
  writeFileSync(settings,read(settings).replace(',\n      "mcp(agent-workflow-mcp_aw-context7/*)"',''));
  assert(verify({userRoot:root}).issues.some(i=>i.issue==='allow-entry-missing'));
  install({userRoot:root,clients:['agy']});assert.equal(json(read(settings)).permissions.allow.filter(e=>e===AGY_ALLOW[2]).length,1);
  uninstall({userRoot:root});
  assert.deepEqual(json(read(settings)).permissions.allow,['run_command(ls)'],'adopted entries are removed too');
  assert.equal(json(read(settings)).model,'x');assert(read(settings).includes('// mine'));
});

test('--agy-allow creates and removes the settings file when it did not exist; CLI --all-in turns it on for agy only',t=>{
  const root=fixture(t),l=locations(root);
  install({userRoot:root,clients:['agy'],agyAllow:true});
  assert.deepEqual(json(read(agySettings(l))),{permissions:{allow:AGY_ALLOW}});
  uninstall({userRoot:root});assert.equal(existsSync(agySettings(l)),false);
  const root2=fixture(t);
  const dry=out(run(['sync','--global','--clients','agy,claude','--all-in','--dry-run','--user-root',root2]));
  assert(dry.changes.some(c=>c.path===agySettings(locations(root2))&&c.kind==='allow'));
  const core=out(run(['sync','--global','--clients','claude','--all-in','--dry-run','--user-root',root2]));
  assert(!core.changes.some(c=>c.kind==='allow'),'no agy, no allow entries');assert.equal(core.codexTrust,undefined,'no codex, no trust');
  assert.match(run(['verify','--all-in']).stderr,/--all-in is only for/);
  assert.match(run(['connect','--project',root2,'--agy-allow']).stderr,/--agy-allow is only for install\/sync/);
});

// A dsh home with three profiles: headless (nothing), web (the user's bridge, no peer) and old (a
// peer at another version, which must not be replaced).
function dshSetup(t){
  const root=fixture(t),bin=fixture(t,'aw-bin-');
  copyFileSync(join(PACKAGE,'tests/fixtures/fake-dsh.mjs'),join(bin,'dsh'));chmodSync(join(bin,'dsh'),0o755);
  for(const p of ['headless','web','old']){put(root,`.dsh/profiles/${p}/cordis.yml`,'[]\n');put(root,`.dsh/profiles/${p}/package.json`,'{}\n');put(root,`.dsh/profiles/${p}/cordis.patch.yml`,'[]\n');}
  put(root,`.dsh/profiles/web/node_modules/${BRIDGE}/package.json`,JSON.stringify({name:BRIDGE,version:V,peerDependencies:{[PEER]:V}}));
  put(root,`.dsh/profiles/old/node_modules/${PEER}/package.json`,JSON.stringify({name:PEER,version:'0.1.2-rc.1'}));
  const calls=()=>(read(join(root,'dsh-calls.log'))??'').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));
  return {root,env:{PATH:bin+delimiter+process.env.PATH},calls,has:(p,n)=>existsSync(join(root,`.dsh/profiles/${p}/node_modules/${n}/package.json`))};
}

test('--dsh-plugins adds the missing bridge/peer at the dsh version, records them, mounts hooks; uninstall removes only those',t=>{
  const {root,env,calls,has}=dshSetup(t);
  const dry=out(run(['install','--global','--clients','dsh','--dsh-plugins','--dry-run','--user-root',root],env));
  assert.equal(dry.dshPlugins.version,V);
  assert.deepEqual(dry.dshPlugins.planned.map(p=>[p.profile,p.packages.map(x=>x.name)]),[['headless',[BRIDGE,PEER]],['web',[PEER]]]);
  assert.equal(dry.dshPlugins.planned[0].command,`dsh plugin --profile headless add -w ${BRIDGE}@${V} ${PEER}@${V}`);
  assert.match(dry.dshPlugins.skipped[0].reason,/0\.1\.2-rc\.1 is already in the profile/);
  assert.equal(has('headless',BRIDGE),false,'dry run adds nothing');
  const r=run(['install','--global','--clients','dsh','--dsh-plugins','--user-root',root],env);assert.equal(r.status,0,r.stderr);
  assert(has('headless',BRIDGE)&&has('headless',PEER)&&has('web',PEER));
  for(const p of ['headless','web'])assert.match(read(join(root,`.dsh/profiles/${p}/cordis.patch.yml`)),/id: agent-workflow-hooks/,'hooks row mounted once the packages are there');
  assert.doesNotMatch(read(join(root,'.dsh/profiles/old/cordis.patch.yml')),/agent-workflow-hooks/);
  const m=json(read(join(locations(root).store,'installation.json')));
  assert.deepEqual(m.dshPlugins,[{profile:'headless',packages:[{name:BRIDGE,version:V},{name:PEER,version:V}]},{profile:'web',packages:[{name:PEER,version:V}]}]);
  assert.equal(verify({userRoot:root}).ok,true);
  const adds=calls().filter(c=>c[3]==='add').length;
  assert.equal(run(['sync','--global','--clients','dsh','--all-in','--user-root',root],env).status,0);
  assert.equal(calls().filter(c=>c[3]==='add').length,adds,'nothing left to add');
  assert.deepEqual(json(read(join(locations(root).store,'installation.json'))).dshPlugins,m.dshPlugins,'records kept by a sync');
  const u=out(run(['uninstall','--global','--dry-run','--user-root',root],env));
  assert.deepEqual(u.dshPlugins.remove.map(x=>[x.profile,x.names]),[['headless',[BRIDGE,PEER]],['web',[PEER]]]);
  const done=run(['uninstall','--global','--user-root',root],env);assert.equal(done.status,0,done.stderr);
  assert(!has('headless',BRIDGE)&&!has('headless',PEER)&&!has('web',PEER));
  assert(has('web',BRIDGE),"the user's bridge stays");assert(has('old',PEER));
  for(const p of ['headless','web','old'])assert.equal(read(join(root,`.dsh/profiles/${p}/cordis.patch.yml`)),'[]\n');
  assert.equal(existsSync(join(locations(root).store,'installation.json')),false);
  assert(calls().every(c=>c[0]==='--version'||c[4]==='-w'),'every plugin command uses -w');
});

test('--dsh-plugins: a failed add is rolled back and nothing is installed; without dsh it is skipped with a note',t=>{
  const {root,env,has}=dshSetup(t);
  const r=run(['install','--global','--clients','dsh','--dsh-plugins','--user-root',root],{...env,FAKE_DSH_FAIL:'1'});
  assert.equal(r.status,1);assert.match(r.stderr,/dsh plugin add failed for profile headless/);
  assert(!has('headless',BRIDGE)&&!has('headless',PEER),'partial add removed');
  assert.equal(existsSync(join(locations(root).store,'installation.json')),false);
  const none=out(run(['install','--global','--clients','dsh','--dsh-plugins','--user-root',root],{AGENT_WORKFLOW_DSH:'none'}));
  assert.equal(none.installed,true);assert.equal(none.dshPlugins.found,false);
  assert.match(run(['install','--global','--clients','claude','--dsh-plugins','--dry-run','--user-root',root]).stderr,/needs dsh/);
});

function repo(t){
  const home=fixture(t),root=fixture(t);
  for(const a of [['init','-q'],['config','user.email','t@example.invalid'],['config','user.name','t']])spawnSync('git',a,{cwd:root});
  return {home,root,exclude:join(root,'.git/info/exclude')};
}
const ignored=(root,p)=>spawnSync('git',['check-ignore','-q','--no-index',p],{cwd:root}).status===0;

test('connect --exclude adds only untracked, not yet ignored paths in a managed block; disconnect removes it',t=>{
  const {home,root,exclude}=repo(t);
  // The team tracks .mcp.json; the user already ignores .codex/ and the agy plugin by hand.
  put(root,'.mcp.json','{"mcpServers":{}}\n');spawnSync('git',['add','.mcp.json'],{cwd:root});spawnSync('git',['commit','-qm','mcp'],{cwd:root});
  const manual='# mine\n.codex/\n.agents/plugins/agent-workflow-mcp/\n';put(root,'.git/info/exclude',manual);
  const args={project:root,userRoot:home,clients:CONNECT_CLIENTS,tools:['serena'],exclude:true};
  const dry=connect({...args,dryRun:true});
  assert.deepEqual(dry.exclude.added,['/opencode.jsonc','/.qwen/settings.json','/.pi/mcp.json','/mimocode.json','/.dsh/agent-workflow-mcp.json']);
  assert.deepEqual(dry.exclude.alreadyIgnored,['/.codex/config.toml','/.agents/plugins/agent-workflow-mcp/']);
  assert.equal(read(exclude),manual,'dry run writes nothing');
  const r=connect(args);
  assert.equal(r.exclude.path,exclude);
  assert(read(exclude).startsWith(manual),'user lines kept in place, not duplicated');
  assert.match(read(exclude),/# agent-workflow:begin \(managed; do not edit\)\n\/opencode\.jsonc\n[\s\S]*\/\.dsh\/agent-workflow-mcp\.json\n# agent-workflow:end\n$/);
  const status=spawnSync('git',['status','--porcelain','--untracked-files=all'],{cwd:root,encoding:'utf8'}).stdout;
  assert.equal(status.trim(),'M .mcp.json','only the tracked file shows up');
  const again=connect(args);assert.equal(again.exclude.added,undefined);assert.equal(read(exclude).match(/agent-workflow:begin/g).length,1,'idempotent');
  connect({...args,exclude:false});assert.match(read(exclude),/agent-workflow:begin/,'a later connect keeps the recorded block');
  connect({...args,remove:true});
  assert.equal(read(exclude),manual,'disconnect removes only the block');
  assert(!ignored(root,'opencode.jsonc'));
});

test('connect --exclude: edited block refuses disconnect; CLI --all-in also approves and covers .claude/settings.local.json; worktrees share the file',t=>{
  const {home,root,exclude}=repo(t);
  const r=out(run(['connect','--project',root,'--clients','claude,codex','--all-in','--user-root',home]));
  assert.deepEqual(r.exclude.added,['/.mcp.json','/.codex/config.toml','/.claude/settings.local.json']);
  assert.deepEqual(json(read(join(root,'.claude/settings.local.json'))).enabledMcpjsonServers,['aw-serena','aw-codegraph','aw-context7']);
  for(const p of ['.mcp.json','.codex/config.toml','.claude/settings.local.json'])assert(ignored(root,p),p);
  // A worktree of the same repository reads the same info/exclude: nothing new to add there.
  spawnSync('git',['commit','-q','--allow-empty','-m','init'],{cwd:root});
  const wt=join(fixture(t),'wt');spawnSync('git',['worktree','add','-q',wt],{cwd:root});
  const w=connect({project:realpathSync(wt),userRoot:home,clients:['claude','codex'],exclude:true});
  assert.equal(w.exclude.path,exclude);assert.equal(w.exclude.added,undefined);assert.match(w.exclude.skipped,/does not own/);
  connect({project:realpathSync(wt),userRoot:home,clients:['claude','codex'],remove:true});
  assert.match(read(exclude),/agent-workflow:begin/,"the worktree's disconnect leaves the clone's block");
  writeFileSync(exclude,read(exclude).replace('/.mcp.json\n','/.mcp.json\n/extra\n'));
  assert.throws(()=>connect({project:root,userRoot:home,clients:['claude','codex'],remove:true}),/Edited managed exclude block/);
  assert.match(run(['disconnect','--project',root,'--exclude','--user-root',home]).stderr,/--exclude is only for connect/);
});
