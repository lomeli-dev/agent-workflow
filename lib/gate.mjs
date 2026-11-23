import {existsSync,readFileSync,realpathSync,statSync,lstatSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {validationGuard} from './validation-guard.mjs';

export function projectRoot(cwd) {
  const start=realpathSync(resolve(cwd));
  if(!statSync(start).isDirectory())throw Error('Project must be a directory');
  for(let p=start;;p=dirname(p)){
    if(existsSync(join(p,'.git')))return p;
    if(dirname(p)===p)return start;
  }
}

// Shared Git directory of a checkout: <root>/.git for a main checkout, or the commondir that a
// linked worktree's `.git` file points to. Reads two small files; never runs git.
export function gitCommonDir(root){
  const dotgit=join(root,'.git');let metadata;try{metadata=lstatSync(dotgit);}catch{return null;}
  try{
    if(metadata.isDirectory())return realpathSync(dotgit);
    if(!metadata.isFile()||metadata.size>4096)return null;
    const m=/^gitdir:\s*(.+)$/m.exec(readFileSync(dotgit,'utf8'));if(!m)return null;
    const gitdir=resolve(root,m[1].trim());let common=gitdir;
    try{common=resolve(gitdir,readFileSync(join(gitdir,'commondir'),'utf8').trim());}catch{}
    return realpathSync(common);
  }catch{return null;}
}

// A project MCP registration stores one absolute root. When the client starts it from another
// worktree of the same repository (a copied or committed .mcp.json), serve that worktree instead
// of indexing the registered checkout. Unrelated directories keep the registered root.
export function mcpProject(project,cwd=process.cwd()){
  const root=projectRoot(project);let here;try{here=projectRoot(cwd);}catch{return {project:root};}
  if(here===root)return {project:root};
  const a=gitCommonDir(root),b=gitCommonDir(here);
  return a&&a===b?{project:here,registered:root}:{project:root};
}

export function status(cwd=process.cwd()) {
  const start=realpathSync(resolve(cwd)),root=projectRoot(start);
  // Standalone folders can inherit a nearest ancestor switch; repositories stop at their root.
  const stop=existsSync(join(root,'.git'))?root:null;
  for(let p=start;;p=dirname(p)){
    const file=join(p,'.agent-workflow.json');
    let metadata;try{metadata=lstatSync(file);}catch(e){if(e.code!=='ENOENT')return {enabled:false,source:file,project:root,reason:'invalid-project-config'};}
    if(metadata){
      try {
        if(!metadata.isFile())throw Error('Project config must be a regular file');
        if(metadata.size>16384)throw Error('Project config exceeds 16 KiB');
        const c=JSON.parse(readFileSync(file,'utf8'));
        if(c.schemaVersion!==1 || typeof c.enabled!=='boolean' || Object.keys(c).some(k=>!['schemaVersion','enabled'].includes(k)))throw Error('Expected schemaVersion:1 and enabled:boolean only');
        return {enabled:c.enabled,source:file,project:root,reason:c.enabled?'project-enabled':'project-disabled'};
      } catch {return {enabled:false,source:file,project:root,reason:'invalid-project-config'};}
    }
    if(p===stop || dirname(p)===p)break;
  }
  return {enabled:true,source:null,project:root,reason:'global-default'};
}

export function hookResult(input) {
  const cwd=input?.cwd;
  if(typeof cwd!=='string')return {};
  let state;try {state=status(cwd);}catch{return {};}
  if(!state.enabled)return {};
  const event=input.hook_event_name;
  const messages={
    SessionStart:'Agent Workflow is enabled here. Use the short global workflow rules; for substantial coding tasks load aw-workflow. Follow project rules and existing role/model choices. No automatic installs or worker launches.',
    SubagentStart:'Agent Workflow: follow your assigned files, contracts and focused checks. Do not write shared .memory or the roadmap. Return evidence, Decisions, Discoveries and candidate Lessons to the coordinator.',
    PreCompact:'Before context is reduced, the coordinator should preserve the current task, candidate, checks, unresolved effects and live-resource identities in the existing authorized project memory. Workers report to the coordinator; do not create another memory writer.',
  };
  if(!messages[event])return {};
  if(event==='PreCompact')return {systemMessage:messages[event]};
  return {hookSpecificOutput:{hookEventName:event,additionalContext:messages[event]}};
}

// Validation guard for one shell command about to run in cwd: the AW_VALIDATION_COMPOUND reason
// when it must be blocked, otherwise null. Opted-out projects, unreadable directories and
// non-string input are never blocked. Shared by every client hook and plugin.
export function shellGuard(command,cwd){
  if(typeof command!=='string'||typeof cwd!=='string')return null;
  try{if(!status(cwd).enabled)return null;}catch{return null;}
  const decision=validationGuard(command,{cwd});
  return decision.blocked?decision.reason:null;
}

// Shell tool name each client sends in PreToolUse (Claude and Codex both use Bash; DeepSeek Harness
// sends its `bash` tool through the Claude Code hooks bridge, with a `workdir` argument).
const SHELL_TOOLS={claude:'Bash',codex:'Bash',kimi:'Bash',qwen:'run_shell_command',commandcode:'shell_command',dsh:'bash'};
const shellQuote=s=>"'"+s.replaceAll("'","'\\''")+"'";
// PreToolUse answer: deny (Claude shape, which Codex, Qwen, Kimi and Command Code also read)
// or nothing. The working directory is the tool's own directory option when it has one.
export function guardHookResult(input,client='claude'){
  if(input?.tool_name!==SHELL_TOOLS[client])return {};
  const args=input.tool_input;if(!args||typeof args!=='object'||typeof args.command!=='string')return {};
  // Command Code may pass the arguments separately and joins them quoted.
  let command=args.command;
  if(Array.isArray(args.args)&&args.args.length){if(!args.args.every(a=>typeof a==='string'))return {};command+=' '+args.args.map(shellQuote).join(' ');}
  const base=typeof input.cwd==='string'&&input.cwd?input.cwd:process.cwd();
  const own=[args.directory,args.cwd,args.workdir].find(v=>typeof v==='string'&&v);
  const reason=shellGuard(command,own?resolve(base,own):base);
  return reason?{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:reason}}:{};
}

