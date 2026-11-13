import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo=resolve(dirname(fileURLToPath(import.meta.url)),'..'),root=mkdtempSync(join(tmpdir(),'aw-packed-'));
function run(command,args,cwd=repo){const r=spawnSync(command,args,{cwd,encoding:'utf8',timeout:120000,maxBuffer:2e6});if(r.status!==0)throw Error(`${command} failed: ${r.stderr.slice(-1500)}`);return r.stdout;}
try{
 const pack=JSON.parse(run('npm',['pack','--json','--pack-destination',root]));
 const prefix=join(root,'package'),home=join(root,'user'),project=join(root,'project');mkdirSync(home);mkdirSync(project);
 run('npm',['install','--prefix',prefix,join(root,pack[0].filename),'--ignore-scripts','--no-audit','--no-fund']);
 const cli=join(prefix,'node_modules/@lomeli-dev/agent-workflow/bin/agent-workflow.mjs');
 const command=(...args)=>JSON.parse(run(process.execPath,[cli,...args]));
 const installed=command('install','--global','--user-root',home);assert(installed.installed);
 assert(command('verify','--user-root',home).ok);
 assert.equal(command('install','--global','--user-root',home).changedFiles,0);
 command('disable','--project',project);assert.equal(command('status','--project',project).enabled,false);
 const hook=join(home,'.local/share/agent-workflow/runtime/hook.mjs');
 function invoke(){const r=spawnSync(process.execPath,[hook],{input:JSON.stringify({cwd:project,hook_event_name:'SessionStart'}),encoding:'utf8',timeout:3000});assert.equal(r.status,0);return r.stdout;}
 assert.equal(invoke(),'');command('enable','--project',project);assert(invoke().includes('additionalContext'));
 assert(command('uninstall','--global','--user-root',home).uninstalled);
 console.log('Packed npm artifact: install, verify, idempotence, project opt-out, real hook subprocess and uninstall passed');
}finally{rmSync(root,{recursive:true,force:true});}
