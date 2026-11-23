import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,uninstall,locations,PACKAGE} from '../lib/install.mjs';
import {connect,connectionReceipts,pruneConnections} from '../lib/connect.mjs';
import {status,mcpProject,gitCommonDir} from '../lib/gate.mjs';
// Tests never start a real Codex (verify/install would ask codex app-server for hook trust).
process.env.AGENT_WORKFLOW_CODEX='none';
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
function git(cwd,...args){const r=spawnSync('git',['-c','user.email=aw@test.invalid','-c','user.name=aw-test','-c','init.defaultBranch=main',...args],{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
// main checkout with one commit plus a linked worktree, all inside a temporary directory.
function repo(t){
 const base=realpathSync(mkdtempSync(join(tmpdir(),'aw-worktree-')));t.after(()=>rmSync(base,{recursive:true,force:true}));
 const home=join(base,'home'),main=join(base,'main'),wt=join(base,'wt'),other=join(base,'other');for(const d of [home,main,other])mkdirSync(d);
 git(main,'init','-q');git(main,'commit','-q','--allow-empty','-m','init');git(main,'worktree','add','-q','-b','work',wt);git(other,'init','-q');
 return {base,home,main,wt,other};
}

test('linked worktrees share the main checkout Git directory without running git at runtime',t=>{
 const {main,wt,other}=repo(t);
 assert.equal(gitCommonDir(wt),gitCommonDir(main));assert.notEqual(gitCommonDir(other),gitCommonDir(main));
 assert.deepEqual(mcpProject(main,wt),{project:wt,registered:main});
 mkdirSync(join(wt,'src'));assert.deepEqual(mcpProject(main,join(wt,'src')),{project:wt,registered:main});
 assert.deepEqual(mcpProject(main,main),{project:main});
 assert.deepEqual(mcpProject(main,other),{project:main});
});

test('connect run from a worktree registers that worktree, not the main checkout',t=>{
 const {home,main,wt}=repo(t);
 connect({project:wt,userRoot:home,clients:['claude'],tools:['serena']});
 const args=JSON.parse(readFileSync(join(wt,'.mcp.json'),'utf8')).mcpServers['aw-serena'].args;
 assert.equal(args[args.indexOf('--project')+1],wt);assert(!existsSync(join(main,'.mcp.json')));
});

test('an MCP registered for the main checkout serves the worktree it is started from',t=>{
 const {main,wt}=repo(t);
 // Untracked switches stay in their checkout: the worktree does not inherit the main one.
 writeFileSync(join(main,'.agent-workflow.json'),'{"schemaVersion":1,"enabled":false}\n');assert.equal(status(main).enabled,false);assert.equal(status(wt).enabled,true);
 writeFileSync(join(wt,'.agent-workflow.json'),'{"schemaVersion":1,"enabled":false}\n');rmSync(join(main,'.agent-workflow.json'));
 // Main is enabled (it would try to launch Serena); the worktree is disabled, so a redirected launch answers as disabled.
 const init=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{}})+'\n';
 const r=spawnSync(process.execPath,[cli,'mcp','--tool','serena','--project',main],{cwd:wt,input:init,encoding:'utf8',timeout:5000});
 assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).result.serverInfo.name,'agent-workflow-disabled');assert.match(r.stderr,/serving worktree/);
});

test('uninstall explains orphaned receipts and disconnect --prune clears only those',t=>{
 const {home,main,wt}=repo(t);install({userRoot:home});
 connect({project:wt,userRoot:home,clients:['claude'],tools:['serena']});connect({project:main,userRoot:home,clients:['claude'],tools:['serena']});
 git(main,'worktree','remove','--force',wt);
 assert.throws(()=>uninstall({userRoot:home}),e=>e.message.includes(`no longer exists: ${wt}`)&&e.message.includes('disconnect --prune')&&e.message.includes(`Connected: ${main}`));
 assert.deepEqual(pruneConnections({userRoot:home,dryRun:true}).pruned,[wt]);assert.equal(connectionReceipts(home).length,2);
 const r=spawnSync(process.execPath,[cli,'disconnect','--prune','--user-root',home],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout).pruned,[wt]);
 assert.deepEqual(connectionReceipts(home).map(c=>c.project),[main]);
 assert.notEqual(spawnSync(process.execPath,[cli,'disconnect','--prune','--project',main,'--user-root',home],{encoding:'utf8'}).status,0);
 connect({project:main,userRoot:home,clients:['claude'],remove:true});assert.equal(uninstall({userRoot:home}).uninstalled,true);
 assert.equal(existsSync(join(locations(home).store,'installation.json')),false);
});
