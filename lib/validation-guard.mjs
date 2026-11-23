// A workflow guard for recognizable test/build commands, not a shell security parser.
// It never executes or logs the command. Ambiguous commands are not rewritten.

// Splits a command line into commands and the operator that follows each one.
function parse(text){
 const commands=[{words:[],op:null}];let word='',quote=null,escape=false,background=false;
 const flush=()=>{if(word){commands.at(-1).words.push(word);word='';}};
 const end=op=>{flush();const last=commands.at(-1);if(last.words.length){last.op=op;commands.push({words:[],op:null});}else if(op==='&')background=true;};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(escape){word+=c;escape=false;continue;}
  if(c==='\\'&&quote!=="'"){escape=true;continue;}
  if(quote){if(c===quote)quote=null;else word+=c;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  if(c==='#'&&!word){while(i<text.length&&text[i]!=='\n')i++;end('\n');continue;}
  if(c==='&'&&(/[<>]$/.test(word)||text[i+1]==='>')){word+=c;continue;}
  if(c==='|'||c==='&'){const two=text[i+1]===c||(c==='|'&&text[i+1]==='&');const op=two?c+text[i+1]:c;if(two)i++;if(op==='&')background=true;end(op);continue;}
  if(';\n()'.includes(c)){end(c);continue;}
  if(/\s/.test(c)){flush();continue;}
  word+=c;
 }
 flush();const list=commands.filter(c=>c.words.length);
 // Group commands joined by | or |& into pipelines; other operators separate pipelines.
 const pipelines=[];let current=[];
 for(const c of list){current.push(c.words);if(c.op!=='|'&&c.op!=='|&'){pipelines.push({commands:current,op:c.op});current=[];}}
 if(current.length)pipelines.push({commands:current,op:null});
 return {pipelines,count:list.length,background,ambiguous:quote!==null||escape};
}

// Output redirections are not arguments: `npm test > log 2>&1` is still `npm test`.
const REDIRECT=/^(\d*|&)(>>?|<)(&?)(.*)$/;
function redirects(words){
 const args=[];let stdout=false;
 for(let i=0;i<words.length;i++){
  const m=REDIRECT.exec(words[i]);if(!m){args.push(words[i]);continue;}
  const target=m[4]||(m[3]?'':words[++i]??'');
  if(m[2]!=='<'&&(m[1]===''||m[1]==='1'||m[1]==='&')&&!m[3]&&target)stdout=true;
 }
 return {args,stdout};
}
const SHELLS=['bash','sh','zsh','dash','ksh'];
function shellScript(words){
 const tokens=[...words],exe=(tokens.shift()??'').split('/').at(-1);if(!SHELLS.includes(exe))return null;
 const i=tokens.findIndex(t=>/^-[a-z]*c[a-z]*$/.test(t));return i>=0&&typeof tokens[i+1]==='string'?tokens[i+1]:null;
}
const RUNNERS=['pytest','py.test','jest','vitest','ctest','mocha','ava','tap','playwright'];
const TARGET=/^(test|check|build|verify|validate|typecheck|type-check)([-_:].*)?$/;
function skipOptions(tokens,withValue){
 while(tokens[0]?.startsWith('-')){const option=tokens.shift();if(option==='--')break;if(withValue.includes(option))tokens.shift();}
 return tokens;
}
// Arguments without redirections or leading `env`/VAR=value assignments.
function plain(words){
 const tokens=redirects(words).args;while(tokens[0]==='env'||/^[A-Za-z_][A-Za-z_0-9]*=/.test(tokens[0]??''))tokens.shift();
 return tokens;
}
function validation(words){
 const tokens=plain(words);
 const script=shellScript(tokens);if(script!==null)return parse(script).pipelines.some(p=>p.commands.some(validation));
 const executable=(tokens.shift()??'').split('/').at(-1);
 if(['npx','bunx','pnpx'].includes(executable))return validation(skipOptions(tokens,['-p','--package','-c','--call']));
 if(['npm','pnpm','yarn','bun'].includes(executable)){
  skipOptions(tokens,['--prefix','--cwd','--dir','-C','--filter','-w','--workspace']);
  if(['exec','dlx','x'].includes(tokens[0])){tokens.shift();return validation(skipOptions(tokens,['-p','--package','-c','--call']));}
  if(RUNNERS.includes(tokens[0]))return true;
  if(['run','run-script'].includes(tokens[0]))tokens.shift();
  return TARGET.test(tokens[0]??'');
 }
 if(executable==='uv'&&tokens[0]==='run'){tokens.shift();return validation(skipOptions(tokens,['--with','--project','--directory','--python','-p','--group','--extra','--package','--env-file','--with-requirements']));}
 if(['poetry','pipenv','hatch'].includes(executable)&&tokens[0]==='run'){tokens.shift();return validation(tokens);}
 if(executable==='node')return tokens.includes('--test');
 if(RUNNERS.includes(executable))return true;
 if(['gradle','gradlew'].includes(executable))return tokens.filter(t=>!t.startsWith('-')).some(t=>/(^|:)(test\w*|check|build)$/.test(t));
 if(executable==='make'){
  const rest=[];
  for(let i=0;i<tokens.length;i++){const t=tokens[i];if(['-C','-f','--directory','--file','-o','-W','-I'].includes(t)){i++;continue;}if(t==='-j'&&/^\d+$/.test(tokens[i+1]??'')){i++;continue;}if(!t.startsWith('-')&&!t.includes('='))rest.push(t);}
  return rest.some(t=>TARGET.test(t));
 }
 if(['cargo','go','dotnet'].includes(executable))return ['test','check','build','verify'].includes(tokens[0]);
 if(['python','python3'].includes(executable))return tokens[0]==='-m'&&['pytest','unittest'].includes(tokens[1]);
 return false;
}

