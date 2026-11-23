import {clientHookResult} from './gate.mjs';
// Never inspect transcripts, run project code, install dependencies, or log prompts.
// `--client NAME` selects the input/output shape of clients other than Claude/Codex.
const args=process.argv.slice(2),at=args.indexOf('--client'),client=at>=0?args[at+1]:undefined;
let data='';
const timeout=setTimeout(()=>process.exit(0),1500);
try {
  for await(const chunk of process.stdin){data+=chunk;if(data.length>262144){clearTimeout(timeout);process.exit(0);}}
  const result=clientHookResult(JSON.parse(data),client);
  if(Object.keys(result).length)process.stdout.write(JSON.stringify(result)+'\n');
} catch {/* Advisory hook: malformed input leaves the task running. */}
clearTimeout(timeout);
