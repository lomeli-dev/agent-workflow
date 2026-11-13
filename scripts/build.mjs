import {mkdtempSync,mkdirSync,cpSync,rmSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const stage=mkdtempSync(join(tmpdir(),'aw-build-'));
try {
  const r=spawnSync(join(root,'node_modules/.bin/rulesync'),['generate','--config',join(root,'rulesync.jsonc'),'--input-roots',join(root,'.rulesync'),'--output-roots',stage],{cwd:root,encoding:'utf8'});
  if(r.status!==0)throw Error(r.stderr||r.stdout||'Rulesync generation failed');
  const out=join(root,'generated');rmSync(out,{recursive:true,force:true});mkdirSync(out);
  cpSync(stage,out,{recursive:true});
  const files={};
  function walk(dir,rel=''){for(const e of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=join(dir,e.name),n=rel+e.name;if(e.isSymbolicLink())throw Error('unexpected generated symlink');if(e.isDirectory())walk(p,n+'/');else files[n]=createHash('sha256').update(readFileSync(p)).digest('hex');}}
  walk(out);writeFileSync(join(out,'manifest.json'),JSON.stringify({schemaVersion:1,rulesync:'43.8.0',files},null,2)+'\n');
  console.log(`Rulesync: ${Object.keys(files).length} generated files in isolated staging`);
} finally {rmSync(stage,{recursive:true,force:true});}
