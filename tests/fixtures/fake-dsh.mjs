#!/usr/bin/env node
// Stand-in for the dsh CLI in tests: `dsh --version` and `dsh plugin --profile P add|remove -w ...`,
// writing packages into $DSH_HOME/profiles/P/node_modules the way pnpm leaves them. Every call is
// appended to $DSH_HOME/../dsh-calls.log. FAKE_DSH_FAIL=1 makes `add` fail after the first package.
import {mkdirSync,writeFileSync,rmSync,appendFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
const args=process.argv.slice(2),home=process.env.DSH_HOME,version=process.env.FAKE_DSH_VERSION??'0.2.2-rc.5';
if(!home){console.error('DSH_HOME not set');process.exit(2);}
appendFileSync(join(dirname(home),'dsh-calls.log'),JSON.stringify(args)+'\n');
if(args[0]==='--version'){console.log(version);process.exit(0);}
if(args[0]!=='plugin'||args[1]!=='--profile'||!['add','remove'].includes(args[3])||args[4]!=='-w'){console.error('unexpected: '+args.join(' '));process.exit(2);}
const dir=join(home,'profiles',args[2]),specs=args.slice(5);
for(const [i,spec] of specs.entries()){
  if(args[3]==='add'){
    if(process.env.FAKE_DSH_FAIL==='1'&&i>0){console.error('ERR_PNPM_FETCH_404');process.exit(1);}
    const at=spec.lastIndexOf('@'),name=spec.slice(0,at),v=spec.slice(at+1),p=join(dir,'node_modules',name,'package.json');
    mkdirSync(dirname(p),{recursive:true});
    writeFileSync(p,JSON.stringify({name,version:v,...(name.endsWith('dsh-hooks-claude-code')?{peerDependencies:{'@deepseek-ai/dsh-hook-protocol':v}}:{})}));
  } else rmSync(join(dir,'node_modules',spec),{recursive:true,force:true});
}
