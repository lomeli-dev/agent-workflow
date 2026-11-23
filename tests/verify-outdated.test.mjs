import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,verify,locations,json,PACKAGE,VERSION} from '../lib/install.mjs';
import {block,blockContent,hash} from '../lib/files.mjs';
function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-outdated-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
const read=p=>readFileSync(p,'utf8');

test('verify is ok right after install and names the package version',t=>{
 const root=fixture(t);install({userRoot:root});const v=verify({userRoot:root});
 assert.equal(v.ok,true);assert.equal(v.status,'ok');assert.deepEqual(v.outdated,[]);assert.equal(v.installedVersion,VERSION);assert.equal(v.packageVersion,VERSION);
});

test('verify reports an installation made by an older package as outdated until sync',t=>{
 const root=fixture(t),l=locations(root);install({userRoot:root});
 const state=join(l.store,'installation.json'),m=json(read(state));m.version='0.2.0';
 const skill=join(l.claude,'skills/aw-workflow/SKILL.md'),rules=join(l.codex,'AGENTS.md');
 writeFileSync(skill,'older skill\n');m.files.find(f=>f.path===skill).afterHash=hash('older skill\n');
 const older=block(null,'Older rule text');writeFileSync(rules,older);Object.assign(m.files.find(f=>f.path===rules),{afterHash:hash(older),blockHash:hash(blockContent(older))});
 writeFileSync(state,JSON.stringify(m));
 const v=verify({userRoot:root});assert.equal(v.ok,false);assert.equal(v.status,'outdated');assert.deepEqual(v.issues,[]);assert.equal(v.installedVersion,'0.2.0');
 assert.deepEqual(v.outdated.map(o=>o.path).sort(),[rules,skill].sort());assert(v.outdated.every(o=>o.reason==='differs-from-package'));assert.match(v.next,/sync --global/);
 const cli=spawnSync(process.execPath,[join(PACKAGE,'bin/agent-workflow.mjs'),'verify','--user-root',root],{encoding:'utf8'});
 assert.equal(cli.status,1);assert.equal(JSON.parse(cli.stdout).status,'outdated');
 install({userRoot:root});assert.equal(verify({userRoot:root}).status,'ok');
});

test('a shim recording another Node that still exists is not outdated',t=>{
 const root=fixture(t),other=join(root,'other-node');writeFileSync(other,'#!/bin/sh\n');chmodSync(other,0o755);
 install({userRoot:root,nodePath:other});const v=verify({userRoot:root});assert.equal(v.ok,true,JSON.stringify(v));assert.deepEqual(v.outdated,[]);
});
