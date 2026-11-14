import {status} from '../runtime/gate.mjs';
// OpenCode V2 object-style plugin. No model requests, installs, or memory writes.
export default {
  id:'agent-workflow',
  async setup(ctx){
    const cwd=ctx.location?.directory;
    if(typeof cwd!=='string')return;
    const enabled=()=>{try{return status(cwd).enabled;}catch{return false;}};
    if(!enabled())return;
    // Stored locally in the client's plugin storage, not uploaded telemetry.
    await ctx.storage.set('agent-workflow.loaded',{version:'0.2.0',projectGate:true});
    // Rules and skills are native files. Do not pretend this notification intercepts tools.
    return ()=>{};
  }
};
