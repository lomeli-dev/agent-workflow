import {status,shellGuard} from '../runtime/gate.mjs';
// V2 plugin: no execution at startup; guard only recognized compound validations.
export default {
 id:'agent-workflow',
 async setup(ctx){
  const cwd=ctx.location?.directory;
  if(typeof cwd!=='string')return;
  const enabled=()=>{try{return status(cwd).enabled;}catch{return false;}};
  let registration;
  if(ctx.shell?.hook)registration=await ctx.shell.hook('create.before',event=>{
   const reason=shellGuard(event.command,event.cwd??cwd);
   if(reason)throw Error(reason);
  });
  if(enabled())await ctx.storage.set('agent-workflow.loaded',{version:'0.6.1',projectGate:true,validationGuard:!!registration});
  return async()=>{await registration?.dispose?.();};
 }
};
