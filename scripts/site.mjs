// Builds the GitHub Pages source (Jekyll) from the repository's own Markdown, so the site never
// drifts from README/docs/CHANGELOG: pages are generated at build time, never copied by hand.
// Usage: node scripts/site.mjs [outDir]   (default .runtime/site-src; Jekyll then builds it)
// Node builtins only; no network, no dependency install.
import {readFileSync,writeFileSync,mkdirSync,rmSync,cpSync,existsSync,statSync,readdirSync} from 'node:fs';
import {resolve,dirname,join,relative,posix} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const REPO='lomeli-dev/agent-workflow';
const GITHUB=`https://github.com/${REPO}`;

// Navigation order and labels. A ref without a page in one language links to the other language's page.
export const NAV=[
 {ref:'home',es:'Inicio',en:'Home'},
 {ref:'status',es:'Estado por cliente',en:'Client status'},
 {ref:'operations',es:'Operaciones',en:'Operations'},
 {ref:'compatibility',es:'Compatibilidad',en:'Compatibility'},
 {ref:'tools',es:'Herramientas',en:'Tools'},
 {ref:'testing',es:'Pruebas',en:'Testing'},
 {ref:'architecture',es:'Arquitectura',en:'Architecture'},
 {ref:'changelog',es:'Cambios',en:'Changelog'},
 {ref:'releases',es:'Releases',en:'Releases',external:`${GITHUB}/releases`},
];

// Spanish first, English beside it. `pick` takes the intro (before the first `##`) and/or named sections.
export const PAGES=[
 {ref:'home',lang:'es',permalink:'/',src:'README.es.md',pick:{intro:true,sections:['Instalar todo en 5 minutos']}},
 {ref:'home',lang:'en',permalink:'/en/',src:'README.md',pick:{intro:true,sections:['Install everything in 5 minutes']}},
 {ref:'status',lang:'es',permalink:'/estado/',src:'docs/operaciones.es.md',pick:{sections:['Estado por cliente']}},
 {ref:'status',lang:'en',permalink:'/en/status/',src:'docs/compatibility.md',pick:{sections:['Client status']}},
 {ref:'operations',lang:'es',permalink:'/operaciones/',src:'docs/operaciones.es.md'},
 {ref:'operations',lang:'en',permalink:'/en/operations/',src:'docs/operations.md'},
 {ref:'compatibility',lang:'en',permalink:'/en/compatibility/',src:'docs/compatibility.md'},
 {ref:'tools',lang:'es',permalink:'/herramientas/',src:'README.es.md',pick:{sections:['Herramientas opcionales']}},
 {ref:'tools',lang:'en',permalink:'/en/tools/',src:'docs/tools.md'},
 {ref:'testing',lang:'es',permalink:'/pruebas/',src:'docs/pruebas.es.md'},
 {ref:'testing',lang:'en',permalink:'/en/testing/',src:'docs/testing.md'},
 {ref:'architecture',lang:'en',permalink:'/en/architecture/',src:'docs/architecture.md'},
 {ref:'changelog',lang:'en',permalink:'/en/changelog/',src:'CHANGELOG.md'},
];

