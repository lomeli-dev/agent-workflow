import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {install,uninstall,verify,locations,json,PACKAGE,ALL_CLIENTS,EXTRA_CLIENTS,codexHookTrust} from '../lib/install.mjs';
import {START} from '../lib/files.mjs';
import {validationGuard} from '../lib/validation-guard.mjs';
// Tests never start a real Codex (verify/install would ask codex app-server for hook trust).
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-extra-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
const disable=root=>put(root,'.agent-workflow.json','{"schemaVersion":1,"enabled":false}');

// Pre-existing user configuration in every shared file an extra client uses.
function userConfig(root){
  return {
    qwenSettings:put(root,'.qwen/settings.json','// mine\n{"model":{"name":"user-model"},"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"user-qwen"}]}]}}\n'),
    qwenRule:put(root,'.qwen/QWEN.md','My Qwen rules\n'),
    agyHooks:put(root,'.gemini/config/hooks.json','{"user-group":{"PreInvocation":[{"type":"command","command":"user-agy"}],"enabled":true}}\n'),
    agyRule:put(root,'.gemini/GEMINI.md','My Gemini rules'),
    ccSettings:put(root,'.commandcode/settings.json','{"hooks":{"PreToolUse":[{"matcher":".*","hooks":[{"type":"command","command":"user-cc"}]}]}}\n'),
    piRule:put(root,'.pi/agent/AGENTS.md','Pi notes\n\n<!-- memoria-sesion (multi-IDE installer) -->\npointer\n<!-- /memoria-sesion (multi-IDE installer) -->\n'),
  };
}

test('default install keeps the three core clients only',t=>{
  const root=fixture(t);const r=install({userRoot:root});assert.deepEqual(r.clients,['claude','codex','opencode']);
  for(const d of ['.qwen','.kimi-code','.gemini','.commandcode','.pi','.config/mimocode'])assert(!existsSync(join(root,d)),d);
});

