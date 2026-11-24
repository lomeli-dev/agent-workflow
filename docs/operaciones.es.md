# Instalación, uso y recuperación

[English](operations.md) · [Portada](../README.es.md)

## Qué necesitas

Node.js **22.22.0 o superior**, npm, Git y acceso al repositorio privado. Rulesync viene fijado como dependencia; no hace falta instalar otro global. Se soportan macOS/Linux. Para sus módulos respectivos necesitas Go, uv (Serena) o rustup con un toolchain. Si falta un requisito se informa; no se instala todo un entorno del sistema silenciosamente.

La integración se instala por usuario. Los MCP se conectan por proyecto. Las herramientas opcionales se guardan en un directorio administrado; no se instalan al abrir una sesión. No añadimos linter, formateador independiente ni servicio de tareas persistentes. Algunas dependencias contienen bibliotecas de formato internamente; no las activamos sobre tu código.

## Instalar y elegir herramientas

La portada tiene la secuencia completa: clonar, `npm ci --ignore-scripts`, ejecutar las comprobaciones, registrar el CLI con npm, previsualizar `install --global`, instalar y verificar. Son pasos distintos: registrar un comando no significa que Claude, Codex u OpenCode ya lo hayan cargado. Recarga el cliente y acepta hooks/MCP cuando te lo pida.

```sh
agent-workflow setup --list
agent-workflow setup --interactive
agent-workflow setup --tools serena,codegraph --apply
agent-workflow setup --profile web --apply
```

Sin `--apply` sólo se presenta el plan, aunque puede ejecutar probes de versión/ayuda. Puedes elegir un módulo, varios, una categoría o `--all`. Este último excluye Playwright motor/CLI/MCP y DevTools. El perfil `web` instala únicamente agent-browser; no descarga Chrome. El postinstall npm del paquete fijado prepara su binario nativo.

## Qué hace cada comando

| Comando | Para qué sirve |
| --- | --- |
| `install --global` / `sync --global` | Instalar o actualizar los archivos propios; `--clients` acepta una lista o `all` (por defecto claude,codex,opencode). Un `sync` puede añadir clientes |
| `verify` | Verificar archivos y registros propios (con `warnings` si Codex no tiene aprobados los hooks y `notices` de condiciones nativas), y el Node y runtime que llaman los hooks; `status: outdated` lista lo que difiere de este paquete (toca `sync`); no demuestra ejecución dentro del IDE |
| `doctor --json` | Comprobar ejecutables/versiones y repetir lo de `verify` en `installation`; no acredita autenticación ni integración completa |
| `status --project RUTA --json` | Ver si este proyecto tiene activado el flujo |
| `disable --project RUTA` / `enable --project RUTA` | Cambiar el interruptor del proyecto; admite `--dry-run` |
| `setup --list` | Mostrar catálogo y perfiles |
| `setup --interactive`, `--tool`, `--tools`, `--profile`, `--all` | Elegir herramientas; agregar `--apply` para instalar |
| `symbols --project RAIZ --file modulo.mjs [--name NOMBRE]` | Buscar declaraciones con el parser TypeScript y rutas originales, sin relaciones de grafo |
| `exec --tool NOMBRE -- ARGUMENTOS` | Ejecutar la herramienta instalada con el PATH administrado |
| `mcp-config --project RAIZ` | Mostrar sugerencias de configuración sin escribir archivos |
| `connect --project RAIZ` | Registrar MCP del proyecto; `--dry-run` previsualiza |
| `disconnect --project RAIZ` | Retirar las entradas propias; repetir el mismo `--clients` de la conexión |
| `disconnect --prune` | Olvidar los recibos cuyo proyecto ya no existe (p. ej. un worktree borrado); `--dry-run` previsualiza |
| `mcp --tool NOMBRE --project RUTA` | Lanzador stdio interno usado por los registros |
| `uninstall --global` | Retirar integración y revertir cambios propios; conserva herramientas |
| `--user-root RUTA` | Usar una raíz temporal de pruebas existente; no es un sandbox del sistema |

No combines `--all` con otros selectores, ni `--apply` con `--dry-run`.

## Estado por cliente (0.6.1)

