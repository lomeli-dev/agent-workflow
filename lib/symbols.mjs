import {createRequire} from 'node:module';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute,extname,sep} from 'node:path';
import {locations} from './install.mjs';
import {findBin} from './modules.mjs';
import {status} from './gate.mjs';
function compiler(userRoot){
 const bin=findBin('typescript-language-server',locations(userRoot));
 if(bin){try{return createRequire(realpathSync(bin))('typescript');}catch{}}
 try{return createRequire(import.meta.url)('typescript');}catch{throw Error('TypeScript parser unavailable. Install the optional typescript module explicitly; nothing was installed automatically.');}
}
export function findSymbols({project,file,name,limit=200,userRoot}){
 if(!project||typeof file!=='string'||isAbsolute(file))throw Error('Provide --project and a project-relative file');
 if(!status(project).enabled)throw Error('Agent Workflow is disabled in this project');
 const root=realpathSync(project),path=realpathSync(resolve(root,file)),rel=relative(root,path);
 if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Requested file is outside the project');
 if(!['.js','.jsx','.mjs','.cjs','.ts','.tsx','.mts','.cts'].includes(extname(path)))throw Error('Symbol fallback supports JavaScript/TypeScript modules only');
 const stat=statSync(path);if(!stat.isFile()||stat.size>1024*1024)throw Error('Expected a regular module no larger than 1 MiB');
 if(name!==undefined&&typeof name!=='string')throw Error('name must be an exact symbol name');
 if(!Number.isInteger(limit)||limit<1||limit>500)throw Error('limit must be 1..500');
 const ts=compiler(userRoot),text=readFileSync(path,'utf8'),source=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
 if(source.parseDiagnostics.length)throw Error('Module has syntax errors; no complete symbol result is claimed');
 const symbols=[];let total=0;
 const kinds=new Map([[ts.SyntaxKind.FunctionDeclaration,'function'],[ts.SyntaxKind.ClassDeclaration,'class'],[ts.SyntaxKind.MethodDeclaration,'method'],[ts.SyntaxKind.VariableDeclaration,'variable'],[ts.SyntaxKind.InterfaceDeclaration,'interface'],[ts.SyntaxKind.TypeAliasDeclaration,'type'],[ts.SyntaxKind.EnumDeclaration,'enum']]);
 const visit=node=>{
  if(kinds.has(node.kind)&&node.name&&(ts.isIdentifier(node.name)||ts.isStringLiteral(node.name))){
   const symbol=node.name.text;
   if(name===undefined||name===symbol){
    total++;if(symbols.length<limit){const pos=source.getLineAndCharacterOfPosition(node.name.getStart(source));symbols.push({name:symbol,kind:kinds.get(node.kind),file:rel.split(sep).join('/'),line:pos.line+1,column:pos.character+1});}
   }
  }
  ts.forEachChild(node,visit);
 };
 visit(source);
 return {source:'typescript-parser',coverage:'named-declarations-in-requested-file',graphRelationships:false,file:rel.split(sep).join('/'),symbols,truncated:total>limit,total};
}
