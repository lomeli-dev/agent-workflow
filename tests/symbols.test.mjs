import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {findSymbols} from '../lib/symbols.mjs';import {decorateGraphResult,SYMBOL_TOOL} from '../lib/codegraph-adapter.mjs';
function fixture(t){const p=mkdtempSync(join(tmpdir(),'aw-symbols-'));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
test('module fallback finds original declarations without executing code or inventing graph coverage',t=>{
 const p=fixture(t);writeFileSync(join(p,'module.mjs'),'throw new Error("must never execute");\nexport function durationMs(value) { return value; }\nexport class Timer { tick() {} }\n');
 const r=findSymbols({project:p,file:'module.mjs',name:'durationMs'});assert.equal(r.source,'typescript-parser');assert.equal(r.graphRelationships,false);assert.deepEqual(r.symbols,[{name:'durationMs',kind:'function',file:'module.mjs',line:2,column:17}]);
 assert.equal(findSymbols({project:p,file:'module.mjs',name:'missing'}).symbols.length,0);
 assert.equal(findSymbols({project:p,file:'module.mjs',limit:1}).truncated,true);
});
test('module fallback respects opt-out, path bounds, extensions and syntax errors',t=>{
 const p=fixture(t),other=fixture(t);writeFileSync(join(other,'outside.mjs'),'export const secret = 1;');symlinkSync(join(other,'outside.mjs'),join(p,'escape.mjs'));
 assert.throws(()=>findSymbols({project:p,file:'escape.mjs'}),/outside/);
 assert.throws(()=>findSymbols({project:p,file:join(other,'outside.mjs')}),/relative/);
 writeFileSync(join(p,'bad.mjs'),'export function {');assert.throws(()=>findSymbols({project:p,file:'bad.mjs'}),/syntax/);
 writeFileSync(join(p,'read.txt'),'text');assert.throws(()=>findSymbols({project:p,file:'read.txt'}),/JavaScript/);
 writeFileSync(join(p,'.agent-workflow.json'),'{"schemaVersion":1,"enabled":false}');assert.throws(()=>findSymbols({project:p,file:'bad.mjs'}),/disabled/);
});
test('native graph empty results expose coverage limits and separate symbol tool',()=>{
 const listed=decorateGraphResult('tools/list',{tools:[{name:'codegraph_find_by_signature',description:'lookup'}]});assert(listed.tools.some(t=>t.name===SYMBOL_TOOL.name));assert.match(listed.tools[0].description,/coverage/i);
 const result=decorateGraphResult('tools/call',{content:[{type:'text',text:'[]'}]});assert.equal(result.content[0].text,'[]');assert.match(result.content[1].text,/not proof of absence/);
});

test('CodeGraph setup resolves the parser prerequisite without browser downloads',async()=>{
 const {selectModules}=await import('../lib/catalog.mjs');assert.deepEqual(selectModules({tools:['codegraph']}),['typescript','codegraph']);
 const selected=selectModules({profile:'code'});assert(selected.includes('typescript'));assert(!selected.includes('playwright'));
});
