import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';

export function projectRoot(cwd) {
  const start=realpathSync(resolve(cwd));
  if(!statSync(start).isDirectory())throw Error('Project must be a directory');
  for(let p=start;;p=dirname(p)){
    if(existsSync(join(p,'.git')))return p;
    if(dirname(p)===p)return start;
  }
}

export function status(cwd=process.cwd()) {
  const start=realpathSync(resolve(cwd)),root=projectRoot(start);
  // Standalone folders can inherit a nearest ancestor switch; repositories stop at their root.
  const stop=existsSync(join(root,'.git'))?root:null;
  for(let p=start;;p=dirname(p)){
    const file=join(p,'.agent-workflow.json');
    if(existsSync(file)){
      try {
        if(statSync(file).size>16384)throw Error('Project config exceeds 16 KiB');
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
