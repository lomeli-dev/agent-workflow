import test from 'node:test';import assert from 'node:assert/strict';
import {validationGuard} from '../lib/validation-guard.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {install,locations} from '../lib/install.mjs';
test('compound validation is blocked before execution, ordinary reads and direct validation remain',()=>{
 for(const c of ['npm test; echo EXIT:$?','npm test &','npm test # comment\necho done','npm test 2>&1 | tail -20','cd work && npm test','go test ./... || true','python3 -m pytest\necho done','env CI=1 pnpm run test:unit && cat result','(node --test); echo ok'])assert.equal(validationGuard(c).blocked,true,c);
 for(const c of ['npm test','npm test 2>&1','node --test tests/*.test.mjs','cat a b','npm install test && echo done','go list test | tail -1','echo "npm test; echo hi"','git status && git diff','npm test # comment','# comment\nnpm test','npm test;'])assert.equal(validationGuard(c).blocked,false,c);
});
test('native shell hook guards per-call scope and opt-out, then disposes',async t=>{
 const root=mkdtempSync(join(tmpdir(),'aw-guard-'));t.after(()=>rmSync(root,{recursive:true,force:true}));install({userRoot:root});
 const plugin=(await import(pathToFileURL(join(locations(root).store,'opencode-plugin/index.mjs')).href)).default;
 let callback,disposed=false;const cleanup=await plugin.setup({location:{directory:root},storage:{set:async()=>{}},shell:{hook:async(name,fn)=>{assert.equal(name,'create.before');callback=fn;return {dispose:async()=>{disposed=true;}};}}});
 assert.throws(()=>callback({cwd:root,command:'npm test; echo ok'}),/AW_VALIDATION_COMPOUND/);
 callback({cwd:root,command:'npm test'});
 writeFileSync(join(root,'.agent-workflow.json'),'{"schemaVersion":1,"enabled":false}');callback({cwd:root,command:'npm test; echo ok'});
 await cleanup();assert(disposed);
});
