#!/usr/bin/env node
import {readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {status,projectRoot} from '../lib/gate.mjs';
import {atomic,noSymlinks,read} from '../lib/files.mjs';
import {install,uninstall,verify,CLIENTS,ALL_CLIENTS,parseClients,parseGuard} from '../lib/install.mjs';
import {doctor} from '../lib/doctor.mjs';
import {trustCodex,installAndTrust} from '../lib/codex-trust.mjs';
import {CATALOG,PROFILES} from '../lib/catalog.mjs';
import {setupModules,findBin,toolEnvironment} from '../lib/modules.mjs';
import {selectInteractive} from '../lib/selector.mjs';
import {serveMcp,MCP_TOOLS,DEFAULT_MCP_TOOLS} from '../lib/mcp-launch.mjs';
import {spawnSync} from 'node:child_process';
import {locations,PACKAGE,VERSION} from '../lib/install.mjs';
import {findSymbols} from '../lib/symbols.mjs';
import {connect,connectionRoot,pruneConnections} from '../lib/connect.mjs';

const HELP=`Agent Workflow ${VERSION} — global by default, project opt-out

agent-workflow install --global [--clients LIST|all] [--guard claude,codex|none] [--trust-codex] [--dry-run]
agent-workflow sync --global [--clients LIST|all] [--guard claude,codex|none] [--trust-codex] [--dry-run]
agent-workflow trust --client codex [--dry-run]
agent-workflow verify [--json]
agent-workflow doctor [--json]
agent-workflow status [--project PATH] [--json]
agent-workflow disable --project PATH [--dry-run]
agent-workflow enable --project PATH [--dry-run]
agent-workflow setup --interactive
agent-workflow setup --list
agent-workflow setup --tools serena,codegraph,agent-browser [--apply]
agent-workflow setup --profile lsp|code|web|docs|delivery [--apply]
agent-workflow setup --all [--apply]
agent-workflow exec --tool MODULE -- [tool arguments]
agent-workflow claude-lean [--mcp-file PATH] -- [Claude arguments]
agent-workflow symbols --project PATH --file relative/module.mjs [--name SYMBOL]
agent-workflow mcp-config --project PATH [--tools serena,codegraph]
agent-workflow connect --project PATH [--tools serena,codegraph] [--clients claude,codex,opencode] [--dry-run]
agent-workflow disconnect --project PATH [--clients claude,codex,opencode] [--dry-run]
agent-workflow disconnect --prune [--dry-run]   (forget receipts whose project no longer exists)
agent-workflow mcp --tool MODULE --project PATH
agent-workflow uninstall --global [--dry-run]

--clients defaults to claude,codex,opencode. Extra clients: qwen, kimi, agy,
commandcode, pi, mimo, dsh (DeepSeek Harness); 'all' selects every client. A sync can
add clients to an installation; dropping one needs uninstall first.

The validation guard (PreToolUse/tool hook that denies a test or build command
whose exit status a pipe, ';' or echo would hide) is installed for qwen, kimi,
agy, commandcode, pi, mimo and dsh (OpenCode has it in its plugin). For claude
and codex it is chosen with --guard: claude: on by default; codex: on by default
only with --trust-codex (it needs approval). --guard claude,codex|none sets the
choice explicitly; without --guard a sync keeps the recorded choice. Opted-out
projects are never blocked.

dsh hooks run through the @deepseek-ai/dsh-hooks-claude-code bridge of each
profile; profiles without it get a notice with the dsh plugin add command.

Codex runs a hook only after it is trusted (/hooks). trust --client codex does
the same as approving in /hooks, through codex app-server, for the Agent
Workflow hooks only (shim + store runtime command); other hooks and their trust
are never touched. --trust-codex runs it right after install/sync writes
hooks.json (opt-in). verify/doctor read the trust state from codex app-server
when Codex is available, else from config.toml (AGENT_WORKFLOW_CODEX=PATH|none).

--user-root PATH redirects every managed destination to an existing isolated
user-root (for tests/previews). It never changes HOME; a codex app-server it
starts gets HOME and CODEX_HOME pointed at that user-root. Hook trust is native
to the client; this tool never bypasses it (no --dangerously-bypass-hook-trust).
No startup dependency installs.
Project opt-out disables workflow behavior, not global file discovery.
claude-lean is opt-in: without --mcp-file, no MCP servers are available in
that Claude session. It does not alter your normal Claude configuration.
`;
try{
  const {values,positionals}=parseArgs({allowPositionals:true,options:{global:{type:'boolean'},clients:{type:'string'},guard:{type:'string'},client:{type:'string'},'trust-codex':{type:'boolean'},'user-root':{type:'string'},project:{type:'string'},'dry-run':{type:'boolean'},json:{type:'boolean'},tool:{type:'string'},file:{type:'string'},name:{type:'string'},tools:{type:'string'},profile:{type:'string'},'mcp-file':{type:'string'},all:{type:'boolean'},list:{type:'boolean'},interactive:{type:'boolean'},prune:{type:'boolean'},apply:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'}}});
  const cmd=positionals[0];if(values.version){console.log(VERSION);process.exit(0);}if(values.help||!cmd){console.log(HELP);process.exit(0);}
  if(positionals.length>1&&cmd!=='exec'&&cmd!=='claude-lean')throw Error('Unexpected positional arguments');
  const userRoot=values['user-root'],dryRun=values['dry-run']??false;let result;
  if(values.apply&&dryRun)throw Error('--apply and --dry-run cannot be combined');
  if(['install','sync','uninstall'].includes(cmd)&&!values.global)throw Error('Pass --global explicitly (or preview with --global --dry-run)');
  if(values['trust-codex']&&cmd!=='install'&&cmd!=='sync')throw Error('--trust-codex is only for install/sync');
  if(cmd==='install'||cmd==='sync'){result=await installAndTrust({userRoot,dryRun,clients:parseClients(values.clients),guard:parseGuard(values.guard),trustCodex:values['trust-codex']??false});if(result.ok===false)process.exitCode=1;}
  else if(cmd==='trust'){if(values.client!=='codex')throw Error('Use trust --client codex (the only client with hook trust handled here)');result=await trustCodex({userRoot,dryRun});if(result.ok===false)process.exitCode=1;}
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
  else if(cmd==='symbols')result=findSymbols({project:values.project,file:values.file,name:values.name,userRoot});
  else if(cmd==='claude-lean'){
    const args=positionals.slice(1);
    if(args.some(a=>a==='--'||a==='--strict-mcp-config'||a==='--mcp-config'||a.startsWith('--mcp-config=')))throw Error('Use --mcp-file before -- to choose the MCP configuration');
    const mcp=values['mcp-file']?resolve(values['mcp-file']):'{"mcpServers":{}}';
    if(values['mcp-file']&&!existsSync(mcp))throw Error('MCP configuration file not found');
    console.error(values['mcp-file']?'Claude lean: only the explicitly selected MCP configuration is available.':'Claude lean: MCP servers are disabled for this session.');
    const p=spawnSync('claude',[...args,'--strict-mcp-config','--mcp-config',mcp],{stdio:'inherit'});
    if(p.error)throw Error('Could not start Claude Code: '+p.error.message);
    process.exit(p.status??1);
  }
  else if(cmd==='exec'){
    const spec=Object.hasOwn(CATALOG,values.tool)?CATALOG[values.tool]:null;if(!spec)throw Error('Unknown module');const loc=locations(userRoot),path=findBin(spec.bin,loc);if(!path)throw Error('Module not installed');
    const p=spawnSync(path,positionals.slice(1),{env:toolEnvironment(loc),cwd:values.project??process.cwd(),stdio:'inherit'});process.exit(p.status??1);
  }
  else if(cmd==='mcp'){await serveMcp({tool:values.tool,project:values.project,userRoot});process.exit(process.exitCode??0);}
  else if(cmd==='disconnect'&&values.prune){if(values.project||values.clients)throw Error('--prune works on every receipt; do not combine it with --project or --clients');result=pruneConnections({userRoot,dryRun});}
  else if(cmd==='connect'||cmd==='disconnect')result=connect({project:values.project,userRoot,dryRun,remove:cmd==='disconnect',tools:values.tools?values.tools.split(','):DEFAULT_MCP_TOOLS,clients:values.clients?values.clients.split(','):CLIENTS});
  else if(cmd==='mcp-config'){
    if(!values.project)throw Error('Specify --project');const project=connectionRoot(values.project),ids=values.tools?values.tools.split(','):DEFAULT_MCP_TOOLS;
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
