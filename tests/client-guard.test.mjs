import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {parse as parseToml} from 'smol-toml';
import {install,uninstall,verify,locations,json,hooks,PACKAGE,ALL_CLIENTS,GUARD_OPT_IN} from '../lib/install.mjs';
import {hash} from '../lib/files.mjs';
// Tests never start a real Codex (verify/install would ask codex app-server for hook trust).
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-cguard-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
// The P2 fixture: `npm test` runs `node test.js`, which exits 7.
function project(root){const p=join(root,'project');put(p,'package.json',JSON.stringify({scripts:{test:'node test.js'}}));put(p,'test.js','process.exit(7);\n');return p;}
const disable=p=>put(p,'.agent-workflow.json','{"schemaVersion":1,"enabled":false}');

const BLOCKED=['npm test | tail','npm test; echo $?','node test.js; echo','npm test 2>&1 | tail -20; echo "exit=$?"','npm test | tail; exit ${PIPESTATUS[0]}'];
const ALLOWED=['npm test','node test.js','set -o pipefail; npm test | tail','cd . && npm test','npm test > log 2>&1; echo "exit=$?"','ls | wc -l','git status; echo done'];
// PreToolUse input as each client sends it (tool name, input fields, cwd field or not).
const INPUTS={
  claude:(cwd,command)=>({hook_event_name:'PreToolUse',cwd,tool_name:'Bash',tool_input:{command}}),
  codex:(cwd,command)=>({hook_event_name:'PreToolUse',cwd,turn_id:'t',tool_name:'Bash',tool_input:{command}}),
  qwen:(cwd,command)=>({hook_event_name:'PreToolUse',cwd,tool_name:'run_shell_command',tool_input:{command,is_background:false}}),
  commandcode:(cwd,command)=>({hook_event_name:'PreToolUse',cwd,tool_name:'shell_command',tool_display_name:'SHELL',tool_input:{command}}),
  kimi:(_cwd,command)=>({hook_event_name:'PreToolUse',session_id:'s',tool_name:'Bash',tool_input:{command},tool_call_id:'c'}),
};
function runHook(l,client,input,cwd){
  const args=[join(l.store,'runtime/hook.mjs'),...(['claude','codex'].includes(client)?[]:['--client',client])];
  const r=spawnSync(join(l.store,'bin/node'),args,{input:JSON.stringify(input),encoding:'utf8',cwd});
  assert.equal(r.status,0,r.stderr);return r.stdout?JSON.parse(r.stdout):{};
}

test('installed PreToolUse runtime denies status-hiding validations in every hook client and honors opt-out',t=>{
  const root=fixture(t),p=project(root);install({userRoot:root,clients:ALL_CLIENTS});const l=locations(root);
  for(const [client,input] of Object.entries(INPUTS)){
    for(const c of BLOCKED){
      const out=runHook(l,client,input(p,c),p);
      assert.equal(out.hookSpecificOutput?.permissionDecision,'deny',client+': '+c);
      assert.equal(out.hookSpecificOutput.hookEventName,'PreToolUse');
      assert.match(out.hookSpecificOutput.permissionDecisionReason,/AW_VALIDATION_COMPOUND.*set -o pipefail; CMD \| tail.*echo "exit=\$\?".*not `exit \$\{PIPESTATUS\[0\]\}`: zsh/s);
    }
    for(const c of ALLOWED)assert.deepEqual(runHook(l,client,input(p,c),p),{},client+': '+c);
    // Another tool, or no command, is never judged.
    assert.deepEqual(runHook(l,client,{...input(p,'npm test | tail'),tool_name:'Read'},p),{},client);
    assert.deepEqual(runHook(l,client,{...input(p,'x'),tool_input:{path:'a'}},p),{},client);
  }
  // Tool-specific working directories: qwen `directory`, Command Code `cwd` and split `args`.
  const other=join(root,'other');mkdirSync(other);
  assert.equal(runHook(l,'qwen',{...INPUTS.qwen(other,'node test.js; echo'),tool_input:{command:'node test.js; echo',directory:p}},other).hookSpecificOutput.permissionDecision,'deny');
  assert.equal(runHook(l,'commandcode',{...INPUTS.commandcode(other,''),tool_input:{command:'npm',args:['test',';','echo'],cwd:p}},other).hookSpecificOutput,undefined);
  assert.equal(runHook(l,'commandcode',{...INPUTS.commandcode(p,''),tool_input:{command:'npm test |',args:['tail']}},p).hookSpecificOutput.permissionDecision,'deny');
  disable(p);
  for(const [client,input] of Object.entries(INPUTS))for(const c of BLOCKED)assert.deepEqual(runHook(l,client,input(p,c),p),{},'opt-out '+client+': '+c);
});

