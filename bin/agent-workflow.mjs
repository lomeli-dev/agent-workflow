#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {status,projectRoot} from '../lib/gate.mjs';
import {atomic,noSymlinks,read} from '../lib/files.mjs';
import {install,uninstall,verify,CLIENTS} from '../lib/install.mjs';
import {doctor,setup} from '../lib/doctor.mjs';

const HELP=`Agent Workflow 0.1.0 — global by default, project opt-out

agent-workflow install --global [--clients claude,codex,opencode] [--dry-run]
agent-workflow sync --global [--clients claude,codex,opencode] [--dry-run]
agent-workflow verify [--json]
agent-workflow doctor [--json]
agent-workflow status [--project PATH] [--json]
agent-workflow disable --project PATH [--dry-run]
agent-workflow enable --project PATH [--dry-run]
agent-workflow setup --tool gopls|typescript|python|ast-grep [--apply]
agent-workflow uninstall --global [--dry-run]

--user-root PATH redirects every managed destination to an existing isolated
user-root (for tests/previews). It never changes HOME. Hook trust is native to
the client; this tool does not bypass it. No startup dependency installs.
Project opt-out disables workflow behavior, not global file discovery.
`;
try{
  const {values,positionals}=parseArgs({allowPositionals:true,options:{global:{type:'boolean'},clients:{type:'string'},'user-root':{type:'string'},project:{type:'string'},'dry-run':{type:'boolean'},json:{type:'boolean'},tool:{type:'string'},apply:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'}}});
  const cmd=positionals[0];if(values.version){console.log('0.1.0');process.exit(0);}if(values.help||!cmd){console.log(HELP);process.exit(0);}
  if(positionals.length>1)throw Error('Unexpected positional arguments');
  const userRoot=values['user-root'],dryRun=values['dry-run']??false;let result;
  if(['install','sync','uninstall'].includes(cmd)&&!values.global)throw Error('Pass --global explicitly (or preview with --global --dry-run)');
  if(cmd==='install'||cmd==='sync')result=install({userRoot,dryRun,clients:values.clients?values.clients.split(','):CLIENTS});
  else if(cmd==='uninstall')result=uninstall({userRoot,dryRun});
  else if(cmd==='verify'){result=verify({userRoot});if(!result.ok)process.exitCode=1;}
  else if(cmd==='doctor')result=doctor({userRoot});
  else if(cmd==='setup')result=setup({userRoot,tool:values.tool,apply:values.apply});
  else if(cmd==='status')result=status(values.project??process.cwd());
  else if(cmd==='enable'||cmd==='disable'){
    if(!values.project)throw Error('An explicit --project PATH is required');
    const root=projectRoot(values.project),path=join(root,'.agent-workflow.json');noSymlinks(path);
    const original=read(path);
    if(original!==null){const c=JSON.parse(original);if(c.schemaVersion!==1||typeof c.enabled!=='boolean'||Object.keys(c).some(k=>!['schemaVersion','enabled'].includes(k)))throw Error('Unknown project config; refusing to replace it');}
    const enabled=cmd==='enable';if(!dryRun)atomic(path,JSON.stringify({schemaVersion:1,enabled},null,2)+'\n');
    result={enabled,project:root,file:path,dryRun,note:'Reload the session if its cached policy state predates this change. Global files remain discoverable.'};
  } else throw Error('Unknown command: '+cmd);
  console.log(JSON.stringify(result,null,2));
}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
