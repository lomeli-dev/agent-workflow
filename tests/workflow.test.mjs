import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,statSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {install,uninstall,verify,locations,json,PACKAGE} from '../lib/install.mjs';
import {block,read,atomic,lock} from '../lib/files.mjs';
import {status,hookResult} from '../lib/gate.mjs';
import {setup} from '../lib/doctor.mjs';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'aw-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function put(root,name,text){const p=join(root,name);mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(p,text);return p;}
const cli=join(PACKAGE,'bin/agent-workflow.mjs');

test('global install preserves user config, is idempotent, and uninstalls exactly',t=>{
 const root=fixture(t);const original='// User note\n{ "model": "user-choice", "hooks": {"SessionStart":[{"hooks":[{"type":"command","command":"user-hook"}]}]}}\n';
 const settings=put(root,'.claude/settings.json',original);chmodSync(settings,0o640);
 const rules=put(root,'.codex/AGENTS.md','Personal rules without trailing newline');
 const plugin=put(root,'.config/opencode/opencode.jsonc','// keep\n{"plugins":["other-plugin"],"permissions":[]}');
 const pluginBefore=read(plugin);
 const first=install({userRoot:root});assert(first.changedFiles>15);assert.equal(verify({userRoot:root}).ok,true);
 assert.equal(statSync(settings).mode&0o777,0o640);
 assert.equal(json(read(settings)).model,'user-choice');assert(read(settings).includes('// User note'));
 assert.equal(json(read(settings)).hooks.SessionStart.length,2);
 assert.equal(install({userRoot:root}).changedFiles,0);
 assert(read(rules).startsWith('Personal rules without trailing newline'));
 assert.equal(json(read(plugin)).plugins[0],'other-plugin');
 uninstall({userRoot:root});assert.equal(read(settings),original);assert.equal(read(rules),'Personal rules without trailing newline');assert.equal(read(plugin),pluginBefore);
 assert.equal(verify({userRoot:root}).installed,false);
});

test('dry run never writes files or directories',t=>{
 const root=fixture(t);assert(install({userRoot:root,dryRun:true}).changes.length>0);assert(!existsSync(join(root,'.local')));assert(!existsSync(join(root,'.claude')));
});

test('uninstall preserves unrelated additions after installation',t=>{
 const root=fixture(t);install({userRoot:root});const l=locations(root);
 const p=join(l.claude,'settings.json');const value=json(read(p));value.anotherSetting={enabled:true};value.hooks.SessionStart.push({hooks:[{type:'command',command:'new-user-hook'}]});writeFileSync(p,JSON.stringify(value));
 const a=join(l.codex,'AGENTS.md');writeFileSync(a,read(a)+'\nNew personal rule\n');
 uninstall({userRoot:root});assert.equal(json(read(p)).anotherSetting.enabled,true);assert.deepEqual(json(read(p)).hooks.SessionStart,[{hooks:[{type:'command',command:'new-user-hook'}]}]);assert(read(a).includes('New personal rule'));assert(!read(a).includes('agent-workflow:begin'));
});

test('refuses collisions before writing any target',t=>{
 const root=fixture(t);put(root,'.opencode-unused','unchanged');put(root,'.claude/skills/aw-workflow/SKILL.md','User owned');
 assert.throws(()=>install({userRoot:root}),/Unowned/);assert(!existsSync(join(root,'.codex/AGENTS.md')));assert.equal(read(join(root,'.claude/skills/aw-workflow/SKILL.md')),'User owned');
});

test('edited owned file blocks overwrite and uninstall without partial deletion',t=>{
 const root=fixture(t);install({userRoot:root});const p=join(root,'.claude/skills/aw-workflow/SKILL.md');writeFileSync(p,read(p)+'\nLocal edit');
 assert.equal(verify({userRoot:root}).ok,false);assert.throws(()=>install({userRoot:root}),/edited/);assert.throws(()=>uninstall({userRoot:root}),/Edited owned/);assert(existsSync(join(root,'.codex/AGENTS.md')));
});

test('symlink destinations are not followed',t=>{
 const root=fixture(t),other=fixture(t);symlinkSync(other,join(root,'.claude'));assert.throws(()=>install({userRoot:root}),/symlink/);assert(!existsSync(join(other,'CLAUDE.md')));
});

test('malformed JSONC prevents partial installation',t=>{
 const root=fixture(t);put(root,'.claude/settings.json','{bad');assert.throws(()=>install({userRoot:root}),/JSON/);assert(!existsSync(join(root,'.agents')));
});

