import test from 'node:test';import assert from 'node:assert/strict';import {durationMs} from '../src/duration.mjs';import {summarize} from '../src/summary.mjs';
test('units and whitespace',()=>{assert.equal(durationMs(' 1.5s '),1500);assert.equal(durationMs('25ms'),25);assert.equal(durationMs('0ms'),0);});
test('strict invalid values',()=>{for(const x of ['12','-1s','NaNs','1s junk','1.2.3s','',null,2,{},'Infinitys'])assert.throws(()=>durationMs(x),TypeError);});
test('summaries',()=>{assert.deepEqual(summarize(['1s','500ms','2s']),{count:3,totalMs:3500,maxMs:2000});assert.deepEqual(summarize([]),{count:0,totalMs:0,maxMs:0});assert.throws(()=>summarize(['nope']),TypeError);});
