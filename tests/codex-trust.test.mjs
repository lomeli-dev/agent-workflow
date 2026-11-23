import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,verify,locations,json,PACKAGE} from '../lib/install.mjs';
import {trustCodex} from '../lib/codex-trust.mjs';

// Never reach a real Codex from these tests: every call names the fake explicitly.
process.env.AGENT_WORKFLOW_CODEX='none';
function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-trust-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const cli=join(PACKAGE,'bin/agent-workflow.mjs');
// A `codex` executable in a temporary PATH directory that runs the fake app-server.
function fakeCodex(t){
  const dir=fixture(t),bin=join(dir,'codex');
  writeFileSync(bin,`#!/bin/sh\nexec '${process.execPath}' '${join(PACKAGE,'tests/fixtures/fake-codex.mjs')}' "$@"\n`);chmodSync(bin,0o755);
  return {dir,bin};
}
function run(args,{dir,mode,extra={}}={}){
  const env={...process.env,PATH:dir?dir+delimiter+process.env.PATH:process.env.PATH,...(mode?{FAKE_CODEX_MODE:mode}:{}),...extra};
  if(!extra.AGENT_WORKFLOW_CODEX)delete env.AGENT_WORKFLOW_CODEX;
  const r=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env});
  return {...r,json:r.stdout.trim()?JSON.parse(r.stdout):null};
}
const ORCA="'/opt/orca/bin/orca-hook' 'session'";
// Third-party hooks around the Agent Workflow ones: Orca (already trusted) and a lookalike that
// points at the Agent Workflow shim but another script, which must never be selected.
function setup(t){
  const root=fixture(t),l=locations(root),shim=join(l.store,'bin/node');
  const lookalike=`'${shim}' '/tmp/not-agent-workflow/hook.mjs'`;
  const file=put(l.home,'.codex/hooks.json',JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:ORCA}]}],Stop:[{hooks:[{type:'command',command:lookalike}]}]}})+'\n');
  install({userRoot:root,clients:['codex']});
  const orcaKey=`${file}:session_start:0:0`,statePath=join(l.codex,'fake-state.json');
  // Orca was trusted earlier (a stale hash and an explicit enabled are kept byte-for-byte).
  writeFileSync(statePath,JSON.stringify({[orcaKey]:{trusted_hash:'sha256:orca-old',enabled:true}}));
  return {root,l,file,orcaKey,statePath,writes:join(l.codex,'fake-writes.jsonl'),awKeys:[`${file}:session_start:1:0`,`${file}:subagent_start:0:0`,`${file}:pre_compact:0:0`]};
}

test('trust --dry-run lists the Agent Workflow Codex hooks and writes nothing',t=>{
  const s=setup(t),{dir}=fakeCodex(t),state=read(s.statePath),config=read(join(s.l.codex,'config.toml'));
  const r=run(['trust','--client','codex','--dry-run','--user-root',s.root],{dir});assert.equal(r.status,0,r.stderr);
  assert.equal(r.json.dryRun,true);assert.equal(r.json.trusted,0);assert.deepEqual([...r.json.toTrust].sort(),[...s.awKeys].sort());
  assert.deepEqual(r.json.before.map(h=>h.trustStatus),['untrusted','untrusted','untrusted']);
  assert.equal(read(s.writes),null);assert.equal(read(s.statePath),state);assert.equal(read(join(s.l.codex,'config.toml')),config);
  assert.match(r.json.note,/\/hooks/);
});

test('trust writes trusted_hash only for Agent Workflow hooks and leaves other hooks alone',t=>{
  const s=setup(t),{dir}=fakeCodex(t);
  const r=run(['trust','--client','codex','--user-root',s.root],{dir});assert.equal(r.status,0,r.stderr);
  assert.equal(r.json.ok,true);assert.equal(r.json.trusted,3);assert.deepEqual(r.json.after.map(h=>h.trustStatus),['trusted','trusted','trusted']);
  const writes=read(s.writes).trim().split('\n').map(JSON.parse);assert.equal(writes.length,1);
  const [edit]=writes[0].edits;assert.equal(edit.keyPath,'hooks.state');assert.equal(edit.mergeStrategy,'upsert');assert.equal(writes[0].reloadUserConfig,true);
  assert.deepEqual(Object.keys(edit.value).sort(),[...s.awKeys].sort());
  for(const v of Object.values(edit.value))assert.deepEqual(Object.keys(v),['trusted_hash']);
  const state=json(read(s.statePath));assert.deepEqual(state[s.orcaKey],{trusted_hash:'sha256:orca-old',enabled:true});
  assert.equal(Object.keys(state).filter(k=>k.includes(':stop:')).length,0);
  // Idempotent: nothing left to trust, no second write.
  const again=run(['trust','--client','codex','--user-root',s.root],{dir});assert.equal(again.status,0,again.stderr);assert.equal(again.json.trusted,0);
  assert.equal(read(s.writes).trim().split('\n').length,1);
});

