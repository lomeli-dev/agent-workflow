import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,uninstall,verify,locations,json,plan,PACKAGE} from '../lib/install.mjs';
import {hash} from '../lib/files.mjs';
import {validationGuard} from '../lib/validation-guard.mjs';
import {BATTERY} from './fixtures/guard-battery.mjs';
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-g06-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
function project(root){const p=join(root,'project');put(p,'package.json',JSON.stringify({scripts:{test:'node test.js',build:'tsc -p .',check:'node run-checks.mjs'}}));put(p,'test.js','process.exit(7);\n');return p;}
const hookOut=(l,args,input,cwd)=>{const r=spawnSync(join(l.store,'bin/node'),[join(l.store,'runtime/hook.mjs'),...args],{input:JSON.stringify(input),encoding:'utf8',cwd});assert.equal(r.status,0,r.stderr);return r.stdout?JSON.parse(r.stdout):{};};

test('false-positive battery: realistic agent commands through the installed Claude and Codex hooks',t=>{
  const root=fixture(t),p=project(root);install({userRoot:root,clients:['claude','codex'],guard:['claude','codex']});const l=locations(root);
  assert(BATTERY.length>=40);
  const wrong=[];
  for(const [command,expect] of BATTERY){
    const direct=validationGuard(command,{cwd:p}).blocked;
    // Claude's Bash sends no working directory: the hook uses the session cwd.
    const claude=hookOut(l,[],{hook_event_name:'PreToolUse',cwd:p,tool_name:'Bash',tool_input:{command,description:'x'}},p).hookSpecificOutput?.permissionDecision==='deny';
    const codex=hookOut(l,[],{hook_event_name:'PreToolUse',cwd:p,turn_id:'t',tool_name:'Bash',tool_input:{command}},p).hookSpecificOutput?.permissionDecision==='deny';
    const want=expect==='block';
    if(direct!==want||claude!==want||codex!==want)wrong.push({command,expect,direct,claude,codex});
  }
  assert.deepEqual(wrong,[]);
});

test('agy gets a PreToolUse run_command guard in its named group; Orca and user groups untouched',t=>{
  const root=fixture(t),l=locations(root),p=project(root);
  const orca='{"orca-status":{"PreToolUse":[{"matcher":"*","hooks":[{"type":"command","command":"orca-agy","timeout":10}]}]},"user-group":{"Stop":[{"type":"command","command":"u"}],"enabled":true}}\n';
  const file=put(root,'.gemini/config/hooks.json',orca);
  install({userRoot:root,clients:['agy']});
  const h=json(read(file));
  assert.deepEqual(h['orca-status'],JSON.parse(orca)['orca-status']);assert.deepEqual(h['user-group'],JSON.parse(orca)['user-group']);
  assert.equal(h['agent-workflow'].SessionStart[0].type,'command');
  assert.equal(h['agent-workflow'].PreToolUse[0].matcher,'run_command');assert.match(h['agent-workflow'].PreToolUse[0].hooks[0].command,/'--client' 'agy'$/);
  assert.equal(verify({userRoot:root}).ok,true);assert.equal(install({userRoot:root,clients:['agy']}).changedFiles,0);
  // Antigravity's PreToolUse payload: camelCase, toolCall {name, args {CommandLine, Cwd}}.
  const agy=(CommandLine,extra={})=>hookOut(l,['--client','agy'],{conversationId:'c',workspacePaths:[p],hookEventName:'PreToolUse',cwd:p,stepIdx:3,toolCall:{id:'t',name:'run_command',args:{CommandLine,Cwd:p,Blocking:true,WaitMsBeforeAsync:0,...extra}}},p);
  const deny=agy('npm test 2>&1 | tail -20');assert.equal(deny.decision,'deny');assert.match(deny.reason,/AW_VALIDATION_COMPOUND/);
  assert.deepEqual(agy('npm test'),{});assert.deepEqual(agy('git status -sb | head'),{});assert.deepEqual(agy('npm test > log 2>&1; echo "exit=$?"'),{});
  // Cwd selects the project (its package.json names node run-checks.mjs as the check script).
  const other=join(root,'other');mkdirSync(other);
  assert.equal(hookOut(l,['--client','agy'],{hookEventName:'PreToolUse',cwd:other,toolCall:{name:'run_command',args:{CommandLine:'node run-checks.mjs | tail',Cwd:p}}},other).decision,'deny');
  assert.deepEqual(hookOut(l,['--client','agy'],{hookEventName:'PreToolUse',cwd:other,toolCall:{name:'run_command',args:{CommandLine:'node run-checks.mjs | tail',Cwd:other}}},other),{});
  assert.deepEqual(hookOut(l,['--client','agy'],{hookEventName:'PreToolUse',cwd:p,toolCall:{name:'view_file',args:{AbsolutePath:'npm test | tail'}}},p),{});
  // SessionStart keeps working (injectSteps).
  assert.match(hookOut(l,['--client','agy'],{workspacePaths:[p],hookEventName:'SessionStart'},p).injectSteps[0].systemMessage.systemMessage,/Agent Workflow is enabled/);
  put(p,'.agent-workflow.json','{"schemaVersion":1,"enabled":false}');assert.deepEqual(agy('npm test | tail'),{});
  uninstall({userRoot:root});assert.equal(read(file),orca);
});

