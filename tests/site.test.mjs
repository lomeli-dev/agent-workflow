import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {buildSite,checkBuilt,ids,slug,ROOT,PAGES,NAV} from '../scripts/site.mjs';

function temp(t){const d=mkdtempSync(join(tmpdir(),'aw-site-'));t.after(()=>rmSync(d,{recursive:true,force:true}));return d;}
const fileOf=(out,permalink)=>join(out,permalink==='/'?'index.md':permalink.slice(1,-1)+'.md');

test('site: every page is generated from the repository Markdown, Spanish first with English beside it',t=>{
 const out=join(temp(t),'src'),r=buildSite({out});
 assert.equal(r.pages.length,PAGES.length);
 for(const p of PAGES){const text=readFileSync(fileOf(out,p.permalink),'utf8');assert.match(text,/^---\nlayout: "default"\n/);assert(text.includes(`source: ${JSON.stringify(p.src)}`));assert(text.includes('{% raw %}'));}
 const home=readFileSync(join(out,'index.md'),'utf8');
 assert.match(home,/lang: "es"/);assert.match(home,/^## Instalar todo en 5 minutos$/m);assert.doesNotMatch(home,/^## Instalación global$/m,'home is the intro plus the 5-minute guide only');
 assert.match(readFileSync(join(out,'estado.md'),'utf8'),/^# Estado por cliente/m);assert.match(readFileSync(join(out,'estado.md'),'utf8'),/^\| Cliente \|/m);
 assert.match(readFileSync(join(out,'en/status.md'),'utf8'),/^\| Client \|/m);
 assert.equal(readFileSync(join(out,'en/changelog.md'),'utf8').includes(readFileSync(join(ROOT,'CHANGELOG.md'),'utf8').split('\n').slice(2,6).join('\n')),true,'changelog is the file itself');
 for(const lang of ['es','en']){assert.equal(r.nav[lang].length,NAV.length);assert(r.nav[lang].some(n=>n.external&&n.url.endsWith('/releases')));}
 assert(r.nav.es.find(n=>n.url==='/en/changelog/').title.includes('(en inglés)'));
 assert(existsSync(join(out,'_config.yml'))&&existsSync(join(out,'_layouts/default.html')));
});

test('site: rewritten links point to generated pages and existing heading ids, others to GitHub',t=>{
 const out=join(temp(t),'src'),r=buildSite({out});const byUrl=new Map(r.pages.map(p=>[p.permalink,p]));
 assert(r.links.length>20);
 for(const {from,url} of r.links){
  if(/^https:\/\/github\.com\/lomeli-dev\/agent-workflow\/(blob|tree)\/main\//.test(url)){assert(existsSync(join(ROOT,url.split('/main/')[1].split('#')[0])),url);continue;}
  assert.doesNotMatch(url,/\.md(#|$)/,`${from} -> ${url} still links to Markdown`);
  const [path,anchor]=url.split('#'),target=path?posix.join(from,path)+(path.endsWith('/')?'':'/'):from;
  const page=byUrl.get(posix.normalize(target));assert(page,`${from} -> ${url} has no page`);
  if(anchor)assert(page.ids.includes(anchor),`${from} -> ${url}: no #${anchor} in ${page.permalink}`);
 }
});

test('site: GitHub-style heading ids, fenced code ignored, duplicates numbered',()=>{
 assert.equal(slug('Client status (0.6.1)'),'client-status-061');
 assert.equal(slug('Instalar todo en 5 minutos'),'instalar-todo-en-5-minutos');
 assert.equal(slug('dsh rewrites its own patch file (0.7.1)'),'dsh-rewrites-its-own-patch-file-071');
 assert.equal(slug('`--all-in` and [links](x.md)'),'--all-in-and-links');
 assert.deepEqual([...ids('# A\n\n```sh\n# not a heading\n```\n## A\n')],['a','a-1']);
});

test('site: the output folder is never the repository or a source folder',t=>{
 for(const out of [ROOT,join(ROOT,'docs'),join(ROOT,'site'),join(ROOT,'docs/x')])assert.throws(()=>buildSite({out}),/refusing/);
});

test('site --check: reports a missing page and a missing anchor in the built HTML',t=>{
 const dir=temp(t),put=(p,s)=>{mkdirSync(join(dir,p,'..'),{recursive:true});writeFileSync(join(dir,p),s);};
 put('index.html','<a href="/agent-workflow/en/">en</a> <a href="en/#ok">ok</a> <a href="https://github.com/x">ext</a>');
 put('en/index.html','<h2 id="ok">ok</h2><a href="../">es</a> <a href="../gone/">gone</a> <a href="#nope">nope</a> <a href="/elsewhere/">out</a>');
 const r=checkBuilt(dir);
 assert.equal(r.pages,2);
 assert.deepEqual(r.problems.sort(),['en/index.html: #nope has no #nope','en/index.html: ../gone/ has no page','en/index.html: /elsewhere/ is outside /agent-workflow/'].sort());
});
