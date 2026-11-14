// Explicit allowlist. No linter, formatter, task daemon, or arbitrary package input.
export const CATALOG={
 gopls:{label:'Go LSP',group:'lsp',bin:'gopls',probe:['version'],go:'golang.org/x/tools/gopls@v0.23.0'},
 typescript:{label:'TypeScript / JavaScript LSP',group:'lsp',bin:'typescript-language-server',probe:['--version'],packages:['typescript-language-server@5.3.0','typescript@5.9.3']},
 python:{label:'Python LSP / Pyright',group:'lsp',bin:'pyright',probe:['--version'],packages:['pyright@1.1.414']},
 rust:{label:'Rust LSP',group:'lsp',bin:'rust-analyzer',probe:['--version'],rustup:true},
 bash:{label:'Bash LSP (no ShellCheck or formatter)',group:'lsp',bin:'bash-language-server',probe:['--version'],packages:['bash-language-server@5.8.1']},
 yaml:{label:'YAML LSP',group:'lsp',bin:'yaml-language-server',probe:['--help'],packages:['yaml-language-server@2.0.0'],probeFile:true},
 'ast-grep':{label:'Structural search / refactoring',group:'code',bin:'ast-grep',probe:['--version'],packages:['@ast-grep/cli@0.51.2']},
 serena:{label:'Serena symbol tools (MCP)',group:'code',bin:'serena',probe:['--help'],uv:'serena-agent==2.1.0',python:'3.13'},
 codegraph:{label:'CodeGraph graph-only (MCP)',group:'code',bin:'codegraph-mcp',probe:['--help'],packages:['@astudioplus/codegraph-mcp@0.21.0'],engine:true},
 'agent-browser':{label:'Vercel Agent Browser (default browser)',group:'web',bin:'agent-browser',probe:['--version'],packages:['agent-browser@0.43.0']},
 playwright:{label:'Playwright test/browser engine',group:'web',explicitOnly:true,bin:'playwright',probe:['--version'],packages:['playwright@1.65.1'],browser:true},
 'playwright-cli':{label:'Playwright CLI for agents',group:'web',explicitOnly:true,bin:'playwright-cli',probe:['--version'],packages:['@playwright/cli@0.1.24']},
 'playwright-mcp':{label:'Playwright MCP',group:'web',explicitOnly:true,bin:'playwright-mcp',probe:['--version'],packages:['@playwright/mcp@0.0.85']},
 devtools:{label:'Chrome DevTools MCP',group:'web',explicitOnly:true,bin:'chrome-devtools-mcp',probe:['--version'],packages:['chrome-devtools-mcp@1.13.0']},
 context7:{label:'Context7 documentation MCP',group:'docs',bin:'context7-mcp',probe:['--help'],packages:['@upstash/context7-mcp@4.7.0']},
 github:{label:'GitHub CLI',group:'delivery',bin:'gh',probe:['--version'],release:{repo:'cli/cli',version:'2.104.0'}},
 gitleaks:{label:'Gitleaks secret detection (no commit hook)',group:'delivery',bin:'gitleaks',probe:['version'],release:{repo:'gitleaks/gitleaks',version:'8.30.1'}},
};
export const PROFILES={lsp:['gopls','typescript','python','rust','bash','yaml'],code:['ast-grep','serena','codegraph'],web:['agent-browser'],docs:['context7'],delivery:['github','gitleaks']};
export function selectModules({tools=[],profile,all=false}={}){
 if(all&&(tools.length||profile))throw Error('Choose --all, --profile or --tools, not a combination with --all');
 if(profile&&!Object.hasOwn(PROFILES,profile))throw Error('Unknown profile: '+profile);
 const ids=[...new Set(all?Object.keys(CATALOG).filter(id=>!CATALOG[id].explicitOnly):[...(profile?PROFILES[profile]:[]),...tools])];
 for(const id of ids)if(!Object.hasOwn(CATALOG,id))throw Error('Unknown module: '+id);
 return ids;
}
