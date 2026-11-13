import {readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parse as toml} from 'smol-toml';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');let files=0,links=0;
function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.git'].includes(e.name))continue;const p=join(dir,e.name);if(e.isDirectory()){walk(p);continue;}if(!e.isFile())continue;files++;
 if(p.endsWith('.mjs')){const r=spawnSync(process.execPath,['--check',p],{encoding:'utf8'});if(r.status)throw Error(r.stderr);}
 if(p.endsWith('.toml'))toml(readFileSync(p,'utf8'));
 if(p.endsWith('.md'))for(const m of readFileSync(p,'utf8').matchAll(/\]\(([^)]+)\)/g)){
  const ref=m[1];if(/^(https?:|#)/.test(ref))continue;links++;const target=resolve(dirname(p),decodeURIComponent(ref.split('#')[0]));if(!target.startsWith(root+'/')||!existsSync(target))throw Error('Invalid local reference: '+p+' -> '+ref);
 }
}}
walk(root);console.log(`Package checks: ${files} files, ${links} local links, JS syntax and generated TOML valid`);
