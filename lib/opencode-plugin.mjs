import {status} from '../runtime/gate.mjs';
import {validationGuard} from '../runtime/validation-guard.mjs';
// V2 plugin: no execution at startup; guard only recognized compound validations.
export default {
 id:'agent-workflow',
 async setup(ctx){
  const cwd=ctx.location?.directory;
  if(typeof cwd!=='string')return;
  const enabled=directory=>{try{return status(directory??cwd).enabled;}catch{return false;}};
  let registration;
  if(ctx.shell?.hook)registration=await ctx.shell.hook('create.before',event=>{
   if(!enabled(event.cwd))return;
   const decision=validationGuard(event.command,{cwd:event.cwd??cwd});
   if(decision.blocked)throw Error(decision.reason);
  });
  if(enabled())await ctx.storage.set('agent-workflow.loaded',{version:'0.4.0',projectGate:true,validationGuard:!!registration});
  return async()=>{await registration?.dispose?.();};
 }
};