// `set -o pipefail` (also combined, e.g. `set -euo pipefail`) makes a pipeline return the first failure.
function setsPipefail(words){
 if(words[0]!=='set')return false;
 return words.some((w,i)=>i>0&&/^-[a-zA-Z]*o$/.test(w)&&words[i+1]==='pipefail');
}
const SEQUENCE=[';','\n'];
function statusExit(words,index,preserved){
 if(words[0]!=='exit'||words.length!==2)return false;
 const m=/^\$\{PIPESTATUS\[(\d+)\]\}$/.exec(words[1]);if(m)return Number(m[1])===index;
 return preserved&&['$?','${?}'].includes(words[1]);
}
const printsStatus=words=>['echo','printf'].includes(words[0])&&words.slice(1).some(w=>/\$\{?\?/.test(w));

// Allowed shapes that keep the validation's failure status visible:
//   cmd > log 2>&1; echo "exit=$?"      output captured in a file, status printed
//   set -o pipefail; cmd | tail         the pipeline returns cmd's failure
//   cmd | tail; exit ${PIPESTATUS[0]}   the shell returns cmd's status
function keepsStatus(pipelines,i){
 const before=pipelines.slice(0,i),after=pipelines.slice(i+1),p=pipelines[i];
 if(before.some(b=>b.commands.length!==1||b.commands[0][0]!=='set'||!(SEQUENCE.includes(b.op)||b.op==='&&')))return false;
 const pipefail=before.some(b=>setsPipefail(b.commands[0]));
 const index=p.commands.findLastIndex(validation),last=index===p.commands.length-1,preserved=last||pipefail;
 if(!after.length)return preserved;
 if(after.length!==1||after[0].commands.length!==1||!SEQUENCE.includes(p.op))return false;
 const next=after[0].commands[0];
 if(statusExit(next,index,preserved))return true;
 return preserved&&last&&printsStatus(next)&&redirects(p.commands[index]).stdout;
}

export function validationGuard(command){
 if(typeof command!=='string'||!command.trim())return {blocked:false};
 const parsed=parse(command.trim());
 if(parsed.ambiguous)return {blocked:false};
 const nested=parsed.pipelines.some(p=>p.commands.some(words=>{const s=shellScript(plain(words));return s!==null&&validationGuard(s).blocked;}));
 const targets=parsed.pipelines.flatMap((p,i)=>p.commands.some(validation)?[i]:[]);
 const compound=parsed.background||parsed.count>1;
 const blocked=nested||(compound&&targets.length>0&&(parsed.background||targets.length>1||!keepsStatus(parsed.pipelines,targets[0])));
 return {blocked,reason:blocked?'AW_VALIDATION_COMPOUND: Run the validation as one direct command, without pipes, semicolons, conditionals or following echo/reads. Use the tool working-directory option instead of cd chains. To shorten output, keep the status: `set -o pipefail; CMD | tail`, `CMD | tail; exit ${PIPESTATUS[0]}`, or `CMD > log 2>&1; echo "exit=$?"`. Nothing was executed.':null};
}