test('hook clients get a PreToolUse entry for their shell tool next to user hooks; Codex only with --guard or --trust-codex',t=>{
  const root=fixture(t),l=locations(root);
  const orca='{"matcher":".*","hooks":[{"type":"command","command":"orca-cc"}]}';
  const cc=put(root,'.commandcode/settings.json',`{"hooks":{"PreToolUse":[${orca}]}}\n`);
  const kimiToml='default_model = "k2"\n\n# >>> orca-managed-kimi-hooks >>>\n[[hooks]]\nevent = "PreToolUse"\ntimeout = 10\ncommand = "orca-kimi"\n# <<< orca-managed-kimi-hooks <<<\n';
  const kc=put(root,'.kimi-code/config.toml',kimiToml);
  install({userRoot:root,clients:ALL_CLIENTS});
  const q=json(read(join(l.qwen,'settings.json')));assert.equal(q.hooks.PreToolUse.length,1);assert.equal(q.hooks.PreToolUse[0].matcher,'run_shell_command');assert.match(q.hooks.PreToolUse[0].hooks[0].command,/'--client' 'qwen'$/);
  const c=json(read(cc));assert.deepEqual(c.hooks.PreToolUse[0],JSON.parse(orca));assert.equal(c.hooks.PreToolUse[1].matcher,'^SHELL$');assert.match(c.hooks.PreToolUse[1].hooks[0].command,/'--client' 'commandcode'$/);
  const k=read(kc);assert(k.startsWith(kimiToml));const kt=parseToml(k);
  assert.deepEqual(kt.hooks.map(h=>[h.event,h.matcher??null]),[['PreToolUse',null],['PreToolUse','^Bash$']]);assert.match(kt.hooks[1].command,/'--client' 'kimi'$/);assert.equal(kt.default_model,'k2');
  // 0.6.0: the Claude guard is on by default; Codex needs --guard codex or --trust-codex.
  assert.equal(json(read(join(l.claude,'settings.json'))).hooks.PreToolUse[0].matcher,'Bash');assert.equal(json(read(join(l.codex,'hooks.json'))).hooks.PreToolUse,undefined);
  assert.deepEqual(json(read(join(l.store,'installation.json'))).guard,['claude']);
  // The pi extension and the MiMo plugin carry the guard in their own file.
  assert.match(read(join(l.pi,'extensions/agent-workflow.js')),/tool_call/);assert.match(read(join(l.mimo,'plugins/agent-workflow.js')),/tool\.execute\.before/);
  assert.equal(verify({userRoot:root}).ok,true,JSON.stringify(verify({userRoot:root}).issues));
  assert.equal(install({userRoot:root,clients:ALL_CLIENTS}).changedFiles,0);
  uninstall({userRoot:root});assert.equal(read(cc),`{"hooks":{"PreToolUse":[${orca}]}}\n`);assert.equal(read(kc),kimiToml);
  assert.deepEqual(GUARD_OPT_IN,['claude','codex']);
});