test('installation lock does not overwrite another operation',t=>{
 const root=fixture(t),l=locations(root);put(root,'.local/share/agent-workflow/install.lock','another');assert.throws(()=>install({userRoot:root}),/locked/);assert.equal(read(join(l.store,'install.lock')),'another');
});

test('tampered manifest cannot delete outside its owned path set',t=>{
 const root=fixture(t);install({userRoot:root});const p=join(locations(root).store,'installation.json'),m=json(read(p));m.files[0].path=put(root,'important.txt','keep');writeFileSync(p,JSON.stringify(m));
 assert.throws(()=>uninstall({userRoot:root}),/Invalid owned path/);assert.equal(read(join(root,'important.txt')),'keep');
});

test('project gate: default, ancestor, repository boundary, malformed config',t=>{
 const root=fixture(t);mkdirSync(join(root,'repo/.git'),{recursive:true});mkdirSync(join(root,'repo/src/deep'),{recursive:true});
 assert.equal(status(join(root,'repo/src')).enabled,true);
 put(root,'.agent-workflow.json',JSON.stringify({schemaVersion:1,enabled:false}));assert.equal(status(join(root,'repo/src')).enabled,true);
 put(root,'repo/.agent-workflow.json',JSON.stringify({schemaVersion:1,enabled:false}));assert.equal(status(join(root,'repo/src/deep')).enabled,false);
 put(root,'repo/src/.agent-workflow.json',JSON.stringify({schemaVersion:1,enabled:true}));assert.equal(status(join(root,'repo/src/deep')).enabled,true);
 put(root,'repo/src/.agent-workflow.json','bad');assert.equal(status(join(root,'repo/src')).reason,'invalid-project-config');
});

test('hooks produce bounded context, no output when opted out; malformed input safe',t=>{
 const root=fixture(t);assert(hookResult({cwd:root,hook_event_name:'SessionStart'}).hookSpecificOutput.additionalContext.length<600);
 put(root,'.agent-workflow.json',JSON.stringify({schemaVersion:1,enabled:false}));assert.deepEqual(hookResult({cwd:root,hook_event_name:'SubagentStart'}),{});
 const r=spawnSync(process.execPath,[join(PACKAGE,'lib/hook.mjs')],{input:'not-json',encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout,'');
});

test('CLI disable/enable works from a nested project and refuses unknown config',t=>{
 const root=fixture(t);mkdirSync(join(root,'.git'));mkdirSync(join(root,'sub'));
 const run=(...args)=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8'});
 assert.equal(run('disable','--project',join(root,'sub')).status,0);assert.equal(status(root).enabled,false);
 assert.equal(run('enable','--project',root).status,0);assert.equal(status(root).enabled,true);
 put(root,'.agent-workflow.json','{"enabled":false,"custom":"keep"}');assert.notEqual(run('disable','--project',root).status,0);assert(read(join(root,'.agent-workflow.json')).includes('keep'));
 assert.notEqual(run('install').status,0);
});

test('OpenCode plugin opt-out is checked and has no startup installs',async t=>{
 const root=fixture(t);install({userRoot:root});const p=join(locations(root).store,'opencode-plugin/index.mjs');const plugin=(await import(pathToFileURL(p).href)).default;
 const values=[];const ctx={location:{directory:root},storage:{set:async(...a)=>values.push(a)}};
 await plugin.setup(ctx);assert.equal(values.length,1);
 put(root,'.agent-workflow.json',JSON.stringify({schemaVersion:1,enabled:false}));await plugin.setup(ctx);assert.equal(values.length,1);
});

test('setup never runs unsupported or arbitrary package commands',t=>{
 const root=fixture(t);assert.throws(()=>setup({userRoot:root,tool:'$(bad)'}),/Supported setup tools/);
 const result=setup({userRoot:root,tool:'ast-grep'});assert(['reuse','install-proposed'].includes(result.action));assert(!existsSync(join(locations(root).store,'tools')));
});

test('malformed managed blocks are never silently rewritten',()=>{
 assert.throws(()=>block('<!-- agent-workflow:begin -->\nbad','new'),/Malformed/);
 assert.equal(block('personal',null),'personal');
});

test('client selection stays explicit and invalid clients do not install',t=>{
 const root=fixture(t);assert.throws(()=>install({userRoot:root,clients:['unknown']}),/Use claude/);
 install({userRoot:root,clients:['codex']});assert(!existsSync(join(root,'.claude')));assert.throws(()=>install({userRoot:root,clients:['codex','claude']}),/Client set changed/);
});
