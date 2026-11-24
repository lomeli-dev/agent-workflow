import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,uninstall,verify,locations,json,dshProfiles} from '../lib/install.mjs';
import {START} from '../lib/files.mjs';
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-dsh-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const HEADER='# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries.\n';
const MODEL='- id: agent-default-model\n  name: "@deepseek-ai/dsh-agent-default-model"\n  config:\n    model: deepseek-v4-pro\n';
// The bridge and its peer, as `dsh plugin --profile P add -w <bridge> <peer>` leaves them.
function bridge(root,name,{protocol='0.2.2-rc.5'}={}){
  put(root,`.dsh/profiles/${name}/node_modules/@deepseek-ai/dsh-hooks-claude-code/package.json`,JSON.stringify({name:'@deepseek-ai/dsh-hooks-claude-code',version:'0.2.2-rc.5',peerDependencies:{'@deepseek-ai/dsh-hook-protocol':'0.2.2-rc.5'}}));
  if(protocol)put(root,`.dsh/profiles/${name}/node_modules/@deepseek-ai/dsh-hook-protocol/package.json`,JSON.stringify({name:'@deepseek-ai/dsh-hook-protocol',version:protocol}));
}
// A dsh home like the one `dsh` creates: profiles with cordis.yml, the user layer and, where the
// bridge was added, its packages in node_modules.
function dshHome(root,{headless=HEADER+MODEL,web=HEADER+'[]\n',plugin=['headless','web']}={}){
  for(const [name,patch] of [['headless',headless],['web',web]]){
    put(root,`.dsh/profiles/${name}/cordis.yml`,'[]\n');put(root,`.dsh/profiles/${name}/package.json`,'{"name":"dsh-profile-'+name+'"}\n');
    if(patch!==null)put(root,`.dsh/profiles/${name}/cordis.patch.yml`,patch);
    if(plugin.includes(name))bridge(root,name);
  }
  mkdirSync(join(root,'.dsh/profiles/node_modules/@deepseek-ai'),{recursive:true});
  return {headless:join(root,'.dsh/profiles/headless/cordis.patch.yml'),web:join(root,'.dsh/profiles/web/cordis.patch.yml')};
}
// The managed block: an insert list with the hooks row (only with the bridge) and one
// dsh-mcp-client row per MCP module.
const patchOf=(text)=>/# agent-workflow:begin \(managed; do not edit\)\n- insert:\n {4}- id: agent-workflow-hooks\n {6}name: '@deepseek-ai\/dsh-hooks-claude-code'\n {6}config:\n {8}configPath: "([^"]+)"\n {4}- id: agent-workflow-mcp-serena\n[\s\S]*# agent-workflow:end/.exec(text);
const mcpOnly=(text)=>/# agent-workflow:begin \(managed; do not edit\)\n- insert:\n {4}- id: agent-workflow-mcp-serena\n[\s\S]* {4}- id: agent-workflow-mcp-context7\n[\s\S]*# agent-workflow:end/.test(text)&&!text.includes('agent-workflow-hooks');