test('--guard adds the Claude/Codex PreToolUse entry without moving existing groups, sync keeps it, none removes it',t=>{
  const root=fixture(t),l=locations(root);
  const userCodex='{"hooks":{"PreToolUse":[{"matcher":"apply_patch","hooks":[{"type":"command","command":"user-patch"}]}],"Stop":[{"hooks":[{"type":"command","command":"user-stop"}]}]}}\n';
  const codexFile=put(root,'.codex/hooks.json',userCodex);
  install({userRoot:root});
  const before=json(read(codexFile));
  assert.throws(()=>install({userRoot:root,guard:['opencode']}),/--guard/);
  assert.throws(()=>install({userRoot:root,clients:['codex','opencode'],guard:['claude']}),/Client set changed|--guard/);
  install({userRoot:root,guard:['claude','codex']});
  const after=json(read(codexFile));
  for(const e of ['SessionStart','SubagentStart','PreCompact','Stop'])assert.deepEqual(after.hooks[e],before.hooks[e],e);
  assert.equal(after.hooks.PreToolUse[0].hooks[0].command,'user-patch');assert.equal(after.hooks.PreToolUse[1].matcher,'Bash');
  assert.equal(json(read(join(l.claude,'settings.json'))).hooks.PreToolUse[0].matcher,'Bash');
  const m=json(read(join(l.store,'installation.json')));assert.deepEqual(m.files.find(f=>f.client==='codex').events,['SessionStart','SubagentStart','PreCompact','PreToolUse']);
  // A sync without --guard keeps the choice; Codex reports the new hook as needing review.
  assert.equal(install({userRoot:root}).changedFiles,0);
  const v=verify({userRoot:root});assert.equal(v.ok,true);assert(v.warnings.some(w=>w.event==='PreToolUse'&&w.issue==='codex-hook-untrusted'&&w.key.endsWith(':pre_tool_use:1:0')));
  // The guard answers a real Claude-shaped call through the installed hook.
  const p=project(root),out=runHook(l,'claude',INPUTS.claude(p,'npm test; echo $?'),p);assert.equal(out.hookSpecificOutput.permissionDecision,'deny');
  install({userRoot:root,guard:['codex']});assert.equal(json(read(join(l.claude,'settings.json'))).hooks.PreToolUse,undefined);
  install({userRoot:root,guard:[]});assert.deepEqual(json(read(codexFile)),before);
  uninstall({userRoot:root});assert.equal(read(codexFile),userCodex);
});

test('a 0.4.0 installation (hook entries without events) syncs to the guard without rewriting its reminder hooks',t=>{
  const root=fixture(t),l=locations(root);install({userRoot:root,clients:['claude','codex','opencode','qwen','commandcode']});
  const state=join(l.store,'installation.json'),m=json(read(state));
  for(const f of m.files.filter(f=>f.kind==='hooks')){
    const spec=f.client;delete f.events;if(!['qwen','commandcode'].includes(spec))continue;
    const text=hooks(read(f.path),f.command,true,undefined,['PreToolUse']);writeFileSync(f.path,text);f.afterHash=hash(text);
  }
  writeFileSync(state,JSON.stringify(m));
  const qwenBefore=json(read(join(l.qwen,'settings.json')));assert.equal(qwenBefore.hooks.PreToolUse,undefined);
  assert.equal(verify({userRoot:root}).ok,false);// outdated: the package now ships the guard
  install({userRoot:root,clients:['claude','codex','opencode','qwen','commandcode']});
  const q=json(read(join(l.qwen,'settings.json')));for(const e of ['SessionStart','SubagentStart','PreCompact'])assert.deepEqual(q.hooks[e],qwenBefore.hooks[e]);
  assert.equal(q.hooks.PreToolUse[0].matcher,'run_shell_command');assert.equal(json(read(join(l.codex,'hooks.json'))).hooks.PreToolUse,undefined);
  assert.equal(verify({userRoot:root}).ok,true);
});

