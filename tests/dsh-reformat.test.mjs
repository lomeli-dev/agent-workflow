import test from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {install,uninstall,verify,locations,json,PACKAGE} from '../lib/install.mjs';
import {dshBlockData} from '../lib/dsh-block.mjs';
import {blockContent} from '../lib/files.mjs';
process.env.AGENT_WORKFLOW_CODEX='none';

function fixture(t){const p=realpathSync(mkdtempSync(join(tmpdir(),'aw-dshfmt-')));t.after(()=>rmSync(p,{recursive:true,force:true}));return p;}
function put(root,name,body){const p=join(root,name);mkdirSync(dirname(p),{recursive:true});writeFileSync(p,body);return p;}
const read=p=>existsSync(p)?readFileSync(p,'utf8'):null;
const V='0.2.2-rc.5';
// headless and web profiles with the hooks bridge and its peer, web starting from dsh's `[]` template.
function dshHome(root){
  for(const name of ['headless','web']){
    put(root,`.dsh/profiles/${name}/cordis.yml`,'[]\n');put(root,`.dsh/profiles/${name}/package.json`,'{}\n');
    put(root,`.dsh/profiles/${name}/cordis.patch.yml`,'# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n[]\n');
    put(root,`.dsh/profiles/${name}/node_modules/@deepseek-ai/dsh-hooks-claude-code/package.json`,JSON.stringify({name:'@deepseek-ai/dsh-hooks-claude-code',version:V,peerDependencies:{'@deepseek-ai/dsh-hook-protocol':V}}));
    put(root,`.dsh/profiles/${name}/node_modules/@deepseek-ai/dsh-hook-protocol/package.json`,JSON.stringify({name:'@deepseek-ai/dsh-hook-protocol',version:V}));
  }
  return {headless:join(root,'.dsh/profiles/headless/cordis.patch.yml'),web:join(root,'.dsh/profiles/web/cordis.patch.yml')};
}
// The file dsh 0.2.2-rc.5 wrote on the owner's Mac after `dsh --profile web` (23 Nov 2026): our rows
// with every `!!js` scalar folded at 80 columns, and dsh's own ui-settings-general row appended
// inside the markers. Only the hooks.json path is replaced.
const rewritten=root=>readFileSync(join(PACKAGE,'tests/fixtures/dsh-web-rewritten.cordis.patch.yml'),'utf8').replace('__HOOKS_JSON__',join(locations(root).store,'dsh/hooks.json'));
const UI='- id: ui-settings-general\n  name: "@deepseek-ai/dsh-client-ui-settings-general"\n  config:\n    welcomeNoticeVersion: 2026-09-28.1';

test('dsh rows are written as `!!js |-` literal blocks, so an 80-column re-serialization leaves them alone',t=>{
  const root=fixture(t),p=dshHome(root);install({userRoot:root,clients:['dsh']});
  const text=read(p.web);
  assert.doesNotMatch(text,/!!js "/);assert.match(text,/ {6}disabled: !!js \|-\n {8}!\(\(n\)=>/);
  // Every line longer than 80 columns is the content of a literal block (`|-` on the line before).
  const lines=blockContent(text,'yaml').split('\n');
  lines.forEach((line,i)=>{if(line.length>80)assert.match(lines[i-1],/\|-$/,line);});
  // The rewritten file and ours hold the same rows.
  assert.equal(dshBlockData(blockContent(rewritten(root),'yaml')).dataHash,dshBlockData(blockContent(text,'yaml')).dataHash);
});

test('a block dsh re-serialized (folded scalars, its own row appended inside) is adopted: verify ok, sync moves the row out',t=>{
  const root=fixture(t),p=dshHome(root),l=locations(root);install({userRoot:root,clients:['dsh']});
  writeFileSync(p.web,rewritten(root));
  const v=verify({userRoot:root});
  assert.equal(v.ok,true,JSON.stringify(v.issues.concat(v.outdated)));assert.equal(v.status,'ok');
  assert(v.notices.some(n=>/re-serialized .*web\/cordis\.patch\.yml.*rows are unchanged/.test(n)));
  // Records written by 0.6.1/0.7.0 have no dataHash: the rows this version writes are the reference.
  const state=join(l.store,'installation.json'),m=json(read(state));
  for(const f of m.files)delete f.dataHash;writeFileSync(state,JSON.stringify(m));
  assert.equal(verify({userRoot:root}).ok,true);
  const dry=install({userRoot:root,clients:['dsh'],dryRun:true});
  assert.match(dry.changes.find(c=>c.path===p.web).note,/moved right after it/);
  const r=install({userRoot:root,clients:['dsh']});
  assert.equal(r.ok,undefined);assert.equal(r.skipped,undefined);
  const after=read(p.web);
  assert.equal(after,read(p.headless).replace(/\n\[\]\n$/,'\n')+UI+'\n','canonical block, then the dsh row; header kept');
  assert.equal(blockContent(after,'yaml'),blockContent(read(p.headless),'yaml'));
  assert.equal(verify({userRoot:root}).ok,true);assert.equal(verify({userRoot:root}).notices,undefined);
  assert.equal(install({userRoot:root,clients:['dsh']}).changedFiles,0);
  uninstall({userRoot:root});
  assert.equal(read(p.web),'# Your patch layer for this dsh profile, applied after every bundle layer:\n# a top-level YAML array of loader patch entries (id-targeted config\n# overrides, disables, and insert lists; `!!js` expressions allowed).\n'+UI+'\n','the dsh row survives uninstall');
});

test('uninstall straight from the re-serialized file keeps the dsh row where the block was',t=>{
  const root=fixture(t),p=dshHome(root);install({userRoot:root,clients:['dsh']});
  writeFileSync(p.web,rewritten(root));
  uninstall({userRoot:root});
  const text=read(p.web);
  assert(!text.includes('agent-workflow'));assert(text.includes(UI));assert.match(text,/^# Your patch layer/);
});

test('a real change inside the block is drift; the sync skips only that file and syncs the rest',t=>{
  const root=fixture(t),p=dshHome(root),l=locations(root);install({userRoot:root,clients:['dsh','claude']});
  const edited=rewritten(root).replace('serverName: aw-serena','serverName: mine');writeFileSync(p.web,edited);
  assert.deepEqual(verify({userRoot:root}).issues.map(i=>i.issue),['managed-block-drift']);
  const gate=join(l.store,'runtime/gate.mjs');unlinkSync(gate);
  const r=install({userRoot:root,clients:['dsh','claude']});
  assert.equal(r.ok,false);assert.deepEqual(r.skipped.map(s=>s.path),[p.web]);
  assert.match(r.skipped[0].fix,/agent-workflow:begin.*agent-workflow sync --global again\. The other files were synced/s);
  assert.equal(read(p.web),edited,'never overwritten');
  assert(existsSync(gate),'the other files were still synced');
  assert.equal(json(read(join(l.store,'installation.json'))).files.filter(f=>f.path===p.web).length,1,'its entry is kept');
  assert.throws(()=>uninstall({userRoot:root}),/Edited managed block/);
});
