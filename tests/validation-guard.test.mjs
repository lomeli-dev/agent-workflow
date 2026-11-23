import test from 'node:test';import assert from 'node:assert/strict';
import {validationGuard} from '../lib/validation-guard.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {install,locations} from '../lib/install.mjs';
// Tests never start a real Codex (verify/install would ask codex app-server for hook trust).
process.env.AGENT_WORKFLOW_CODEX='none';
test('compound validation is blocked before execution, ordinary reads and direct validation remain',()=>{
 for(const c of ['npm test; echo EXIT:$?','npm test &','npm test # comment\necho done','npm test 2>&1 | tail -20','cd work && npm test','go test ./... || true','python3 -m pytest\necho done','env CI=1 pnpm run test:unit && cat result','(node --test); echo ok'])assert.equal(validationGuard(c).blocked,true,c);
 for(const c of ['npm test','npm test 2>&1','node --test tests/*.test.mjs','cat a b','npm install test && echo done','go list test | tail -1','echo "npm test; echo hi"','git status && git diff','npm test # comment','# comment\nnpm test','npm test;'])assert.equal(validationGuard(c).blocked,false,c);
});
test('captures that keep the validation status are allowed',()=>{
 for(const c of [
  'npm test > log 2>&1; echo "exit=$?"','npm test >log 2>&1\necho "exit=$?"','npm test &> log; printf "%s\\n" "status=$?"','pytest -q > out.txt; echo $?',
  'set -o pipefail; npm test | tail','set -euo pipefail; npm test 2>&1 | tail -20','set -o pipefail && npm test 2>&1 | tee log | tail -5','set -o pipefail\nnpx vitest run | tail',
  'npm test | tail; exit ${PIPESTATUS[0]}','npm test 2>&1 | tee log | tail; exit "${PIPESTATUS[0]}"','echo start | npm test | tail; exit ${PIPESTATUS[1]}','npm test > log 2>&1; exit $?',
  'bash -c "set -o pipefail; npm test | tail"','bash -lc "npm test > log 2>&1; echo exit=\\$?"',
 ])assert.equal(validationGuard(c).blocked,false,c);
});
test('status-hiding forms and wrapped test runners are blocked',()=>{
 for(const c of [
  'npm test; echo "exit=$?"','npm test > log; echo done','npm test > log 2>&1; echo "exit=$?"; rm log','npm test > /dev/null; echo ok && echo "$?"',
  'set -o pipefail; npm test | tail; echo done','npm test | tail; exit ${PIPESTATUS[1]}','npm test | tail; exit $?','set +e; npm test | tail','export CI=1; npm test',
  'npm test > log 2>&1; echo "exit=$?" &','npm test | tail & wait',
  'npx vitest run | tail','npx -y jest --ci 2>&1 | tail','pnpm exec vitest run | tail','yarn jest; echo done','bunx vitest | head',
  'uv run pytest | tail','uv run --with pytest-cov pytest -q | tail -5','poetry run pytest | tail',
  './gradlew test | tail','gradle :app:testDebugUnitTest | tail','./gradlew --offline check; echo ok',
  'make -C dir test | tail','make -j 4 -C services/api check 2>&1 | tail','make test > log; cat log',
  'bash -c "npm test | tail"','sh -c "npx vitest run; echo done"','bash -c "npm test" | tail','bash -lc "uv run pytest" | head',
 ])assert.equal(validationGuard(c).blocked,true,c);
});
test('wrapped runners alone run directly and lookalikes stay allowed',()=>{
 for(const c of ['npx vitest run','npx -y jest --ci','uv run pytest -q','uv run --with pytest-cov pytest','./gradlew test','gradle build','make -C dir test','make test','bash -c "npm test"','bash -lc "npm test 2>&1"',
  'npx prettier --check . | tail','uv run python script.py | tail','./gradlew dependencies | tail','make -C dir install | tail','bash -c "ls | wc -l"','make clean; make'])assert.equal(validationGuard(c).blocked,false,c);
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
