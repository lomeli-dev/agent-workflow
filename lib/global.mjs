// install/sync/uninstall --global with the opt-in steps of 0.7.0 around the file installer:
// --dsh-plugins (hook packages in dsh profiles, before the files so the profile block mounts the
// hooks row), --agy-allow (owned permissions.allow entries, handled by install itself) and
// --trust-codex. --all-in turns on each one whose client is in --clients.
import {install,uninstall,locations,json} from './install.mjs';
import {read} from './files.mjs';
import {join} from 'node:path';
import {installAndTrust} from './codex-trust.mjs';
import {planDshPlugins,addDshPlugins,planDshRemoval,removeDshPlugins} from './dsh-plugins.mjs';

export function allInOptions({clients,allIn=false,trustCodex=false,dshPlugins=false,agyAllow=false}){
  return {trustCodex:trustCodex||allIn&&clients.includes('codex'),dshPlugins:dshPlugins||allIn&&clients.includes('dsh'),agyAllow:agyAllow||allIn&&clients.includes('agy')};
}
const summary=({bin,...plan})=>plan;

export async function globalInstall(options){
  const {dshPlugins,...rest}=options;
  if(options.trustCodex&&!options.clients?.includes('codex'))throw Error('--trust-codex needs codex in --clients');
  if(dshPlugins&&!options.clients?.includes('dsh'))throw Error('--dsh-plugins needs dsh in --clients');
  const loc=locations(options.userRoot);
  // Fail before any change when the file side would refuse (edited files, client set changes).
  if(!options.dryRun)install({...rest,dryRun:true});
  const plan=dshPlugins?planDshPlugins(loc,options.userRoot):null;
  if(options.dryRun){
    const r=await installAndTrust(rest);
    return plan?{...r,dshPlugins:{...summary(plan),...(plan.planned.length?{after:'Once added, the profile block also mounts the hooks row (not shown in changes above)'}:{})}}:r;
  }
  if(plan?.error)throw Error(plan.error);
  const added=plan?.planned.length?addDshPlugins(plan,loc,options.userRoot):[];
  try{
    const r=await installAndTrust({...rest,dshPluginRecords:added});
    return plan?{...r,dshPlugins:{...summary(plan),added}}:r;
  }catch(e){removeDshPlugins(added,loc,options.userRoot,plan?.bin);throw e;}
}

export function globalUninstall({userRoot,dryRun=false}={}){
  const loc=locations(userRoot),raw=read(join(loc.store,'installation.json'));
  const records=raw?(json(raw).dshPlugins??[]):[];
  const preview=uninstall({userRoot,dryRun:true});
  const removal=planDshRemoval(records,loc);
  if(dryRun)return removal.length?{...preview,dshPlugins:{remove:removal}}:preview;
  if(preview.uninstalled===false)return preview;
  // Packages first: if dsh refuses, nothing else has changed yet and the manifest still lists them.
  const dsh=removal.length?removeDshPlugins(records,loc,userRoot):null;
  if(dsh?.errors.length)return {uninstalled:false,ok:false,dshPlugins:dsh,reason:'Could not remove the dsh packages added by --dsh-plugins; nothing else was changed. Fix the error (or run the commands by hand) and run uninstall again.'};
  const r=uninstall({userRoot});
  return dsh?{...r,dshPlugins:dsh}:r;
}