test('a 0.5.x agy installation (SessionStart only) syncs to the guard without moving its SessionStart hook',t=>{
  const root=fixture(t),l=locations(root);install({userRoot:root,clients:['agy']});
  const state=join(l.store,'installation.json'),m=json(read(state)),f=m.files.find(x=>x.client==='agy');
  const legacy={'agent-workflow':{SessionStart:json(read(f.path))['agent-workflow'].SessionStart}};
  writeFileSync(f.path,JSON.stringify(legacy,null,2)+'\n');f.events=['SessionStart'];f.afterHash=hash(read(f.path));delete m.guard;writeFileSync(state,JSON.stringify(m));
  assert.equal(verify({userRoot:root}).status,'outdated');
  install({userRoot:root,clients:['agy']});
  const h=json(read(f.path))['agent-workflow'];assert.deepEqual(h.SessionStart,legacy['agent-workflow'].SessionStart);assert.equal(h.PreToolUse[0].matcher,'run_command');
  assert.equal(verify({userRoot:root}).ok,true);
});

test('0.6.0 guard default: Claude on, Codex only with --trust-codex, recorded choices and 0.5.x choices kept',t=>{
  const events=(root,client)=>json(read(join(locations(root).store,'installation.json'))).files.find(f=>f.client===client).events;
  // Fresh install: Claude yes, Codex no; with trustCodex the plan adds Codex too.
  const fresh=fixture(t);install({userRoot:fresh});
  assert(events(fresh,'claude').includes('PreToolUse'));assert(!events(fresh,'codex').includes('PreToolUse'));
  assert.deepEqual(json(read(join(locations(fresh).store,'installation.json'))).guard,['claude']);
  assert.deepEqual(plan({userRoot:fixture(t),trustCodex:true}).guard,['claude','codex']);
  // A sync without --guard keeps the recorded choice, also --guard none.
  install({userRoot:fresh,guard:[]});assert.equal(install({userRoot:fresh}).changedFiles,0);assert.deepEqual(plan({userRoot:fresh,trustCodex:true}).guard,[]);
  assert.equal(json(read(join(locations(fresh).claude,'settings.json'))).hooks.PreToolUse,undefined);
  // 0.5.x manifest (no guard field) without any guard: the 0.6.0 default applies on sync.
  const old=fixture(t);install({userRoot:old,guard:[]});
  const state=join(locations(old).store,'installation.json'),m=json(read(state));delete m.guard;m.version='0.5.1';writeFileSync(state,JSON.stringify(m));
  assert.equal(verify({userRoot:old}).status,'outdated');
  install({userRoot:old});assert(events(old,'claude').includes('PreToolUse'));assert(!events(old,'codex').includes('PreToolUse'));
  // 0.5.x manifest that chose --guard codex only keeps exactly that.
  const chose=fixture(t);install({userRoot:chose,guard:['codex']});
  const s2=join(locations(chose).store,'installation.json'),m2=json(read(s2));delete m2.guard;writeFileSync(s2,JSON.stringify(m2));
  assert.deepEqual(plan({userRoot:chose}).guard,['codex']);assert.equal(install({userRoot:chose}).changedFiles,0);assert.deepEqual(json(read(s2)).guard,['codex']);
  assert(!events(chose,'claude').includes('PreToolUse'));
  // A tampered guard list is rejected.
  const bad=json(read(s2));bad.guard=['qwen'];writeFileSync(s2,JSON.stringify(bad));assert.throws(()=>verify({userRoot:chose}),/Invalid installation manifest/);
});

test('CLI --trust-codex dry-run plans the Codex guard; help names the default',t=>{
  const root=fixture(t);
  const r=spawnSync(process.execPath,[cli,'install','--global','--user-root',root,'--dry-run','--trust-codex'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const out=JSON.parse(r.stdout);assert(out.changes.some(c=>c.path===join(locations(root).codex,'hooks.json')));
  const help=spawnSync(process.execPath,[cli,'--help'],{encoding:'utf8'}).stdout;assert.match(help,/claude: on by default/);assert.match(help,/dsh/);
});
