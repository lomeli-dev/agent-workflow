#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {status,projectRoot} from '../lib/gate.mjs';
import {atomic,noSymlinks,read} from '../lib/files.mjs';
import {install,uninstall,verify,CLIENTS} from '../lib/install.mjs';
import {doctor} from '../lib/doctor.mjs';
import {CATALOG,PROFILES} from '../lib/catalog.mjs';
import {setupModules,findBin,toolEnvironment} from '../lib/modules.mjs';
import {selectInteractive} from '../lib/selector.mjs';
import {serveMcp,MCP_TOOLS} from '../lib/mcp-launch.mjs';
import {spawnSync} from 'node:child_process';
import {locations,PACKAGE} from '../lib/install.mjs';
import {connect} from '../lib/connect.mjs';

const HELP=`Agent Workflow 0.2.0 — global by default, project opt-out

agent-workflow install --global [--clients claude,codex,opencode] [--dry-run]
agent-workflow sync --global [--clients claude,codex,opencode] [--dry-run]
agent-workflow verify [--json]
agent-workflow doctor [--json]
agent-workflow status [--project PATH] [--json]
agent-workflow disable --project PATH [--dry-run]
agent-workflow enable --project PATH [--dry-run]
agent-workflow setup --interactive
agent-workflow setup --list
agent-workflow setup --tools serena,codegraph,playwright-cli [--apply]
agent-workflow setup --profile lsp|code|web|docs|delivery [--apply]
agent-workflow setup --all [--apply]
agent-workflow exec --tool MODULE -- [tool arguments]
agent-workflow mcp-config --project PATH [--tools serena,codegraph]
agent-workflow connect --project PATH [--tools serena,codegraph] [--clients claude,codex,opencode] [--dry-run]
agent-workflow disconnect --project PATH [--clients claude,codex,opencode] [--dry-run]
agent-workflow mcp --tool MODULE --project PATH
agent-workflow uninstall --global [--dry-run]

--user-root PATH redirects every managed destination to an existing isolated
user-root (for tests/previews). It never changes HOME. Hook trust is native to
the client; this tool does not bypass it. No startup dependency installs.
Project opt-out disables workflow behavior, not global file discovery.
`;
try{
  const {values,positionals}=parseArgs({allowPositionals:true,options:{global:{type:'boolean'},clients:{type:'string'},'user-root':{type:'string'},project:{type:'string'},'dry-run':{type:'boolean'},json:{type:'boolean'},tool:{type:'string'},tools:{type:'string'},profile:{type:'string'},all:{type:'boolean'},list:{type:'boolean'},interactive:{type:'boolean'},apply:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'}}});
  const cmd=positionals[0];if(values.version){console.log('0.2.0');process.exit(0);}if(values.help||!cmd){console.log(HELP);process.exit(0);}
  if(positionals.length>1&&cmd!=='exec')throw Error('Unexpected positional arguments');
  const userRoot=values['user-root'],dryRun=values['dry-run']??false;let result;
  if(values.apply&&dryRun)throw Error('--apply and --dry-run cannot be combined');
  if(['install','sync','uninstall'].includes(cmd)&&!values.global)throw Error('Pass --global explicitly (or preview with --global --dry-run)');
  if(cmd==='install'||cmd==='sync')result=install({userRoot,dryRun,clients:values.clients?values.clients.split(','):CLIENTS});
  else if(cmd==='uninstall')result=uninstall({userRoot,dryRun});
  else if(cmd==='verify'){result=verify({userRoot});if(!result.ok)process.exitCode=1;}
  else if(cmd==='doctor')result=await doctor({userRoot});
  else if(cmd==='setup'){
    if(values.list)result={modules:CATALOG,profiles:PROFILES,excluded:['linters','formatters','persistent-task-services']};
    else {
      let tools=values.interactive?await selectInteractive():values.tools?values.tools.split(','):values.tool?[values.tool]:[];
      if(values.interactive&&!tools.length){console.log('Cancelled; nothing installed');process.exit(0);}
      result=await setupModules({userRoot,tools,profile:values.profile,all:values.all,apply:values.apply,onProgress:id=>console.error('Checking/installing '+id)});
      if(result.ok===false)process.exitCode=1;
    }
  }
  else if(cmd==='exec'){
    const spec=CATALOG[values.tool];if(!spec)throw Error('Unknown module');const loc=locations(userRoot),path=findBin(spec.bin,loc);if(!path)throw Error('Module not installed');
    const p=spawnSync(path,positionals.slice(1),{env:toolEnvironment(loc),cwd:values.project??process.cwd(),stdio:'inherit'});process.exit(p.status??1);
  }
  else if(cmd==='mcp'){await serveMcp({tool:values.tool,project:values.project,userRoot});process.exit(process.exitCode??0);}
  else if(cmd==='connect'||cmd==='disconnect')result=connect({project:values.project,userRoot,dryRun,remove:cmd==='disconnect',tools:values.tools?values.tools.split(','):MCP_TOOLS,clients:values.clients?values.clients.split(','):CLIENTS});
  else if(cmd==='mcp-config'){
    if(!values.project)throw Error('Specify --project');const project=projectRoot(values.project),ids=values.tools?values.tools.split(','):MCP_TOOLS;
    const entries={};for(const id of ids){if(!MCP_TOOLS.includes(id))throw Error('Not an MCP module: '+id);entries['aw-'+id]={command:process.execPath,args:[join(PACKAGE,'bin/agent-workflow.mjs'),'mcp','--tool',id,'--project',project,...(userRoot?['--user-root',resolve(userRoot)]:[])]};}
    result={project,claude:{mcpServers:entries},codex:{mcp_servers:entries},opencode:{mcp:{servers:Object.fromEntries(Object.entries(entries).map(([id,c])=>[id,{type:'local',command:[c.command,...c.args]}]))}},note:'Configuration preview only; merge with your existing client config. MCP startup is gated by project opt-out. No credentials included.'};
  }
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
