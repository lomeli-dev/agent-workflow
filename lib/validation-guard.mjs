// A workflow guard for recognizable test/build commands, not a shell security parser.
// It never executes or logs the command. Ambiguous commands are not rewritten.
function commands(text){
 const segments=[[]];let word='',quote=null,escape=false,compound=false,background=false;
 const flush=()=>{if(word){segments.at(-1).push(word);word='';}};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(escape){word+=c;escape=false;continue;}
  if(c==='\\'&&quote!=="'"){escape=true;continue;}
  if(quote){if(c===quote)quote=null;else word+=c;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='#'&&!word){while(i<text.length&&text[i]!=='\n')i++;if(i===text.length)break;flush();if(segments.at(-1).length)segments.push([]);compound=true;continue;}
  if(c==='&'&&/[<>]$/.test(word)){word+=c;continue;}
  if(';|&()\n'.includes(c)){if(c==='&'&&text[i-1]!=='&'&&text[i+1]!=='&')background=true;flush();if(segments.at(-1).length)segments.push([]);compound=true;continue;}
  if(/\s/.test(c)){flush();continue;}
  word+=c;
 }
 flush();const nonempty=segments.filter(s=>s.length);return {segments:nonempty,compound:background||(compound&&nonempty.length>1),ambiguous:quote!==null||escape};
}
function validation(words){
 const tokens=[...words];while(tokens[0]==='env'||/^[A-Za-z_][A-Za-z_0-9]*=/.test(tokens[0]??''))tokens.shift();
 const executable=(tokens.shift()??'').split('/').at(-1);
 if(['npm','pnpm','yarn','bun'].includes(executable)){
  while(tokens[0]?.startsWith('-')){const option=tokens.shift();if(['--prefix','--cwd','--dir','-C','--filter'].includes(option))tokens.shift();}
  if(['run','run-script'].includes(tokens[0]))tokens.shift();
  return /^(test|check|build|typecheck|type-check|verify|validate)(:.*)?$/.test(tokens[0]??'');
 }
 if(executable==='node')return tokens.includes('--test');
 if(['pytest','py.test','jest','vitest','ctest'].includes(executable))return true;
 if(['cargo','go','dotnet','make'].includes(executable))return ['test','check','build','verify'].includes(tokens[0]);
 if(['python','python3'].includes(executable))return tokens[0]==='-m'&&['pytest','unittest'].includes(tokens[1]);
 return false;
}
export function validationGuard(command){
 if(typeof command!=='string'||!command.trim())return {blocked:false};
 const parsed=commands(command.trim());
 const blocked=!parsed.ambiguous&&parsed.compound&&parsed.segments.some(validation);
 return {blocked,reason:blocked?'AW_VALIDATION_COMPOUND: Run the validation as one direct command, without pipes, semicolons, conditionals or following echo/reads. Use the tool working-directory option instead of cd chains. Inspect the original exit status. Nothing was executed.':null};
}