test('Kimi config.toml: invalid TOML is not overwritten, an edited block is drift, user text after it survives',t=>{
  const bad=fixture(t),kc=put(bad,'.kimi-code/config.toml','hooks = [\n');
  assert.throws(()=>install({userRoot:bad,clients:['kimi']}),/Invalid TOML/);assert.equal(read(kc),'hooks = [\n');
  const root=fixture(t),l=locations(root),file=put(root,'.kimi-code/config.toml','theme = "dark"\n');install({userRoot:root,clients:['kimi']});
  writeFileSync(file,read(file)+'\n[extra]\nkey = 1\n');assert.equal(verify({userRoot:root}).ok,true);
  writeFileSync(file,read(file).replace('timeout = 3','timeout = 9'));
  assert.deepEqual(verify({userRoot:root}).issues.map(i=>i.issue),['managed-block-drift']);
  {const r=install({userRoot:root,clients:['kimi']});assert.equal(r.ok,false);assert.match(r.skipped[0].error,/Edited\/unowned managed block/);assert.match(read(file),/timeout = 9/,'not overwritten');}
  assert.throws(()=>uninstall({userRoot:root}),/Edited managed block/);
  writeFileSync(file,read(file).replace('timeout = 9','timeout = 3'));uninstall({userRoot:root});
  assert.equal(read(file),'theme = "dark"\n\n[extra]\nkey = 1\n');assert.equal(existsSync(join(l.store,'installation.json')),false);
});

test('Pi tool_call and MiMo tool.execute.before block in their native shape and respect opt-out',async t=>{
  const root=fixture(t),p=project(root);install({userRoot:root,clients:['pi','mimo']});const l=locations(root);
  const pi=(await import(pathToFileURL(join(l.pi,'extensions/agent-workflow.js')).href)).default;
  const handlers={};pi({on:(name,fn)=>{handlers[name]=fn;}});
  for(const c of BLOCKED){const r=await handlers.tool_call({toolName:'bash',toolCallId:'1',input:{command:c}},{cwd:p});assert.equal(r.block,true,c);assert.match(r.reason,/AW_VALIDATION_COMPOUND/);}
  for(const c of ALLOWED)assert.equal(await handlers.tool_call({toolName:'bash',input:{command:c}},{cwd:p}),undefined,c);
  assert.equal(await handlers.tool_call({toolName:'read',input:{path:'npm test | tail'}},{cwd:p}),undefined);
  const {AgentWorkflow}=await import(pathToFileURL(join(l.mimo,'plugins/agent-workflow.js')).href);
  const mimo=(await AgentWorkflow({directory:p}))['tool.execute.before'];
  for(const c of BLOCKED){const out={args:{command:c,description:'x'}};await mimo({tool:'bash',sessionID:'s',callID:'c'},out);assert.equal(out.cancel,true,c);assert.match(out.cancelReason,/AW_VALIDATION_COMPOUND/);}
  const alias={args:{cmd:'npm test; echo $?'}};await mimo({tool:'exec_command'},alias);assert.equal(alias.cancel,true);
  const elsewhere={args:{command:'node test.js; echo',workdir:p}};await (await AgentWorkflow({directory:root}))['tool.execute.before']({tool:'bash'},elsewhere);assert.equal(elsewhere.cancel,true);
  for(const c of ALLOWED){const out={args:{command:c}};await mimo({tool:'bash'},out);assert.equal(out.cancel,undefined,c);}
  const other={args:{command:'npm test | tail'}};await mimo({tool:'read'},other);assert.equal(other.cancel,undefined);
  disable(p);
  assert.equal(await handlers.tool_call({toolName:'bash',input:{command:'npm test; echo $?'}},{cwd:p}),undefined);
  const off={args:{command:'npm test; echo $?'}};await mimo({tool:'bash'},off);assert.equal(off.cancel,undefined);
});

test('CLI --guard accepts claude,codex or none and rejects anything else',t=>{
  const root=fixture(t);
  const run=(...a)=>spawnSync(process.execPath,[cli,'install','--global','--user-root',root,'--dry-run',...a],{encoding:'utf8'});
  const ok=run('--guard','claude,codex');assert.equal(ok.status,0,ok.stderr);
  assert.equal(run('--guard','none').status,0);
  for(const bad of [['--guard','qwen','--clients','all'],['--guard','codex','--clients','claude'],['--guard','']]){const r=run(...bad);assert.equal(r.status,1,bad.join(' '));assert.match(r.stderr,/--guard/);}
  assert(!existsSync(join(root,'.claude')));
});
