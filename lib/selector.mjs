import {createInterface} from 'node:readline/promises';
import {CATALOG,selectModules} from './catalog.mjs';
export function parseSelection(text){
 const keys=Object.keys(CATALOG),input=text.trim();if(/^(all|todo|todos|\*)$/i.test(input))return selectModules({all:true});
 if(!input)return [];
 return [...new Set(input.split(/[,\s]+/).map(x=>{const id=/^\d+$/.test(x)?keys[Number(x)-1]:x;if(!Object.hasOwn(CATALOG,id))throw Error('Unknown selection: '+x);return id;}))];
}
export async function selectInteractive(){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Interactive selection needs a terminal; use --list, --tools, --profile or --all');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 try{
  console.log('Agent Workflow — select modules (no linters/formatters or persistent tasks)');
  Object.entries(CATALOG).forEach(([id,m],n)=>console.log(`${n+1}. ${m.label} [${id}]${m.explicitOnly?" — explicit only; excluded from all":""}`));
  return parseSelection(await rl.question('Numbers/names separated by commas, or "all" (excludes optional browser alternatives); empty cancels: '));
 }finally{rl.close();}
}