const FENCE=/^\s{0,3}(```|~~~)/;
// Lines with their heading level (0 = not a heading), ignoring fenced code.
function scan(md){let fence=null;return md.split('\n').map(line=>{
 const f=line.match(FENCE);if(f){if(!fence)fence=f[1];else if(line.trim().startsWith(fence))fence=null;return {line,level:0};}
 if(fence)return {line,level:0};const h=line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);return h?{line,level:h[1].length,text:h[2]}:{line,level:0};});}

function pick(md,spec,src){
 if(!spec)return md;const rows=scan(md),out=[];
 if(spec.intro){const h1=rows.findIndex(r=>r.level===1),end=rows.findIndex((r,i)=>i>h1&&r.level&&r.level<=2);out.push(rows.slice(0,end<0?rows.length:end).map(r=>r.line).join('\n').trimEnd());}
 for(const name of spec.sections||[]){
  const start=rows.findIndex(r=>r.level>=2&&r.text.startsWith(name));if(start<0)throw Error(`Site: section "${name}" not found in ${src}`);
  const level=rows[start].level;let end=rows.findIndex((r,i)=>i>start&&r.level&&r.level<=level);if(end<0)end=rows.length;
  const body=rows.slice(start,end).map(r=>r.line);
  if(!spec.intro)body[0]=body[0].replace(/^#+/,'#');// a section page starts with its own title; the id is unchanged
  out.push(body.join('\n').trimEnd());
 }
 return out.join('\n\n')+'\n';
}

// GitHub-style heading ids (kramdown's GFM parser generates the same ones).
export function slug(text){return text.replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/<[^>]+>/g,'').toLowerCase().replace(/[^\p{L}\p{M}\p{N}_\- ]/gu,'').replace(/ /g,'-');}
export function ids(md){const seen=new Map(),out=new Set();for(const r of scan(md)){if(!r.level)continue;const base=slug(r.text),n=seen.get(base)||0;seen.set(base,n+1);out.add(n?`${base}-${n}`:base);}return out;}

function relUrl(from,to){if(from===to)return './';const r=posix.relative(from,to);return (r||'.')+'/';}

export function buildSite({root=ROOT,out}={}){
 out=resolve(out||join(root,'.runtime/site-src'));
 // The output is deleted first: never the repository, one of its ancestors or a source folder.
 const sources=['.git','.rulesync','bin','docs','examples','generated','lib','scripts','site','tests'].map(d=>join(root,d));
 if(out===root||root.startsWith(out+'/')||sources.some(d=>out===d||out.startsWith(d+'/')))throw Error(`Site: refusing to write into ${out}`);
 rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
 cpSync(join(root,'site'),out,{recursive:true});
 const pages=PAGES.map(p=>{const content=pick(readFileSync(join(root,p.src),'utf8'),p.pick,p.src);return {...p,content,ids:ids(content),partial:!!p.pick};});
 const external=new Set(),links=[];
 function target(page,file,anchor){
  const cands=pages.filter(p=>p.src===file).sort((a,b)=>(a.lang===page.lang?0:1)-(b.lang===page.lang?0:1)||a.partial-b.partial);
  const hit=anchor?cands.find(p=>p.ids.has(anchor)):cands[0];
  if(hit)return relUrl(page.permalink,hit.permalink).replace(/^\.\/$/,anchor?'':'./')+(anchor?'#'+anchor:'');
  const abs=join(root,file);if(!existsSync(abs))throw Error(`Site: ${page.src} links to missing ${file}`);
  const url=`${GITHUB}/${statSync(abs).isDirectory()?'tree':'blob'}/main/${file}`+(anchor?'#'+anchor:'');external.add(url);return url;
 }
 for(const page of pages){
  let fence=null;const body=page.content.split('\n').map(line=>{
   const f=line.match(FENCE);if(f){if(!fence)fence=f[1];else if(line.trim().startsWith(fence))fence=null;return line;}
   if(fence)return line;
   return line.replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g,(m,pre,ref,post)=>{
    if(/^[a-z][a-z0-9+.-]*:/i.test(ref))return m;
    const [path,anchor='']=ref.split('#');const file=path?posix.normalize(posix.join(posix.dirname(page.src),decodeURIComponent(path))).replace(/\/$/,''):page.src;
    if(file.startsWith('..'))throw Error(`Site: ${page.src} links outside the repository: ${ref}`);
    const url=target(page,file,anchor);links.push({from:page.permalink,url});return pre+url+post;
   });
  }).join('\n');
  const alt=pages.find(p=>p.ref===page.ref&&p.lang!==page.lang)||pages.find(p=>p.ref==='home'&&p.lang!==page.lang);
  const label=NAV.find(n=>n.ref===page.ref)[page.lang];
  const front={layout:'default',title:label,lang:page.lang,ref:page.ref,permalink:page.permalink,source:page.src,partial:page.partial,alt_url:alt.permalink,alt_lang:alt.lang};
  if(body.includes('{% endraw %}'))throw Error(`Site: ${page.src} contains a Liquid endraw tag`);
  const file=join(out,page.permalink==='/'?'index.md':page.permalink.slice(1,-1)+'.md');mkdirSync(dirname(file),{recursive:true});
  // {% raw %}: GitHub Pages runs Jekyll 3 (no render_with_liquid), and the docs quote `${{ }}`/`{%` literally.
  writeFileSync(file,'---\n'+Object.entries(front).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n{% raw %}\n'+body+'\n{% endraw %}\n');
 }
 const nav={};for(const lang of ['es','en'])nav[lang]=NAV.map(n=>{
  if(n.external)return {title:n[lang],url:n.external,external:true};
  const p=pages.find(x=>x.ref===n.ref&&x.lang===lang)||pages.find(x=>x.ref===n.ref);
  return {title:n[lang]+(p.lang===lang?'':(lang==='es'?' (en inglés)':' (in Spanish)')),url:p.permalink,lang:p.lang};
 });
 mkdirSync(join(out,'_data'),{recursive:true});writeFileSync(join(out,'_data/nav.json'),JSON.stringify(nav,null,1)+'\n');
 return {out,pages:pages.map(({content,...p})=>({...p,ids:[...p.ids]})),nav,links,external:[...external]};
}

// Checks the HTML Jekyll built: every link inside the site points to an existing page and heading id.
export function checkBuilt(dir,base='/agent-workflow/'){
 const files=[];(function walk(d){for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.html'))files.push(p);}})(dir);
 const html=new Map(files.map(f=>[f,readFileSync(f,'utf8')]));const problems=[];let checked=0;
 const idsOf=f=>new Set([...html.get(f).matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));
 for(const [file,text] of html){
  const rel=relative(dir,file).split('\\').join('/'),page=new URL(base+rel.replace(/(^|\/)index\.html$/,'$1'),'https://site.invalid');
  for(const [,raw] of text.matchAll(/\shref="([^"]*)"/g)){
   const href=raw.replace(/&amp;/g,'&'),u=new URL(href,page);if(u.origin!==page.origin)continue;checked++;
   if(!u.pathname.startsWith(base)){problems.push(`${rel}: ${href} is outside ${base}`);continue;}
   const path=decodeURIComponent(u.pathname.slice(base.length));let target=join(dir,path);
   if(path===''||path.endsWith('/'))target=join(target,'index.html');else if(!existsSync(target)||statSync(target).isDirectory())target=join(target,'index.html');
   if(!existsSync(target)){problems.push(`${rel}: ${href} has no page`);continue;}
   const anchor=decodeURIComponent(u.hash.slice(1));if(anchor&&target.endsWith('.html')&&!idsOf(target).has(anchor))problems.push(`${rel}: ${href} has no #${anchor}`);
  }
 }
 return {pages:files.length,checked,problems};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv[2]==='--check'){
  const r=checkBuilt(resolve(process.argv[3]||'_site'));
  if(r.problems.length){console.error(r.problems.join('\n'));process.exit(1);}
  console.log(`Built site: ${r.pages} HTML pages, ${r.checked} internal links and anchors resolve`);process.exit(0);
 }
 const r=buildSite({out:process.argv[2]?resolve(process.argv[2]):undefined});
 console.log(`Site source: ${r.pages.length} pages, ${r.links.length} links (${r.external.length} to GitHub) in ${relative(process.cwd(),r.out)||'.'}`);
}
