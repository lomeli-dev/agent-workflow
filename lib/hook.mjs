import {hookResult} from './gate.mjs';
// Never inspect transcripts, run project code, install dependencies, or log prompts.
let data='';
const timeout=setTimeout(()=>process.exit(0),1500);
try {
  for await(const chunk of process.stdin){data+=chunk;if(data.length>262144){clearTimeout(timeout);process.exit(0);}}
  const result=hookResult(JSON.parse(data));
  if(Object.keys(result).length)process.stdout.write(JSON.stringify(result)+'\n');
} catch {/* Advisory hook: malformed input leaves the task running. */}
clearTimeout(timeout);