test('all clients: native layout, no duplicate skills, idempotent, edits survive sync and uninstall',t=>{
  const root=fixture(t),l=locations(root),u=userConfig(root),before=Object.fromEntries(Object.entries(u).map(([k,p])=>[k,read(p)]));
  const r=install({userRoot:root,clients:ALL_CLIENTS});assert.deepEqual(r.clients,ALL_CLIENTS);
  assert.equal(verify({userRoot:root}).ok,true,JSON.stringify(verify({userRoot:root}).issues));
  // Skill once in the shared folder, plus Antigravity's own folder; never a client duplicate.
  for(const p of ['.agents/skills/aw-workflow/SKILL.md','.gemini/config/skills/aw-workflow/SKILL.md','.gemini/config/skills/aw-start/SKILL.md','.gemini/config/agents/aw-worker.md',
    '.qwen/agents/aw-reviewer.md','.qwen/commands/aw-start.md','.kimi-code/agents/aw-worker.md','.kimi-code/skills/aw-start/SKILL.md',
    '.commandcode/agents/aw-worker.md','.commandcode/commands/aw-start.md','.pi/agent/prompts/aw-start.md','.pi/agent/extensions/agent-workflow.js',
    '.config/mimocode/agents/aw-reviewer.md','.config/mimocode/commands/aw-start.md','.config/mimocode/plugins/agent-workflow.js'])assert(existsSync(join(root,p)),p);
  for(const p of ['.qwen/skills','.kimi-code/skills/aw-workflow','.commandcode/skills','.pi/agent/skills','.config/mimocode/skills','.agents/skills/aw-start','.agents/agents','.cursor','.zcode'])assert(!existsSync(join(root,p)),p);
  // Rule blocks; Kimi and Command Code get a new AGENTS.md.
  for(const p of [u.qwenRule,u.agyRule,u.piRule,join(l.kimi,'AGENTS.md'),join(l.commandcode,'AGENTS.md')])assert(read(p).includes(START),p);
  assert(read(u.piRule).includes('memoria-sesion (multi-IDE installer)'));
  // MiMo falls back to ~/.claude/CLAUDE.md, which now carries the block: no own AGENTS.md is created.
  assert(!existsSync(join(l.mimo,'AGENTS.md')));assert(read(join(l.claude,'CLAUDE.md')).includes(START));
  assert(r.notices.some(n=>/MiMo reads ~\/.claude\/CLAUDE.md .*carries/.test(n)));
  // Hook registrations in each native shape, next to the user's entries.
  const q=json(read(u.qwenSettings));assert.equal(q.model.name,'user-model');assert.equal(q.hooks.SessionStart.length,2);for(const e of ['SubagentStart','PreCompact'])assert.match(q.hooks[e][0].hooks[0].command,/'--client' 'qwen'$/);
  const a=json(read(u.agyHooks));assert(a['user-group']);assert.match(a['agent-workflow'].SessionStart[0].command,/'--client' 'agy'$/);
  const cc=json(read(u.ccSettings));assert(cc.hooks.PreToolUse);assert.deepEqual(Object.keys(cc.hooks).sort(),['PreToolUse','SessionStart']);
  assert.equal(install({userRoot:root,clients:ALL_CLIENTS}).changedFiles,0);
  // User edits outside owned parts, then sync and uninstall.
  writeFileSync(u.qwenRule,read(u.qwenRule)+'\nLater Qwen rule\n');
  const qe=json(read(u.qwenSettings));qe.ui={theme:'dark'};writeFileSync(u.qwenSettings,JSON.stringify(qe,null,2));
  writeFileSync(u.agyHooks,read(u.agyHooks).replace('{','{\n  "later-group": {"Stop": []},'));
  writeFileSync(join(l.kimi,'AGENTS.md'),'Kimi rule before\n\n'+read(join(l.kimi,'AGENTS.md')));
  assert.equal(install({userRoot:root,clients:ALL_CLIENTS}).changedFiles,0);
  assert.equal(verify({userRoot:root}).ok,true);
  uninstall({userRoot:root});
  assert.equal(read(u.qwenRule),'My Qwen rules\n\nLater Qwen rule\n');
  assert.deepEqual(json(read(u.qwenSettings)),{...json(before.qwenSettings),ui:{theme:'dark'}});
  assert.deepEqual(json(read(u.agyHooks)),{'later-group':{Stop:[]},...json(before.agyHooks)});
  for(const k of ['agyRule','ccSettings','piRule'])assert.equal(read(u[k]),before[k],k);
  assert.equal(read(join(l.kimi,'AGENTS.md')),'Kimi rule before\n');
  for(const p of ['.agents/skills/aw-workflow/SKILL.md','.gemini/config/agents/aw-worker.md','.pi/agent/extensions/agent-workflow.js','.config/mimocode/plugins/agent-workflow.js','.commandcode/AGENTS.md','.claude/CLAUDE.md'])assert(!existsSync(join(root,p)),p);
  assert.equal(verify({userRoot:root}).installed,false);
});

test('a sync adds extra clients to an existing core installation and uninstall restores everything',t=>{
  const root=fixture(t);const original=put(root,'.qwen/settings.json','{"model":{"name":"x"}}');
  install({userRoot:root});install({userRoot:root,clients:['claude','codex','opencode','qwen','agy']});
  const v=verify({userRoot:root});assert.equal(v.ok,true);assert.deepEqual(v.clients,['claude','codex','opencode','qwen','agy']);
  assert.throws(()=>install({userRoot:root}),/Client set changed/);
  uninstall({userRoot:root});assert.equal(read(original),'{"model":{"name":"x"}}');assert(!existsSync(join(root,'.gemini/config/hooks.json')));
});

