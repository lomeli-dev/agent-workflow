import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,statSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,uninstall,verify,locations,json,hooks} from '../lib/install.mjs';
import {installation} from '../lib/doctor.mjs';
import {hash} from '../lib/files.mjs';
// Tests never start a real Codex (verify/install would ask codex app-server for hook trust).
process.env.AGENT_WORKFLOW_CODEX='none';
function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-shim-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
const read=p=>readFileSync(p,'utf8');
const hookCommand=root=>json(read(join(locations(root).claude,'settings.json'))).hooks.SessionStart.at(-1).hooks[0].command;
// Runs the installed hook command the way a client does: a shell string with the hook payload on stdin.
function runHook(root,cwd,PATH){return spawnSync('/bin/sh',['-c',hookCommand(root)],{input:JSON.stringify({cwd,hook_event_name:'SessionStart'}),encoding:'utf8',env:{PATH},timeout:5000});}

test('hooks call a stable store shim that records the installing Node',t=>{
 const root=fixture(t),l=locations(root);install({userRoot:root});
 const shim=join(l.store,'bin/node');assert(hookCommand(root).startsWith(`'${shim}' `));assert.equal(statSync(shim).mode&0o111,0o111);
 assert(read(shim).includes(`node='${process.execPath}'`));
 const r=runHook(root,root,dirname(process.execPath));assert.equal(r.status,0,r.stderr);assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext,/Agent Workflow is enabled/);
 assert.equal(verify({userRoot:root}).ok,true);
 uninstall({userRoot:root});assert.throws(()=>statSync(shim),/ENOENT/);
});

test('verify and doctor report a removed hook Node with the repair; the shim degrades without failing',t=>{
 const root=fixture(t),gone=join(root,'nvm/versions/node/v0.0.0/bin/node');install({userRoot:root,nodePath:gone});
 const v=verify({userRoot:root});assert.equal(v.ok,false);
 const issue=v.issues.find(i=>i.issue==='hook-node-missing');assert(issue);assert.equal(issue.node,gone);assert.match(issue.fix,/npm link.*sync --global/);
 assert(installation(root).issues.some(i=>i.issue==='hook-node-missing'));
 const fallback=runHook(root,root,dirname(process.execPath));assert.equal(fallback.status,0);assert.match(fallback.stdout,/additionalContext/);
 const empty=join(root,'empty-path');mkdirSync(empty);
 const none=runHook(root,root,empty);assert.equal(none.status,0);assert.equal(none.stdout,'');assert.match(none.stderr,/sync --global/);
 install({userRoot:root});assert.equal(verify({userRoot:root}).ok,true);
});

test('sync migrates a legacy absolute-Node hook command and verify flags it while broken',t=>{
 const root=fixture(t),l=locations(root);install({userRoot:root,clients:['claude']});
 const settings=join(l.claude,'settings.json'),state=join(l.store,'installation.json'),m=json(read(state));
 const entry=m.files.find(f=>f.kind==='hooks'),legacy=`'${join(root,'old-node/bin/node')}' '${join(l.store,'runtime/hook.mjs')}'`;
 const text=hooks(hooks(read(settings),entry.command,true),legacy);writeFileSync(settings,text);entry.command=legacy;entry.afterHash=hash(text);writeFileSync(state,JSON.stringify(m));
 const issue=verify({userRoot:root}).issues.find(i=>i.issue==='hook-node-missing');assert(issue);assert.match(issue.fallback,/none/);
 install({userRoot:root,clients:['claude']});assert(hookCommand(root).startsWith(`'${join(l.store,'bin/node')}' `));assert.equal(verify({userRoot:root}).ok,true);
 assert.equal(json(read(settings)).hooks.SessionStart.length,1);
});

test('verify reports a missing hook runtime script',t=>{
 const root=fixture(t),l=locations(root);install({userRoot:root});unlinkSync(join(l.store,'runtime/hook.mjs'));
 const issues=verify({userRoot:root}).issues;assert(issues.some(i=>i.issue==='missing'));assert(issues.some(i=>i.issue==='hook-runtime-missing'));
});
