import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {install,verify,uninstall} from '../lib/install.mjs';
// Tests never start a real Codex (verify/install would ask codex app-server for hook trust).
process.env.AGENT_WORKFLOW_CODEX='none';
test('changes to owned hook definitions require review rather than silent replacement',t=>{
 const root=mkdtempSync(join(tmpdir(),'aw-hook-'));t.after(()=>rmSync(root,{recursive:true,force:true}));install({userRoot:root});
 const p=join(root,'.claude/settings.json'),d=JSON.parse(readFileSync(p));d.hooks.SessionStart[0].hooks[0].timeout=20;writeFileSync(p,JSON.stringify(d));
 assert.equal(verify({userRoot:root}).ok,false);assert.throws(()=>install({userRoot:root}),/Managed hook/);assert.throws(()=>uninstall({userRoot:root}),/Managed hook/);assert.equal(JSON.parse(readFileSync(p)).hooks.SessionStart[0].hooks[0].timeout,20);
});