test('installed hook runtime answers in each client format and honors opt-out',t=>{
  const root=fixture(t),project=join(root,'project');mkdirSync(project);
  install({userRoot:root,clients:ALL_CLIENTS});const l=locations(root);
  const run=(client,input)=>{const r=spawnSync(join(l.store,'bin/node'),[join(l.store,'runtime/hook.mjs'),'--client',client],{input:JSON.stringify(input),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout?JSON.parse(r.stdout):{};};
  const qwen=run('qwen',{cwd:project,hook_event_name:'PreCompact'});assert.equal(qwen.hookSpecificOutput.hookEventName,'PreCompact');assert.match(qwen.hookSpecificOutput.additionalContext,/coordinator should preserve/);
  const agy=run('agy',{workspacePaths:[project],conversationId:'x'});assert.match(agy.injectSteps[0].systemMessage.systemMessage,/Agent Workflow is enabled/);
  disable(project);
  for(const [client,input] of [['qwen',{cwd:project,hook_event_name:'SessionStart'}],['agy',{workspacePaths:[project]}],['commandcode',{cwd:project,hook_event_name:'SessionStart'}]])assert.deepEqual(run(client,input),{},client);
});

test('Pi extension and MiMo plugin inject once per session and respect opt-out',async t=>{
  const root=fixture(t),project=join(root,'project');mkdirSync(project);
  install({userRoot:root,clients:['pi','mimo']});const l=locations(root);
  const pi=(await import(pathToFileURL(join(l.pi,'extensions/agent-workflow.js')).href)).default;
  const handlers={};pi({on:(name,fn)=>{handlers[name]=fn;}});
  const first=await handlers.before_agent_start({},{cwd:project});assert.match(first.message.content,/Agent Workflow is enabled/);assert.equal(first.message.display,false);
  assert.equal(await handlers.before_agent_start({},{cwd:project}),undefined);
  await handlers.session_start({});assert(await handlers.before_agent_start({},{cwd:project}));
  const {AgentWorkflow}=await import(pathToFileURL(join(l.mimo,'plugins/agent-workflow.js')).href);
  const hooks=await AgentWorkflow({directory:project}),output={system:['base']};
  await hooks['experimental.chat.system.transform']({},output);await hooks['experimental.chat.system.transform']({},output);assert.equal(output.system.length,2);
  disable(project);await handlers.session_start({});assert.equal(await handlers.before_agent_start({},{cwd:project}),undefined);
  const off={system:[]};await hooks['experimental.chat.system.transform']({},off);assert.deepEqual(off.system,[]);
});

test('MiMo rule goes to its own AGENTS.md only when that does not hide Claude instructions',t=>{
  const alone=fixture(t);install({userRoot:alone,clients:['mimo']});assert(read(join(alone,'.config/mimocode/AGENTS.md')).includes(START));
  const shared=fixture(t);put(shared,'.claude/CLAUDE.md','Claude rules\n');const r=install({userRoot:shared,clients:['mimo']});
  assert(!existsSync(join(shared,'.config/mimocode/AGENTS.md')));assert(r.notices.some(n=>/has no Agent Workflow block/.test(n)));
  const own=fixture(t);put(own,'.claude/CLAUDE.md','Claude rules\n');const p=put(own,'.config/mimocode/AGENTS.md','MiMo rules\n');install({userRoot:own,clients:['mimo']});
  assert(read(p).startsWith('MiMo rules\n'));assert(read(p).includes(START));uninstall({userRoot:own});assert.equal(read(p),'MiMo rules\n');
});

test('Without Codex, hook approval is read from config.toml (missing enabled = enabled) without changing it',t=>{
  const root=fixture(t);install({userRoot:root,clients:['codex']});const l=locations(root);
  let v=verify({userRoot:root});assert.equal(v.ok,true);assert.deepEqual(v.warnings.map(w=>w.issue),['codex-hook-untrusted','codex-hook-untrusted','codex-hook-untrusted']);assert.match(v.warnings[0].fix,/\/hooks/);assert.equal(v.codexHookTrust.source,'config.toml');assert.equal(v.codexHookTrust.hashChecked,false);
  const file=join(l.codex,'hooks.json'),toml=`[hooks.state."${file}:session_start:0:0"]\nenabled = true\ntrusted_hash = "sha256:aa"\n\n[hooks.state."${file}:subagent_start:0:0"]\ntrusted_hash = "sha256:bb"\n\n[hooks.state."${file}:pre_compact:0:0"]\nenabled = false\n`;
  put(root,'.codex/config.toml',toml);
  v=verify({userRoot:root});// SubagentStart has trusted_hash and no enabled: Codex runs it, so no warning (0.5.0 warned).
  assert.deepEqual(v.warnings.map(w=>[w.event,w.issue]),[['PreCompact','codex-hook-untrusted'],['PreCompact','codex-hook-disabled']]);
  assert.deepEqual(v.codexHookTrust.hooks.map(h=>h.trustStatus),['trusted-unverified','trusted-unverified','untrusted']);
  assert.equal(read(join(l.codex,'config.toml')),toml);
  const cmd=json(read(join(l.store,'installation.json'))).files.find(f=>f.kind==='hooks').command;assert.equal(codexHookTrust(l,cmd).length,2);
  const r=spawnSync(process.execPath,[cli,'doctor','--user-root',root,'--json'],{encoding:'utf8'});assert.equal(JSON.parse(r.stdout).installation.warnings.length,2);
});

test('clients left out by the owner are not installable',t=>{
  const root=fixture(t);for(const c of ['zcode','cursor'])assert.throws(()=>install({userRoot:root,clients:[c]}),/Use --clients/);
  for(const d of ['.zcode','.cursor','.claude'])assert(!existsSync(join(root,d)),d);
});

test('manifest hook entries cannot point a client spec at another file',t=>{
  const root=fixture(t);install({userRoot:root,clients:['qwen','commandcode']});const p=join(locations(root).store,'installation.json'),m=json(read(p));
  m.files.find(f=>f.client==='qwen').client='commandcode';writeFileSync(p,JSON.stringify(m));assert.throws(()=>uninstall({userRoot:root}),/Invalid owned path/);
});

test('CLI selects clients explicitly with a list or all',t=>{
  const root=fixture(t);
  const all=spawnSync(process.execPath,[cli,'install','--global','--clients','all','--dry-run','--user-root',root],{encoding:'utf8'});assert.equal(all.status,0,all.stderr);
  const out=JSON.parse(all.stdout);assert.deepEqual(out.clients,ALL_CLIENTS);assert(out.changes.some(c=>c.path===join(locations(root).qwen,'QWEN.md')));assert(!existsSync(join(root,'.qwen')));
  const bad=spawnSync(process.execPath,[cli,'install','--global','--clients','claude,nope','--user-root',root],{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/Use --clients/);
  assert.deepEqual(EXTRA_CLIENTS,['qwen','kimi','agy','commandcode','pi','mimo','dsh']);
});

test('guard recognizes node test files and the project test script, without lookalikes',t=>{
  const root=fixture(t);put(root,'package.json',JSON.stringify({scripts:{test:'node run-checks.mjs',build:'tsc -p . && echo built',start:'node server.js'}}));
  for(const c of ['node test.js; echo "exit=$?"','node tests/run.mjs | tail','node --import tsx src/a.spec.ts | head','node run-checks.mjs | tail','node run-checks.mjs; echo done'])assert.equal(validationGuard(c,{cwd:root}).blocked,true,c);
  for(const c of ['node test.js','node run-checks.mjs','node script.js | tail','node latest.js | tail','node server.js | tail','tsc -p . | tail','node run-checks.mjs > log 2>&1; echo "exit=$?"'])assert.equal(validationGuard(c,{cwd:root}).blocked,false,c);
  assert.equal(validationGuard('node run-checks.mjs | tail').blocked,false);
});