// Antigravity PreToolUse: toolCall {name: 'run_command', args: {CommandLine, Cwd}}, camelCase common
// fields (cwd, workspacePaths). The answer is {decision: 'deny', reason} or nothing.
export function agyGuardResult(input){
  const call=input?.toolCall;if(call?.name!=='run_command'||!call.args||typeof call.args!=='object')return {};
  const command=call.args.CommandLine;if(typeof command!=='string')return {};
  const roots=Array.isArray(input.workspacePaths)?input.workspacePaths:[];
  const base=[input.cwd,roots[0]].find(v=>typeof v==='string'&&v)??process.cwd();
  const own=typeof call.args.Cwd==='string'&&call.args.Cwd?resolve(base,call.args.Cwd):base;
  const reason=shellGuard(command,own);
  return reason?{decision:'deny',reason}:{};
}

// Hook output for clients other than Claude/Codex. Antigravity sends workspacePaths (its event
// name may be missing for SessionStart) and reads injectSteps; its PreToolUse carries toolCall.
// Claude-compatible clients (Qwen, Command Code, DeepSeek Harness through its Claude Code hooks
// bridge) get hookSpecificOutput.additionalContext, also for PreCompact (Qwen uses it as
// compaction instructions).
export function clientHookResult(input,client){
  if(client==='agy'&&input?.toolCall)return agyGuardResult(input);
  if((input?.hook_event_name??input?.hookEventName)==='PreToolUse')return guardHookResult(input,client??'claude');
  if(!client)return hookResult(input);
  const roots=Array.isArray(input?.workspacePaths)?input.workspacePaths:[];
  const cwd=typeof input?.cwd==='string'?input.cwd:roots.find(p=>typeof p==='string')??process.env.COMMANDCODE_PROJECT_DIR??process.cwd();
  const event=input?.hook_event_name??input?.hookEventName??(client==='agy'?'SessionStart':undefined);
  const base=hookResult({cwd,hook_event_name:event});
  const text=base.hookSpecificOutput?.additionalContext??base.systemMessage;
  if(!text)return {};
  if(client==='agy')return {injectSteps:[{systemMessage:{systemMessage:text}}]};
  return {hookSpecificOutput:{hookEventName:event,additionalContext:text}};
}
