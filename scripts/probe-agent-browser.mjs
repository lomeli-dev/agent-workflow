// Opt-in local browser check: existing Chrome only, isolated session, no download.
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {locations} from '../lib/install.mjs';
import {findBin,run,toolEnvironment} from '../lib/modules.mjs';
const loc=locations(),bin=findBin('agent-browser',loc);
const chrome=process.env.AW_TEST_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if(!bin||!existsSync(chrome))throw Error('Install agent-browser and provide an existing browser via AW_TEST_CHROME; no download is attempted');
const root=mkdtempSync(join(tmpdir(),'aw-browser-test-')),config=join(root,'browser.json'),shot=join(root,'fixture.png'),session='aw-test-'+randomUUID();
writeFileSync(config,JSON.stringify({headed:false}));
const env=Object.fromEntries(Object.entries(toolEnvironment(loc)).filter(([key])=>!key.startsWith('AGENT_BROWSER_')));
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<title>AW browser fixture</title><h1>Ready</h1><button onclick="this.textContent=\'AW_CLICK_OK\'">Run fixture</button>');});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
async function call(args){const r=await run(bin,['--config',config,'--session',session,'--executable-path',chrome,...args],{cwd:root,env,timeout:30000});if(r.code!==0)throw Error(r.err||r.out);return r.out;}
try{
 const version=(await call(['--version'])).trim();
 await call(['open',`http://127.0.0.1:${server.address().port}`]);
 const snapshot=await call(['snapshot','-i']);
 if(!snapshot.includes('Run fixture'))throw Error('Fixture button not found');
 await call(['find','role','button','click','--name','Run fixture']);
 const after=await call(['snapshot','-i']);if(!after.includes('AW_CLICK_OK'))throw Error('Click effect missing');
 await call(['screenshot',shot]);if(readFileSync(shot).subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Screenshot missing PNG signature');
 console.log(JSON.stringify({tool:'agent-browser',version,existingBrowser:true,downloadedBrowser:false,headless:true,navigation:true,snapshot:true,click:true,screenshot:true}));
}finally{
 try{await call(['close']);}finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));rmSync(root,{recursive:true,force:true});}
}
