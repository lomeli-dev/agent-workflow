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
export function block(text,content){
  text??='';const a=text.indexOf(START),b=text.indexOf(END);
  if((a<0)!==(b<0) || (a>=0&&(b<a||text.indexOf(START,a+1)>=0||text.indexOf(END,b+1)>=0)))throw Error('Malformed or duplicate managed block');
  const managed=content===null?'':`${START}\n${content.trim()}\n${END}`;
  if(a>=0)return text.slice(0,a)+managed+text.slice(b+END.length);
  if(content===null)return text;
  return text+(text && !text.endsWith('\n')?'\n':'')+(text?'\n':'')+managed+'\n';
}
export function blockContent(text){const a=text?.indexOf(START)??-1,b=text?.indexOf(END)??-1;return a<0||b<a?null:text.slice(a,b+END.length);}
