import {existsSync,lstatSync,readFileSync,mkdirSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';

export const hash=s=>createHash('sha256').update(s).digest('hex');
export function read(path){try{return readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}}
export function noSymlinks(path){
  for(let p=resolve(path);;p=dirname(p)){
    if(existsSync(p) || (()=>{try{lstatSync(p);return true;}catch{return false;}})()){
      if(lstatSync(p).isSymbolicLink())throw Error('Refusing symlink destination: '+p);
    }
    if(dirname(p)===p)break;
  }
}
export function atomic(path,text,mode){
  noSymlinks(path);mkdirSync(dirname(path),{recursive:true,mode:0o700});
  mode??=existsSync(path)?lstatSync(path).mode&0o777:0o600;
  const tmp=join(dirname(path),`.aw-${randomUUID()}.tmp`);
  try {writeFileSync(tmp,text,{flag:'wx',mode});renameSync(tmp,path);}finally{if(existsSync(tmp))unlinkSync(tmp);}
}
export function lock(root,fn){
  noSymlinks(root);mkdirSync(root,{recursive:true,mode:0o700});const path=join(root,'install.lock');let fd;
  try{fd=openSync(path,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('Installation locked; inspect the existing operation before removing its lock');throw e;}
  try{return fn();}finally{closeSync(fd);unlinkSync(path);}
}

export const START='<!-- agent-workflow:begin -->',END='<!-- agent-workflow:end -->';
// Managed-block markers per file syntax: Markdown rule files (default), TOML and YAML configs.
const HASH_MARKERS=['# agent-workflow:begin (managed; do not edit)','# agent-workflow:end'];
export const MARKERS={md:[START,END],toml:HASH_MARKERS,yaml:HASH_MARKERS};
const markers=syntax=>MARKERS[syntax??'md']??(()=>{throw Error('Unknown managed block syntax');})();
export function block(text,content,syntax){
  const [S,E]=markers(syntax);
  text??='';const a=text.indexOf(S),b=text.indexOf(E);
  if((a<0)!==(b<0) || (a>=0&&(b<a||text.indexOf(S,a+1)>=0||text.indexOf(E,b+1)>=0)))throw Error('Malformed or duplicate managed block');
  const managed=content===null?'':`${S}\n${content.trim()}\n${E}`;
  if(a>=0)return text.slice(0,a)+managed+text.slice(b+E.length);
  if(content===null)return text;
  return text+(text && !text.endsWith('\n')?'\n':'')+(text?'\n':'')+managed+'\n';
}
export function blockContent(text,syntax){const [S,E]=markers(syntax),a=text?.indexOf(S)??-1,b=text?.indexOf(E)??-1;return a<0||b<a?null:text.slice(a,b+E.length);}
// Removes the managed block and the blank line that block() added before it.
export function unblock(text,syntax){
  const [S,E]=markers(syntax),a=text.indexOf(S),b=text.indexOf(E);if(a<0)return text;
  let start=a,end=b+E.length;
  if(text[end]==='\n')end++;
  if(text.slice(start-2,start)==='\n\n')start--;
  return text.slice(0,start)+text.slice(end);
}
// Inner text of a managed block (what block() receives as content).
export function blockInner(owned,syntax){const [S,E]=markers(syntax);return owned.slice(S.length+1,-(E.length+1));}
