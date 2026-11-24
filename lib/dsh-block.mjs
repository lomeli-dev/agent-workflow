// The managed YAML block in a dsh profile's cordis.patch.yml, compared by content (0.7.1).
// dsh's config editor (dsh-config-editor: yaml parseDocument, document.add, String(document)) rewrites
// the whole file when a setting is saved, for example on the first `dsh --profile web`: it keeps
// comments and our markers, folds double-quoted scalars at 80 columns, and appends its own row at the
// end of the list, which is inside our block when the block is last. A byte hash then reports drift
// although nothing of ours changed. Here the block is split into top-level list items: our item (an
// `insert:` list whose rows all have agent-workflow-* ids) is compared as data, parsed with js-yaml
// and the `!!js` tag like dsh's loader does, and every other item is foreign and kept.
import yaml from 'js-yaml';
import {blockInner,MARKERS} from './files.mjs';
import {hash} from './files.mjs';

const JsExpr=new yaml.Type('tag:yaml.org,2002:js',{kind:'scalar',resolve:d=>typeof d==='string',construct:d=>({__jsExpr:d})});
const SCHEMA=yaml.JSON_SCHEMA.extend(JsExpr);
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const isOurs=item=>!!item&&typeof item==='object'&&!Array.isArray(item)&&Object.keys(item).length===1&&Array.isArray(item.insert)&&item.insert.length>0&&item.insert.every(r=>typeof r?.id==='string'&&r.id.startsWith('agent-workflow-'));

// Top-level items of a block list as raw text chunks (comments and blank lines before an item belong
// to it; text before the first item is kept as its own chunk).
function chunks(text){
  const out=[];let cur=[];
  for(const line of text.split('\n')){if(/^-(\s|$)/.test(line)&&cur.some(l=>/^-(\s|$)/.test(l))){out.push(cur.join('\n'));cur=[];}cur.push(line);}
  if(cur.length)out.push(cur.join('\n'));
  return out;
}
// Data hash of our item (null when the block is not exactly one item of ours plus foreign items).
export function dshBlockData(owned){
  let ours=[],foreign=[];
  try{
    for(const c of chunks(blockInner(owned,'yaml'))){
      const v=yaml.load(c,{schema:SCHEMA});
      if(v===undefined||v===null)continue;
      if(!Array.isArray(v)||v.length!==1)return null;
      (isOurs(v[0])?ours:foreign).push({data:v[0],text:c});
    }
  }catch{return null;}
  if(ours.length!==1)return null;
  return {dataHash:hash(canonical(ours[0].data)),foreign:foreign.map(f=>f.text.replace(/\s+$/,'')).join('\n')};
}
export function dshDataHash(content){return dshBlockData(`${MARKERS.yaml[0]}\n${content.trim()}\n${MARKERS.yaml[1]}`)?.dataHash??null;}
// Is a block whose bytes differ from the record still ours? Same rows as recorded (dataHash, 0.7.1+)
// or as one of the contents this version writes (records from 0.6.1/0.7.0 have no dataHash).
export function dshBlockOwned(owned,record,candidates){
  const d=dshBlockData(owned);if(!d)return null;
  const known=[record?.dataHash,...candidates.map(dshDataHash)].filter(Boolean);
  return known.includes(d.dataHash)?d:null;
}
// Puts foreign rows found inside the block right after it.
export function afterBlock(text,foreign){
  if(!foreign)return text;
  const E=MARKERS.yaml[1],i=text.indexOf(E)+E.length,tail=text.slice(i);
  return text.slice(0,i)+'\n'+foreign+(tail.startsWith('\n')?tail:'\n'+tail);
}