test('dsh: rule, aw-start skill, owned hooks.json and an insert row in each profile with the bridge',t=>{
  const root=fixture(t),p=dshHome(root),l=locations(root);
  const r=install({userRoot:root,clients:['dsh']});
  assert(read(join(l.dsh,'AGENTS.md')).includes(START));
  assert(read(join(l.dsh,'skills/aw-start/SKILL.md')).startsWith('---\nname: aw-start'));
  assert(read(join(l.skills,'aw-workflow/SKILL.md')),'shared skill in ~/.agents/skills, which dsh scans');
  assert(!existsSync(join(l.dsh,'skills/aw-workflow')),'no duplicate skill');
  for(const f of [p.headless,p.web]){const m=patchOf(read(f));assert(m,f);assert.equal(m[1],join(l.store,'dsh/hooks.json'));}
  assert(read(p.headless).startsWith(HEADER+MODEL),'user patches kept in place');
  assert(!/^\[\]$/m.test(read(p.web)),'the empty flow list is replaced by the block list');
  assert.equal(read(join(root,'.dsh/profiles/headless/cordis.yml')),'[]\n','cordis.yml untouched');
  const h=json(read(join(l.store,'dsh/hooks.json'))).hooks;
  assert.deepEqual(Object.keys(h),['SessionStart','SubagentStart','PreToolUse']);
  assert.equal(h.PreToolUse[0].matcher,'^bash$');
  for(const e of Object.values(h))assert.match(e[0].hooks[0].command,/bin\/node' '.*runtime\/hook\.mjs' '--client' 'dsh'$/);
  assert.equal(r.notices,undefined);
  assert.equal(verify({userRoot:root}).ok,true);
  assert.equal(install({userRoot:root,clients:['dsh']}).changedFiles,0);
});

test('dsh: edits outside the block survive sync and uninstall; uninstall restores the original files',t=>{
  const root=fixture(t),p=dshHome(root),before={headless:read(p.headless),web:read(p.web)};
  install({userRoot:root,clients:['dsh']});
  // The user (or dsh's config editor) adds a patch after the block in headless.
  const extra='- id: tool-bash\n  config:\n    enableRunInBackground: false\n';
  writeFileSync(p.headless,read(p.headless)+extra);
  assert.equal(verify({userRoot:root}).ok,true);
  assert.equal(install({userRoot:root,clients:['dsh']}).changedFiles,0);
  uninstall({userRoot:root});
  assert.equal(read(p.headless),before.headless+extra,'only the block (and the blank line it added) is removed');
  assert.equal(read(p.web),before.web,'untouched file comes back byte for byte, [] included');
  assert(!existsSync(join(root,'.dsh/AGENTS.md')));assert(!existsSync(join(root,'.dsh/skills/aw-start/SKILL.md')));
  assert(!existsSync(join(locations(root).store,'dsh/hooks.json')));
});

test('dsh: removing the block from an edited file that keeps no patch restores an empty list',t=>{
  const root=fixture(t),p=dshHome(root);install({userRoot:root,clients:['dsh']});
  writeFileSync(p.web,'# my note\n'+read(p.web));uninstall({userRoot:root});
  assert.equal(read(p.web),'# my note\n'+HEADER+'[]\n');
});

test('dsh: a profile without the bridge gets the MCP rows only and a notice with the add command',t=>{
  const root=fixture(t),p=dshHome(root,{plugin:['headless']});
  const r=install({userRoot:root,clients:['dsh']});
  assert(patchOf(read(p.headless)));assert(mcpOnly(read(p.web)),read(p.web));
  assert.equal(r.notices.length,1);
  assert.match(r.notices[0],/profile web: @deepseek-ai\/dsh-hooks-claude-code missing.*dsh plugin --profile web add -w @deepseek-ai\/dsh-hooks-claude-code@0\.2\.2-rc\.5 @deepseek-ai\/dsh-hook-protocol@0\.2\.2-rc\.5/);
  // The bridge without its peer (what dsh 0.2.2-rc.5 leaves after adding only the bridge) does not
  // import: still no block, and the notice names the peer.
  bridge(root,'web',{protocol:null});
  let n=install({userRoot:root,clients:['dsh']}).notices;assert(mcpOnly(read(p.web)));
  assert.match(n[0],/profile web: @deepseek-ai\/dsh-hook-protocol@0\.2\.2-rc\.5 \(peer of .*found none.*add -w @deepseek-ai\/dsh-hooks-claude-code@0\.2\.2-rc\.5 @deepseek-ai\/dsh-hook-protocol@0\.2\.2-rc\.5/);
  bridge(root,'web',{protocol:'0.1.2-rc.1'});assert.match(install({userRoot:root,clients:['dsh']}).notices[0],/found 0\.1\.2-rc\.1/);
  // With both packages, a sync mounts it there too.
  bridge(root,'web');
  assert.equal(install({userRoot:root,clients:['dsh']}).notices,undefined);assert(patchOf(read(p.web)));
  // Losing them again: verify says dsh will skip the hooks entry until a sync drops it.
  rmSync(join(root,'.dsh/profiles/web/node_modules'),{recursive:true});
  const v=verify({userRoot:root});assert.equal(v.status,'outdated');assert(v.notices.some(n=>/profile web: its cordis\.patch\.yml mounts .*dsh-hooks-claude-code is missing.*did not activate.*sync/.test(n)));
  install({userRoot:root,clients:['dsh']});assert(mcpOnly(read(p.web)));assert.equal(verify({userRoot:root}).ok,true);
  uninstall({userRoot:root});assert.equal(read(p.web),HEADER+'[]\n');
});

test('dsh: profile without a patch file gets one; it is removed again on uninstall',t=>{
  const root=fixture(t),p=dshHome(root,{web:null});install({userRoot:root,clients:['dsh']});
  assert(patchOf(read(p.web)));uninstall({userRoot:root});assert(!existsSync(p.web));
});

test('dsh: no profiles yet is a notice; unsupported YAML layouts are never edited; an edited block is drift',t=>{
  const empty=fixture(t);const r=install({userRoot:empty,clients:['dsh']});
  assert.match(r.notices[0],/no profile in .*profiles yet, so no hooks/);assert.deepEqual(dshProfiles(locations(empty)),[]);
  for(const layout of ['[{id: x, disabled: true}]\n','patches:\n  - id: x\n','---\n- id: x\n']){
    const root=fixture(t),p=dshHome(root,{web:layout});
    const r2=install({userRoot:root,clients:['dsh']});
    assert.equal(read(p.web),layout,'never edited');assert(patchOf(read(p.headless)),'other profiles still installed');
    assert(r2.notices.some(n=>/profile web: cordis\.patch\.yml is not a block list/.test(n)),layout);
    uninstall({userRoot:root});assert.equal(read(p.web),layout);
  }
  const root=fixture(t),p=dshHome(root);install({userRoot:root,clients:['dsh']});
  writeFileSync(p.web,read(p.web).replace('agent-workflow-hooks','mine'));
  assert.deepEqual(verify({userRoot:root}).issues.map(i=>i.issue),['managed-block-drift']);
  assert.throws(()=>install({userRoot:root,clients:['dsh']}),/Edited\/unowned managed block/);
  assert.throws(()=>uninstall({userRoot:root}),/Edited managed block/);
});

test('dsh: manifest entries cannot point the YAML block at another file',t=>{
  const root=fixture(t);dshHome(root);install({userRoot:root,clients:['dsh']});
  const state=join(locations(root).store,'installation.json'),m=json(read(state));
  const entry=m.files.find(f=>f.syntax==='yaml');
  for(const path of [join(root,'.dsh/profiles/web/cordis.yml'),join(root,'.dsh/profiles/../cordis.patch.yml'),join(root,'.dsh/profiles/node_modules/cordis.patch.yml'),join(root,'.dsh/cordis.patch.yml')]){
    writeFileSync(state,JSON.stringify({...m,files:m.files.map(f=>f===entry?{...f,path}:f)}));
    assert.throws(()=>verify({userRoot:root}),/Invalid owned path/,path);
  }
  writeFileSync(state,JSON.stringify({...m,files:m.files.map(f=>f===entry?{...f,syntax:'md'}:f)}));assert.throws(()=>verify({userRoot:root}),/Invalid owned path/);
});

test('dsh: installed hook answers the bridge payloads (context, bash guard with workdir) and honors opt-out',t=>{
  const root=fixture(t);dshHome(root);install({userRoot:root,clients:['dsh']});const l=locations(root);
  const project=join(root,'project');put(project,'package.json',JSON.stringify({scripts:{test:'node run-checks.mjs'}}));
  const commands=json(read(join(l.store,'dsh/hooks.json'))).hooks;
  const run=(event,input,cwd=project)=>{
    const r=spawnSync('/bin/sh',['-c',commands[event][0].hooks[0].command],{input:JSON.stringify({session_id:'s',transcript_path:'',hook_event_name:event,cwd,...input}),encoding:'utf8',cwd});
    assert.equal(r.status,0,r.stderr);return r.stdout?JSON.parse(r.stdout):{};
  };
  const start=run('SessionStart',{source:'startup'});assert.equal(start.hookSpecificOutput.hookEventName,'SessionStart');assert.match(start.hookSpecificOutput.additionalContext,/Agent Workflow is enabled/);
  const sub=run('SubagentStart',{agent_id:'a',agent_type:'general-purpose'});assert.match(sub.hookSpecificOutput.additionalContext,/Do not write shared \.memory/);
  const bash=command=>({tool_name:'bash',tool_input:{description:'x',command},tool_use_id:'c'});
  const deny=run('PreToolUse',bash('npm test 2>&1 | tail -20'));
  assert.equal(deny.hookSpecificOutput.permissionDecision,'deny');assert.match(deny.hookSpecificOutput.permissionDecisionReason,/AW_VALIDATION_COMPOUND/);
  assert.deepEqual(run('PreToolUse',bash('npm test')),{});assert.deepEqual(run('PreToolUse',bash('git status -sb | head')),{});
  // workdir selects the project whose package.json names the test script.
  const other=join(root,'other');mkdirSync(other);
  assert.deepEqual(run('PreToolUse',bash('node run-checks.mjs | tail'),other),{});
  assert.equal(run('PreToolUse',{...bash('node run-checks.mjs | tail'),tool_input:{command:'node run-checks.mjs | tail',workdir:project}},other).hookSpecificOutput.permissionDecision,'deny');
  assert.deepEqual(run('PreToolUse',{tool_name:'grep',tool_input:{pattern:'npm test | tail'}}),{});
  put(project,'.agent-workflow.json','{"schemaVersion":1,"enabled":false}');
  assert.deepEqual(run('SessionStart',{source:'startup'}),{});assert.deepEqual(run('PreToolUse',bash('npm test | tail')),{});
});