Una sola tabla con lo que funciona, lo que no y por qué, según las pruebas reales en el HOME del dueño (23 nov 2026; logs `060-*` e informe de pruebas pendientes de 0.5.1) y las comprobaciones aisladas de 0.6.1. Detalle y evidencia en [compatibilidad](compatibility.md#client-status-061).

| Cliente | Regla | Hook (sesión / subagente) | Guard | MCP de proyecto | Revisor solo lectura | Lo que no funciona y por qué |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | ✅ | ✅ / ✅ | ✅ activo por defecto (real: bloqueó y luego exit 7) | ✅ `.mcp.json` + `enabledMcpjsonServers` | ✅ sin Edit/Write/NotebookEdit | al revisor le queda Bash (ahí es solo instrucción) |
| Codex CLI | ✅ | ✅ / ✅ | ✅ con `--trust-codex` (real: bloqueó y luego exit 7) | ✅ `.codex/config.toml`, proyecto confiado | ❌ ignora el sandbox del rol; usa `codex exec -s read-only` | en Codex 0.171 el subagente hereda el sandbox del padre |
| OpenCode V2 | ✅ | — (el plugin solo es guard) | ✅ plugin | ✅ `opencode.json(c)` | ✅ edit/notebook_edit denegados | sin recordatorio de sesión por diseño |
| Qwen Code 0.28.4 | ✅ | ✅ / ❌ | ✅ | ✅ `.qwen/settings.json` + `qwen mcp approve` | solo instrucción | Qwen corre SubagentStart pero no pasa su texto al subagente |
| Kimi Code 2.7.3 | ✅ | — / — | ✅ (real: bloqueó; tras `disable` corrió, exit 7) | ✅ desde 0.6.1: `.mcp.json`, carpeta confiada o `KIMI_CODE_TRUST_WORKSPACE=1`, caché del lanzador caliente (`connect --approve`) | solo instrucción | Kimi descarta la salida de SessionStart; en 0.6.0 sus sesiones `-p` congelaban la lista de herramientas antes de que respondieran nuestros servidores |
| Antigravity (agy) 1.5.15 | ✅ | ✅ / — | ✅ (real: bloqueó y luego exit 7) | ✅ plugin de workspace; en headless hace falta `mcp(agent-workflow-mcp_aw-<tool>/*)` | solo instrucción | la regla de permiso MCP es de usuario; no hay regla por proyecto |
| Command Code 1.93 | ✅ | — en `-p` / — | ✅ | ✅ `.mcp.json` | solo instrucción | `-p` no corre SessionStart |
| Pi 1.6 | ✅ | ✅ / — | ✅ | ✅ `.pi/mcp.json`, proyecto confiado o `pi -a` | — (sin subagentes) | — |
| MiMo Code 0.1.16 | ✅ (su `AGENTS.md` o el de Claude) | ✅ / — | ✅ | ✅ `mimocode.json(c)` | ✅ desde 0.6.0 (`mode: all`, edit/notebook_edit denegados) | — |
| DeepSeek Harness 0.2.2-rc.5 | ✅ | ✅ / ✅ (puente + peer) | ✅ (real: bloqueó y luego exit 7) | ✅ desde 0.6.1 sin `--patch` (filas del perfil que leen `.dsh/agent-workflow-mcp.json`) | — (los presets no son archivos) | los hooks necesitan `@deepseek-ai/dsh-hook-protocol` en el perfil; perfil web: los servidores conectan, uso por el modelo no probado |

**Kimi (0.6.1).** Kimi 2.7.3 arma la lista de herramientas de toda la sesión `-p` al enlazar el perfil del agente, milisegundos después de arrancar los MCP; lo que llega después no entra. Por eso en el HOME real (0.6.0) no veía `aw-*` aunque había conectado los tres servidores. `agent-workflow mcp` ahora arranca un frente ligero que responde `initialize` y el primer `tools/list` desde una caché (`<store>/mcp-cache/<tool>.json`) y pasa todo al servidor real; con la caché caliente responde en ~30 ms. `connect --approve` con Kimi la calienta. No toca la confianza de la carpeta: sigue haciendo falta "Trust this folder" o `KIMI_CODE_TRUST_WORKSPACE=1`.

**dsh (0.6.1).** dsh no tiene capa de configuración de proyecto (solo bundles, el parche del perfil, el de `$DSH_HOME` y `--patch`). El `sync` mete en el bloque de cada perfil una fila `@deepseek-ai/dsh-mcp-client` por módulo, que solo se activa si el directorio donde arranca dsh tiene `.dsh/agent-workflow-mcp.json` (lo escribe `connect`) con ese servidor. Así `dsh headless` o `dsh web` en el repo cargan el MCP sin `--patch`. El archivo `.dsh/agent-workflow.cordis.yml` de 0.6.0 se retira en el siguiente `connect` si no se editó.

## Clientes adicionales

```sh
agent-workflow sync --global --clients all --dry-run
agent-workflow sync --global --clients all
agent-workflow verify
```

`all` equivale a `claude,codex,opencode,qwen,kimi,agy,commandcode,pi,mimo,dsh`. Sobre una instalación de los tres clientes de siempre, este `sync` añade los nuevos sin desinstalar. Para quitar alguno: `uninstall --global` y volver a instalar con la lista nueva. `connect`/`disconnect` (MCP por proyecto) siguen siendo solo para claude, codex y opencode. ZCode y Cursor quedaron fuera por decisión del dueño.

| Cliente | Regla | Skill | Roles | aw-start | Hook | Guard de validación (0.5.0) |
| --- | --- | --- | --- | --- | --- | --- |
| qwen | `~/.qwen/QWEN.md` | `~/.agents/skills` | `~/.qwen/agents` | `/aw-start` | SessionStart, SubagentStart y PreCompact en `~/.qwen/settings.json` (SubagentStart corre, pero Qwen 0.28.4 **no** pasa su texto al subagente; el subagente recibe la regla solo por el archivo global) | `PreToolUse` (matcher `run_shell_command`) en el mismo archivo |
| kimi | `~/.kimi-code/AGENTS.md` | `~/.agents/skills` | `~/.kimi-code/agents` | skill `aw-start` | no (Kimi descarta la salida de SessionStart) | `PreToolUse` (matcher `^Bash$`) en un bloque administrado al final de `~/.kimi-code/config.toml` |
| agy | `~/.gemini/GEMINI.md` | `~/.gemini/config/skills` | `~/.gemini/config/agents` | skill `aw-start` | SessionStart en `~/.gemini/config/hooks.json` (grupo `agent-workflow`) | `PreToolUse` (matcher `run_command`) en el mismo grupo (0.6.0); responde `{"decision":"deny","reason":…}` |
| commandcode | `~/.commandcode/AGENTS.md` | `~/.agents/skills` | `~/.commandcode/agents` | `/aw-start` | SessionStart en `~/.commandcode/settings.json` | `PreToolUse` (matcher `^SHELL$`) al final, después de las entradas que ya hubiera (la `.*` de Orca no se toca ni se reordena) |
| pi | `~/.pi/agent/AGENTS.md` | `~/.agents/skills` | (Pi no tiene subagentes) | prompt `/aw-start` | extensión `~/.pi/agent/extensions/agent-workflow.js` | la misma extensión: `tool_call` de `bash` → `{block: true, reason}` |
| mimo | `~/.config/mimocode/AGENTS.md` o, si MiMo lee `~/.claude/CLAUDE.md`, el bloque de Claude | `~/.agents/skills` | `~/.config/mimocode/agents` | `/aw-start` | plugin `~/.config/mimocode/plugins/agent-workflow.js` | el mismo plugin: `tool.execute.before` de `bash`/`exec_command` → `cancel` |
| dsh | `~/.dsh/AGENTS.md` | `~/.agents/skills` (dsh lo escanea) | no (los presets de dsh son filas de plugin, no archivos) | skill `~/.dsh/skills/aw-start` | SessionStart y SubagentStart vía el puente `@deepseek-ai/dsh-hooks-claude-code` (ver abajo) | `PreToolUse` (matcher `^bash$`) en el mismo `hooks.json` del puente |

**DeepSeek Harness (dsh).** Los hooks pasan por el puente oficial `@deepseek-ai/dsh-hooks-claude-code`, que lee un `hooks.json` con formato Claude. Agent Workflow es dueño de `<store>/dsh/hooks.json` y añade al final del `cordis.patch.yml` de cada perfil (`~/.dsh/profiles/<p>/`; nunca `cordis.yml`) un bloque YAML administrado con una fila `insert` que monta el puente con `configPath` a ese archivo. Una fila suelta sin `id` la rechaza el loader de dsh; por eso es `insert`. Si el archivo era solo `[]`, el bloque ocupa su lugar y al desinstalar vuelve `[]`. El puente necesita su peer `@deepseek-ai/dsh-hook-protocol` de la misma versión, que el paquete `dsh` no trae y pnpm no instala: sin él la entrada no se activa ("1 entry did not activate"). El instalador solo monta el bloque en los perfiles que tienen los dos paquetes y, para los demás, avisa con el comando exacto, por ejemplo `dsh plugin --profile headless add -w @deepseek-ai/dsh-hooks-claude-code@0.2.2-rc.5 @deepseek-ai/dsh-hook-protocol@0.2.2-rc.5`; después, `agent-workflow sync --global`. No instala nada en los perfiles.

**MiMo y `CLAUDE.md`.** MiMo carga solo el primero que exista de `~/.config/mimocode/AGENTS.md` y `~/.claude/CLAUDE.md`. Si no tienes el primero, crearlo haría que MiMo dejara de leer tus reglas de Claude, así que el instalador no lo crea: MiMo recibe el bloque por `CLAUDE.md` (instala también el cliente `claude`). Si ya tienes `~/.config/mimocode/AGENTS.md`, el bloque va ahí. `install` y `verify` lo dicen en `notices`.

**Codex tras un `sync`.** Codex solo ejecuta un hook si `hooks.state."<clave>".trusted_hash` de `~/.codex/config.toml` coincide con el hash actual del hook. Si cambia su comando, deja de ejecutarlo hasta que lo apruebes otra vez. Dos formas:

- **Automática (0.5.1):** `agent-workflow trust --client codex` (antes, `--dry-run` muestra qué confiaría). Hace lo mismo que aprobar en `/hooks` y por el mismo camino: habla con `codex app-server` (`hooks/list` y `config/batchWrite`), y es Codex quien escribe `config.toml`. Solo confía los hooks de Agent Workflow (comando = shim + runtime del store, en tu `~/.codex/hooks.json`); los de Orca, warp u otros, y su `trusted_hash`, no se tocan. Tampoco cambia `enabled`: si apagaste un hook en `/hooks`, sigue apagado. Muestra el estado antes y después. Si `codex` no existe o app-server falla, da error y no cambia nada.
- **En el mismo sync:** `agent-workflow sync --global --clients ... --trust-codex` confía los hooks justo después de escribir `hooks.json`. Es opcional y explícito; sin la opción, `sync` no toca la confianza. Si la confianza falla, el sync queda hecho y la salida es 1 con `codexTrust.error`.
- **A mano:** abre Codex, `/hooks`, revisa y confía SessionStart, SubagentStart, PreCompact y, si usaste `--guard codex`, PreToolUse.

Añadir o quitar el guard no cambia el comando ni la posición de los otros tres, así que su aprobación sigue valiendo. `verify` y `doctor` sacan el estado de `codex app-server` cuando `codex` está disponible (`codexHookTrust.source: "codex app-server"`, con `trustStatus` y `enabled` de Codex) y avisan en `warnings` con `codex-hook-untrusted`, `codex-hook-modified` (hash viejo) o `codex-hook-disabled` (`enabled = false`); no cambian `ok`. Sin `codex` leen `config.toml`: falta de `enabled` significa activo (como en Codex), y solo avisan si falta `trusted_hash` o hay `enabled = false`; si el hash guardado sigue valiendo no se puede saber sin Codex (`hashChecked: false`). 0.5.0 daba un falso `codex-hook-not-enabled` cuando faltaba `enabled = true`; ya no existe. `AGENT_WORKFLOW_CODEX=RUTA` elige el ejecutable y `AGENT_WORKFLOW_CODEX=none` fuerza la lectura del TOML. Nunca se usa `--dangerously-bypass-hook-trust`. Command Code también puede pedir confiar los hooks por proyecto.

**agy colgado en modo headless.** Si `agy -p` espera hasta el timeout, mira su log (`~/.gemini/antigravity-cli/log/cli-*.log`): `MCP: 2 server(s) still connecting ... context7_api, huggingface`. Esos dos tienen `"disabled": true` en `~/.gemini/config/mcp_config.json` y aun así agy 1.5.15 los espera. Para pruebas, `--gemini_dir RUTA/.gemini` usa otra carpeta de config sin perder la sesión. Para el uso diario, la solución es quitar esas dos entradas de `mcp_config.json` (decisión tuya; Agent Workflow no lo toca).

### Probar cada cliente

Desde un proyecto de prueba cuyo `npm test` falle con un código conocido (por ejemplo `process.exit(7)`), con el modelo y esfuerzo por defecto del cliente:

- P1 (visibilidad): «Without running anything: what global or session instructions do you have about 'Agent Workflow' or 'aw-workflow'? Quote the literal text if you have it; otherwise answer NONE.»
- P2 (comportamiento): «Run this project's tests and tell me whether they pass and with which exit code.»
- P3: `agent-workflow disable --project .` y repetir P1. El texto del hook («Agent Workflow is enabled here…») debe desaparecer; la regla y el skill siguen visibles.

| Cliente | Comando headless |
| --- | --- |
| qwen | `qwen "PROMPT" -o stream-json --approval-mode yolo` |
| kimi | `kimi -p "PROMPT" --output-format stream-json` (no combina `-p` con `--auto`) |
| agy | `agy -p "PROMPT" --output-format stream-json --print-timeout 200s` (con el cuelgue de MCP de arriba, añade `--gemini_dir` a una copia sin esos MCP) |
| commandcode | `commandcode -p "PROMPT" --output-format json --trust --skip-onboarding --no-session --yolo` (sin `--yolo` no ejecuta shell en `-p`) |
| pi | `pi -p --mode json --no-session "PROMPT"` |
| mimo | `mimo run --format json --dangerously-skip-permissions --dir . "PROMPT"` |

**Probar el guard (0.5.0).** Con P2 el modelo puede correr `npm test` directo y no tocar el guard. Para verlo actuar, pide el comando compuesto: «Run exactly this shell command in one tool call, without changing it: npm test; echo "exit=$?" . Then tell me whether the tests pass, with which exit code, and every shell command you ran.» El resultado esperado es un bloqueo con `AW_VALIDATION_COMPOUND`, y después `npm test` directo o una forma permitida, con exit 7. Sin tocar tu config se puede probar así: Command Code con un `.commandcode/settings.json` en el proyecto y `--trust`, Pi con `pi -e RUTA/extensions/agent-workflow.js`, MiMo con `MIMOCODE_CONFIG_DIR` y Claude con `claude -p ... --settings ARCHIVO.json`. Qwen pide aprobar en modo interactivo los hooks de proyecto, y Kimi y Codex solo leen hooks globales (Codex además pide aprobarlos), así que esos tres se prueban después del `sync` global.

Una pregunta abierta como P1 no es concluyente por sí sola: en MiMo el modelo respondió «solo el skill» y, preguntado por una palabra testigo del mismo archivo, la citó. Si una respuesta dice NONE, confirma con un texto exacto del bloque. Comprobaciones sin modelo: `agy agents`, `mimo agent list`, `mimo debug skill`, `commandcode skills list`. Ojo: `mimo debug config` imprime la configuración resuelta con claves de MCP en claro; no la pegues en logs.

## Conectar y desactivar por proyecto

Los MCP predeterminados son **Serena, CodeGraph y Context7**. Los de navegador se eligen explícitamente. Agent-browser se usa mediante CLI/skill y no añade un MCP por defecto.

```sh
agent-workflow connect --project /ruta/raiz --clients claude,codex --dry-run
agent-workflow connect --project /ruta/raiz --clients claude,codex
agent-workflow disconnect --project /ruta/raiz --clients claude,codex

# 0.6.0: todos los clientes y, opcional, aprobación por la vía del cliente
agent-workflow connect --project /ruta/raiz --clients all --approve
agent-workflow disconnect --project /ruta/raiz --clients all
```

Usa la raíz Git para conectar, desconectar o imprimir configuración. No aceptamos una subcarpeta y la convertimos silenciosamente en raíz. El registro se aplica a esa raíz; no representa dinámicamente los opt-out de todas sus subcarpetas.

Los archivos nativos son `.mcp.json` (Claude, y desde 0.6.0 también Command Code y Kimi, que lo leen), `.codex/config.toml`, `opencode.jsonc`/`opencode.json`, `.qwen/settings.json`, `.pi/mcp.json`, `mimocode.json(c)`, el plugin de workspace de agy `.agents/plugins/agent-workflow-mcp/` y, para dsh, `.dsh/agent-workflow-mcp.json` (desde 0.6.1 lo cargan solas las filas que el `sync` pone en cada perfil cuando dsh arranca en el proyecto; ya no hace falta `--patch`). Qué aprueba cada cliente y cómo: [compatibilidad](compatibility.md#project-mcp-060). `--approve` usa solo mecanismos oficiales no interactivos (Claude: `enabledMcpjsonServers` en `.claude/settings.local.json`; Qwen: `qwen mcp approve`); el resultado de `connect` lista lo que falta en los demás (Kimi: `KIMI_CODE_TRUST_WORKSPACE=1` o confiar la carpeta, y con `--approve` se calienta la caché del lanzador; Pi: `pi -a` o confiar el proyecto; agy: la regla `mcp(agent-workflow-mcp_aw-<tool>/*)` en `~/.gemini/antigravity-cli/settings.json`; Codex: proyecto confiado). Si esos archivos son solo de tu máquina, añádelos a `.git/info/exclude` (no se comparte y no toca `.gitignore`). Se conserva la ruta originalmente administrada. Si cambias el archivo de configuración que tiene prioridad en OpenCode, primero desconecta y luego conecta de nuevo. Los cambios en entradas propias se detienen para revisión.

El opt-out se comprueba al arrancar el MCP; no revoca servidores ya abiertos. Reinícialos después de cambiarlo. Dentro de Git la búsqueda del interruptor termina en la raíz del repo. Fuera de Git busca en los directorios superiores hasta la raíz del sistema. El cliente puede seguir descubriendo las skills globales aunque el flujo esté desactivado.

### Worktrees (Orca y `git worktree`)

- **`connect` desde un worktree** registra la raíz de ese worktree, no la del clon principal.
- **Un `.mcp.json` copiado o versionado** guarda la ruta del clon donde se conectó. Al arrancar, el lanzador mira el directorio actual: si es otro worktree del mismo repo (mismo directorio Git común), sirve ese worktree y lo avisa por stderr. Si el directorio no pertenece al repo, usa la ruta registrada. Esto depende de que el cliente arranque el MCP con el cwd del proyecto; no se comprobó en clientes reales.
- **`.agent-workflow.json` sin trackear no llega a los worktrees.** Un worktree nuevo solo trae lo versionado, así que un `disable` hecho en el clon principal no aplica ahí: el worker recibe "enabled". Versiona el archivo, o ejecuta `agent-workflow disable --project RUTA_DEL_WORKTREE` en cada worktree.
- **Si borras un worktree conectado**, su recibo queda huérfano y `uninstall --global` se detiene diciendo qué proyecto falta. `agent-workflow disconnect --prune --dry-run` muestra los recibos cuyo proyecto ya no existe y `disconnect --prune` los olvida. No toca otros clones. `doctor` también los lista en `connections`.

## Navegador

Primero lee la guía de la versión instalada:

```sh
agent-workflow exec --tool agent-browser -- skills get core
```

El agente debe elegir un Chrome/Chromium existente, una sesión con nombre único, separada y sin ventana, y cerrarla al terminar. **El comando genérico `exec` sólo reenvía los argumentos; no impone ese aislamiento.** Son instrucciones del flujo. No debe tomar tu navegador personal ni descargar otro sin autorización.

Si decides descargar Chrome, la acción explícita es `agent-workflow exec --tool agent-browser -- install`. Si eliges `setup --tools playwright --apply`, ese módulo ejecuta `playwright install chromium`. El tamaño de la herramienta no incluye necesariamente el navegador ni representa su RAM.

## Actualizar y desinstalar

Antes de actualizar, conserva tu trabajo, haz `git fetch`, revisa los cambios y avanza con `git merge --ff-only origin/main`. Después instala dependencias, comprueba, reinstala el CLI, previsualiza/sincroniza y verifica. La portada muestra los comandos completos. Si hay divergencia, se revisa; no se descarta con reset.

Una instalación npm desde una ruta local puede depender del checkout. No lo muevas sin planear la reinstalación. Si cambia la ruta del paquete o de Node, desconecta los proyectos antes y vuelve a conectarlos después.

### Tras cambiar de Node

Los hooks se ejecutan con un shim estable, `<store>/bin/node`, que guarda el Node con el que se hizo el último `sync`. Con nvm, `npm link` (o `npm install --global .`) va por versión de Node. Por eso, al hacer `nvm use` a otra versión puede desaparecer el comando `agent-workflow`. Y si borras la versión guardada, el shim usa el `node` del PATH; si no hay ninguno, sale con 0 y no da contexto. `verify` y `doctor` avisan con `hook-node-missing` (o `hook-runtime-missing`) y dan el arreglo:

```sh
cd /ruta/a/agent-workflow   # tu clon
npm link                    # con el Node que vas a conservar
agent-workflow sync --global --dry-run
agent-workflow sync --global
agent-workflow verify
```

Las instalaciones de 0.3.0 o anteriores llaman al Node por ruta absoluta. El primer `sync` con 0.3.1 las pasa al shim. Los registros MCP de proyecto también guardan el Node y la ruta del clon: desconéctalos y vuelve a conectarlos después del cambio.

Para retirar: desconecta todos los proyectos, ejecuta `uninstall --global --dry-run`, `uninstall --global` y después desinstala el paquete npm. Si quedan registros de proyectos, el desinstalador se detiene. No borra herramientas descargadas, caches compartidas, ejecutables reutilizados ni los interruptores de proyecto. No existe un comando de purga automática de herramientas.

## Errores y datos privados

- **Lock existente:** comprueba si la operación sigue viva antes de tocarlo; no repitas instalaciones de efecto incierto.
- **Archivo/bloque propio modificado o eliminado:** conserva la edición y reconcilia; no se sobrescribe a la fuerza.
- **MCP no aparece:** revisa raíz, aprobación y recarga del cliente; un archivo correcto no demuestra que se cargó.
- **Versión responde pero la herramienta falla:** prueba la operación concreta; pueden faltar runtime, navegador o autenticación.
- **Registro privado corrupto:** conserva archivos para recuperar manualmente; no inventes la configuración original.

El directorio del usuario `.local/share/agent-workflow/` contiene originales de configuración, registros de conexiones, locks, recibos y herramientas. No lo subas al repo: puede contener ajustes privados. Los nuevos respaldos llevan checksum de consistencia; no protege contra alguien que pueda modificar también ese registro privado. Los recibos antiguos sin checksum siguen admitiéndose para retirarlos.

Los modelos, effort, permisos y compactación del cliente no se cambian. La memoria compartida sigue teniendo un único coordinador. Consulta la [auditoría](audit-2026-11-13.md) y las [pruebas](testing.md) para distinguir lo comprobado de lo pendiente.

## Protección de validación y archivos de módulos

Desde 0.5.0 el mismo guard (una sola fuente: `shellGuard` de `gate.mjs` + `validation-guard.mjs` del runtime instalado) actúa antes del shell en estos clientes:

| Cliente | Mecanismo | Cómo bloquea |
| --- | --- | --- |
| OpenCode V2 | plugin, `shell.create.before` | lanza el error `AW_VALIDATION_COMPOUND` |
| Qwen, Command Code, Kimi | hook `PreToolUse` (`hook.mjs --client NOMBRE`) | `hookSpecificOutput.permissionDecision: "deny"` con el motivo |
| Pi | extensión, `tool_call` | `{block: true, reason}` |
| MiMo | plugin, `tool.execute.before` | `output.cancel = true` y `cancelReason` |
| Antigravity (agy) | hook `PreToolUse`, matcher `run_command` (0.6.0) | `{"decision":"deny","reason":…}` |
| DeepSeek Harness (dsh) | hook `PreToolUse` del puente, matcher `^bash$` (0.6.0) | igual que Qwen |
| Claude Code | hook `PreToolUse`, matcher `Bash` | igual que Qwen; **activo por defecto desde 0.6.0** (`--guard none` lo quita) |
| Codex | hook `PreToolUse`, matcher `Bash` | igual que Qwen; con `--trust-codex` (o `--guard codex`) |

**Claude y Codex en 0.6.0.** En 0.5.x eran opcionales porque `cd dir && npm test` quedaba bloqueado (el Bash de Claude no tiene opción de directorio) y Codex pide aprobar cada hook nuevo. Desde 0.6.0 se permite un `cd DIR &&` al principio (el estado sigue visible: si el `cd` falla, la cadena termina con su error), y una batería de 50 comandos reales de agentes pasada por los hooks instalados de Claude y Codex dio 0 falsos positivos y 0 falsos negativos (`tests/fixtures/guard-battery.mjs`). Por eso el de Claude va activo por defecto y el de Codex llega con `--trust-codex`. Quedan bloqueados a propósito `npm run build && npm test` y `npm ci && npm test` (dos pasos: ejecútalos por separado). La elección queda en el manifiesto (`guard`); una instalación 0.5.x sin guard recibe el valor por defecto en el siguiente `sync`, y una que eligió `--guard` lo conserva.

**Kimi.** Sus hooks viven en `~/.kimi-code/config.toml` (tablas `[[hooks]]`); no tiene un JSON aparte. El instalador añade un bloque entre `# agent-workflow:begin` y `# agent-workflow:end` al final del archivo y no toca el resto (tampoco el bloque de Orca). Si el TOML no es válido, no lo sobrescribe. Si Kimi reescribe el archivo y pierde los comentarios marcadores, `verify` lo marca y `uninstall` se niega: en ese caso quita a mano la entrada `[[hooks]]` de Agent Workflow.

Con el workflow activo, en todos estos clientes se rechazan las validaciones reconocidas que incluyan pipes, separadores o condicionales; ejecuta el test solo y usa el directorio del propio tool.

Reconoce como validación los scripts de npm/pnpm/yarn/bun, los runners vía `npx`/`pnpm exec`/`bunx`, `uv run`/`poetry run`, pytest/jest/vitest, `node --test`, `node <archivo de test>` (`test.js`, `tests/…`, `*.spec.ts`), el comando de un script `test`/`check`/`build` de un solo comando del `package.json` del directorio (lo lee, no lo ejecuta), cargo/go/dotnet, las tareas de test de gradle/`./gradlew`, `make [-C DIR] test|check|build` y los scripts de `bash -c`/`sh -c` (los revisa por dentro). Deja pasar dos formas que conservan el estado (también tras `cd DIR &&`):

- `set -o pipefail; CMD | tail` (también `set -euo pipefail`): el pipeline devuelve el primer fallo;
- `CMD > log 2>&1; echo "exit=$?"`: la salida completa queda en un archivo y se imprime el estado. Sin la redirección, `CMD; echo $?` sigue bloqueado.

`CMD | tail; exit ${PIPESTATUS[0]}` ya no se acepta (0.6.0): `PIPESTATUS` solo existe en bash, y Claude Code y Codex ejecutan en zsh en macOS, donde esa forma sale con 0 y oculta el fallo (se vio en una prueba real de Claude). Cualquier cosa después de esas formas, `;` tras un `cd`, otros `&&`/`||` y los procesos en segundo plano siguen bloqueados. El opt-out se vuelve a consultar en cada llamada. Es un guard limitado, no un parser universal ni un sandbox de permisos.

El MCP de CodeGraph incorpora `agent_workflow_symbols` para un archivo JS/TS explícito, incluyendo `.mjs`, `.cjs`, `.mts` y `.cts`. Usa TypeScript como requisito, devuelve nombres y posiciones originales y no ejecuta el módulo. Rechaza rutas fuera del proyecto, errores sintácticos y archivos mayores a 1 MiB. El resultado identifica su fuente y no afirma tener relaciones de grafo. El motor original de CodeGraph sigue teniendo su límite de extensiones.