test('verify uses codex app-server when available: trusted without enabled gives no warning',t=>{
  const s=setup(t),{bin}=fakeCodex(t);
  let v=verify({userRoot:s.root,codex:bin});assert.equal(v.codexHookTrust.source,'codex app-server');
  assert.deepEqual(v.warnings.map(w=>w.issue),['codex-hook-untrusted','codex-hook-untrusted','codex-hook-untrusted']);assert.match(v.warnings[0].fix,/agent-workflow trust --client codex/);
  return trustCodex({userRoot:s.root,codex:bin}).then(r=>{
    assert.equal(r.trusted,3);
    v=verify({userRoot:s.root,codex:bin});assert.equal(v.ok,true);assert.equal(v.warnings,undefined);
    assert.deepEqual(v.codexHookTrust.hooks.map(h=>[h.event,h.trustStatus,h.enabled]),[['SessionStart','trusted',true],['SubagentStart','trusted',true],['PreCompact','trusted',true]]);
    // A stale hash is "modified"; enabled = false is reported and trust never flips it.
    const state=json(read(s.statePath));state[s.awKeys[1]].trusted_hash='sha256:stale';state[s.awKeys[2]].enabled=false;writeFileSync(s.statePath,JSON.stringify(state));
    v=verify({userRoot:s.root,codex:bin});assert.deepEqual(v.warnings.map(w=>[w.event,w.issue]),[['SubagentStart','codex-hook-modified'],['PreCompact','codex-hook-disabled']]);
    return trustCodex({userRoot:s.root,codex:bin});
  }).then(r=>{
    assert.deepEqual(r.toTrust,[s.awKeys[1]]);assert.equal(json(read(s.statePath))[s.awKeys[2]].enabled,false);
    assert.deepEqual(verify({userRoot:s.root,codex:bin}).warnings.map(w=>w.issue),['codex-hook-disabled']);
  });
});

test('trust fails clearly and changes nothing when Codex is missing or app-server fails',async t=>{
  const s=setup(t),{dir,bin}=fakeCodex(t),state=read(s.statePath),hooksJson=read(s.file);
  await assert.rejects(trustCodex({userRoot:s.root,codex:null}),/Codex CLI not found.*nothing changed/);
  const none=run(['trust','--client','codex','--user-root',s.root],{extra:{AGENT_WORKFLOW_CODEX:'none'}});assert.equal(none.status,1);assert.match(none.stderr,/Codex CLI not found/);
  for(const [mode,pattern] of [['crash',/exited.*crashed on start.*nothing changed/],['init-error',/initialize failed: fake init failure.*nothing changed/],['list-error',/hooks\/list failed.*nothing changed/],['write-error',/config\/batchWrite failed: fake write failure/]]){
    const r=run(['trust','--client','codex','--user-root',s.root],{dir,mode});assert.equal(r.status,1,mode);assert.match(JSON.parse(r.stderr).error,pattern,mode);
    assert.equal(read(s.statePath),state,mode);assert.equal(read(s.file),hooksJson,mode);
  }
  // Codex accepts the write but still reports the hooks as untrusted: reported, exit 1.
  const ignored=run(['trust','--client','codex','--user-root',s.root],{dir,mode:'ignore-write'});assert.equal(ignored.status,1);assert.equal(ignored.json.ok,false);assert.equal(ignored.json.pending.length,3);
  const bad=run(['trust','--client','claude','--user-root',s.root],{dir});assert.equal(bad.status,1);assert.match(bad.stderr,/--client codex/);
  // verify falls back to config.toml when app-server fails, and says why.
  const v=spawnSync(process.execPath,[cli,'verify','--user-root',s.root],{encoding:'utf8',env:{...process.env,AGENT_WORKFLOW_CODEX:bin,FAKE_CODEX_MODE:'crash'}});
  const out=JSON.parse(v.stdout);assert.equal(out.codexHookTrust.source,'config.toml');assert.match(out.codexHookTrust.appServerError,/exited/);
});

test('install/sync --trust-codex is opt-in and trusts right after writing hooks.json',t=>{
  const root=fixture(t),{dir}=fakeCodex(t),l=locations(root);
  const plain=run(['install','--global','--clients','codex','--user-root',root],{dir});assert.equal(plain.status,0,plain.stderr);
  assert.equal(plain.json.codexTrust,undefined);assert.equal(read(join(l.codex,'fake-writes.jsonl')),null);
  const wrong=run(['sync','--global','--clients','claude','--trust-codex','--user-root',root],{dir});assert.equal(wrong.status,1);assert.match(wrong.stderr,/--trust-codex needs codex/);
  const preview=run(['sync','--global','--clients','codex','--trust-codex','--dry-run','--user-root',root],{dir});assert.equal(preview.status,0,preview.stderr);
  assert.equal(preview.json.codexTrust.dryRun,true);assert.equal(read(join(l.codex,'fake-writes.jsonl')),null);
  const failed=run(['sync','--global','--clients','codex','--guard','codex','--trust-codex','--user-root',root],{dir,mode:'crash'});assert.equal(failed.status,1);
  assert.equal(failed.json.installed,true);assert.equal(failed.json.codexTrust.ok,false);assert.equal(failed.json.warnings.length,4);
  const r=run(['sync','--global','--clients','codex','--trust-codex','--user-root',root],{dir});assert.equal(r.status,0,r.stderr);
  assert.equal(r.json.codexTrust.trusted,4);assert.equal(r.json.warnings,undefined);
  assert(r.json.codexTrust.after.some(h=>h.event==='preToolUse'&&h.trustStatus==='trusted'));
  assert.match(run(['verify','--user-root',root],{dir}).stdout,/"source": "codex app-server"/);
  const misuse=run(['verify','--trust-codex','--user-root',root],{dir});assert.equal(misuse.status,1);
});
