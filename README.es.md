# Agent Workflow

Paquete global de reglas y procedimientos para Claude Code, Codex CLI y OpenCode V2 (por defecto), y a petición para Qwen Code, Kimi Code, Antigravity CLI, Command Code, Pi, MiMo Code y DeepSeek Harness (dsh), con desactivación por proyecto, generación Rulesync y retirada reversible.

[English](README.md) · [Arquitectura](docs/architecture.md) · [Compatibilidad y límites](docs/compatibility.md) · [Pruebas](docs/pruebas.es.md)

No es un orquestador que trabaje solo. Incluye reglas breves, la skill `aw-workflow`, los roles opcionales `aw-worker` y `aw-reviewer`, un comando de inicio donde el cliente lo admite, recordatorios de inicio/compactación y diagnóstico de herramientas. Respeta las reglas del proyecto y los modelos elegidos por el usuario.

## Instalación global

Requiere Node.js 22.22.0 o superior y npm, además de acceso Git al repositorio privado. No pegar tokens en comandos o archivos.

```sh
git clone https://github.com/lomeli-dev/agent-workflow.git
cd agent-workflow
npm ci --ignore-scripts
npm run check
npm install --global . --ignore-scripts
agent-workflow install --global --dry-run
agent-workflow install --global
agent-workflow verify
```

La instalación npm registra el CLI; `install --global` añade las piezas a los clientes. Por defecto instala claude, codex y opencode. `--clients claude,codex` permite elegir. No necesita sudo ni cambia permisos/modelos de tus agentes.

### Más clientes

```sh
agent-workflow sync --global --clients all --dry-run
agent-workflow sync --global --clients all
agent-workflow verify
```

`all` suma `qwen`, `kimi`, `agy`, `commandcode`, `pi`, `mimo` y `dsh` a los tres de siempre; una lista con comas elige algunos. Un `sync` puede añadir clientes a una instalación existente; quitar uno exige `uninstall` antes. Cada cliente recibe lo que soporta de forma nativa: bloque de reglas, el skill compartido `~/.agents/skills/aw-workflow` (agy lleva su propia copia), roles, `aw-start` y un hook de sesión. Kimi no lleva hook de sesión (descarta la salida de SessionStart). dsh recibe `~/.dsh/AGENTS.md`, el skill `aw-start` y hooks a través de su puente oficial `@deepseek-ai/dsh-hooks-claude-code`, montado en cada perfil que tenga el puente y su peer `@deepseek-ai/dsh-hook-protocol` (si falta, un aviso da el comando `dsh plugin --profile P add -w ...`). Antigravity se verificó con una sesión headless real; en operaciones está cómo correrlo sin el cuelgue de MCP. La tabla por cliente, la precedencia de `CLAUDE.md` en MiMo y lo verificado en cada cliente están en [compatibilidad](docs/compatibility.md#extra-clients-040) y en [operaciones](docs/operaciones.es.md#clientes-adicionales).

**Guard de validación.** Antes de ejecutar shell, Qwen, Kimi, Antigravity, Command Code, Pi, MiMo, dsh y Claude Code (y OpenCode, como antes) bloquean un comando de test/build cuyo código de salida quedaría oculto por un pipe, un `;` o un `echo` posterior, y le dicen al modelo las formas permitidas (`set -o pipefail; CMD | tail`, `CMD > log 2>&1; echo "exit=$?"`, también tras `cd DIR &&`). Desde 0.6.0 el de Claude viene activo por defecto y el de Codex con `--trust-codex`; `--guard claude,codex|none` fija la elección y un `sync` conserva la registrada. Ya no se acepta `CMD | tail; exit ${PIPESTATUS[0]}`: zsh, el shell de Claude Code y Codex en macOS, no tiene `PIPESTATUS` y sale con 0. Los proyectos desactivados nunca se bloquean. Detalle y evidencia por cliente: [operaciones](docs/operaciones.es.md#protección-de-validación-y-archivos-de-módulos).

Tras un `sync` que cambie los hooks, Codex no los ejecuta hasta que los vuelvas a aprobar: `agent-workflow trust --client codex` lo hace igual que `/hooks`, solo para los hooks de Agent Workflow (o pasa `--trust-codex` al `sync`); también puedes usar `/hooks` a mano. `verify` lee el estado de `codex app-server` si `codex` está disponible y avisa con `codex-hook-untrusted`, `codex-hook-modified` o `codex-hook-disabled`. No se salta la confianza.

### Sesión opcional de Claude con menos contexto MCP

```sh
agent-workflow claude-lean --
agent-workflow claude-lean -- --print "Explica este proyecto"
agent-workflow claude-lean --mcp-file /ruta/a/mcp-seleccionados.json --
```

Sin `--mcp-file`, **esa sesión no dispone de servidores MCP configurados**.
Con el archivo, sólo carga los servidores indicados en ese JSON de MCP de
Claude; conserva las credenciales fuera del archivo. No modifica tu
configuración habitual, modelos, permisos ni otras sesiones. Requiere Claude
Code instalado y autenticado. Pon sus opciones después de `--` y el archivo
MCP antes; para recuperar tus servidores habituales abre `claude` normalmente.

En una exploración de tres saludos en una Mac bajó la mediana del contexto al
usar una lista MCP vacía, pero también cambiaron las herramientas disponibles
y hubo variaciones de caché y arranque. No es una garantía de ahorro económico
ni de capacidades equivalentes. [Estudio y límites](docs/estudio-contexto.es.md).

Rulesync está fijado a 43.8.0 y genera primero en una carpeta temporal. El instalador añade sólo sus archivos, bloques y entradas identificadas; conserva los demás ajustes, hooks y skills. Si encuentra una colisión, un enlace simbólico de destino o un archivo propio editado, se detiene en vez de sobrescribirlo.

**El cliente puede pedir aprobación de hooks o reinicio.** No se salta esa aprobación. `verify` comprueba los archivos, no demuestra que una sesión abierta ya los haya cargado.

## Desactivar en un proyecto

```sh
agent-workflow disable --project /ruta/del/proyecto
agent-workflow status --project /ruta/del/proyecto --json
agent-workflow enable --project /ruta/del/proyecto
```

Se escribe `.agent-workflow.json` con `schemaVersion: 1` y `enabled: false` o `true`. Se usa la raíz Git o, fuera de Git, la carpeta indicada. Puedes versionar ese archivo o mantenerlo local. La configuración más cercana hasta la raíz gana; si está mal formada, el flujo se desactiva. Una sesión que conserva el estado anterior debe recargarse.

La desactivación evita aplicar nuestro flujo y nuestros recordatorios. **No garantiza que el IDE deje de listar las skills o leer el pequeño bloque global.** Tampoco desactiva tus otras reglas, herramientas o integraciones.

## Herramientas opcionales

```sh
# Navegador predeterminado (sin descargar Chrome):
agent-workflow setup --profile web --apply
# Menú para elegir uno, varios o todos:
agent-workflow setup --interactive --apply
# Lista, selección directa y categorías:
agent-workflow setup --list
agent-workflow setup --tools serena,codegraph --apply
agent-workflow setup --profile web --apply
agent-workflow setup --all --apply
agent-workflow doctor --json
```

**Playwright con Chromium se instala por separado.** Ya no entra con `--all`, `todo` en el menú ni con el perfil `web`:

```sh
agent-workflow setup --tools playwright --apply
```

Ese comando ejecuta `playwright install chromium`: Playwright descarga los navegadores en la carpeta administrada. CLI y MCP siguen siendo opciones separadas; excluir el motor no borra lo ya instalado ni impide que una herramienta de navegador necesite un runtime al usarse.

Sin `--apply` sólo muestra el plan. El menú acepta números, nombres o `all`/`todo`; una selección vacía cancela. Categorías: `lsp`, `code`, `web`, `docs`, `delivery`. Son 17 módulos: seis servidores de lenguaje, ast-grep, Serena, CodeGraph, agent-browser de Vercel, Playwright motor/CLI/MCP, DevTools MCP, Context7, GitHub CLI y Gitleaks.

**Quedan fuera los linters, formateadores independientes y servicios de tareas persistentes.** Algunos LSP ofrecen formato como capacidad propia, pero no lo activamos ni reformateamos archivos. Una tarea persistente sería un proceso que continúa aunque cierres la terminal, como con tmux: este instalador no configura eso.

Se reutiliza lo que ya responde, mostrando su versión real. Lo que falta se instala con versiones fijadas en una carpeta administrada del usuario. Se necesitan Node/npm; para sus módulos correspondientes, Go, uv y un toolchain Rust. Si falta un requisito, se informa sin instalar silenciosamente todo un entorno. No se cambia el perfil de shell.

Los ejecutables son globales; conectas los MCP que necesitas **por proyecto**:

```sh
agent-workflow connect --project /ruta/al/proyecto --tools serena,codegraph --dry-run
agent-workflow connect --project /ruta/al/proyecto --tools serena,codegraph
agent-workflow disconnect --project /ruta/al/proyecto
agent-workflow exec --tool ast-grep -- --version
```

MCP disponibles: `serena`, `codegraph`, `playwright-mcp`, `devtools`, `context7`. Los tres clientes base son el destino predeterminado; `--clients claude,codex` lo limita y `--clients all` añade qwen, kimi, agy, commandcode, pi, mimo y dsh (archivos por cliente en [compatibilidad](docs/compatibility.md#project-mcp-060)). `--approve` (opcional) además los aprueba por la vía oficial del cliente cuando existe una no interactiva (Claude, Qwen); el resultado dice qué falta en los demás. Excluye de los commits lo que sea local con `.git/info/exclude`. Después recarga el cliente y acepta sus herramientas. Se conservan entradas ajenas y comentarios. Desconecta los proyectos antes de desinstalar.

Instalar no demuestra que un cliente haya cargado el MCP ni configura automáticamente su integración LSP. Consulta [herramientas y evidencia](docs/tools.md).

## Actualizar y retirar

Primero actualiza el código, conservando tus cambios locales. Revisa antes de incorporar:

```sh
git fetch origin --tags
git log --oneline HEAD..origin/main
git diff HEAD..origin/main
git merge --ff-only origin/main
npm ci --ignore-scripts
npm run check
npm install --global . --ignore-scripts
agent-workflow sync --global --dry-run
agent-workflow sync --global
agent-workflow verify
```

Si las ramas divergen, se detiene; no uses reset para descartar trabajo. Para retirar:

```sh
agent-workflow uninstall --global --dry-run
agent-workflow uninstall --global
npm uninstall --global @lomeli-dev/agent-workflow
```

No borra configuraciones ajenas. Si editaste un archivo del paquete o su definición de hook, pide reconciliarlo antes. La copia privada de configuración original queda sólo en tu equipo y permite revertir. No se sube al repo. Las herramientas opcionales descargadas y carpetas vacías se conservan al retirar; no se eliminan recursos compartidos a ciegas.

## Cómo se mantiene

La fuente es `.rulesync`. `npm run build` genera para cada cliente. Los tests usan raíces de usuario temporales; no prueban borrando tus configuraciones reales. Hay un modo `--user-root` para repetir instalación/verificación/desinstalación aisladas sin modificar HOME.

Los roles heredan modelo/esfuerzo del cliente. No se alteran límites de compactación o permisos. Sólo el coordinador escribe la memoria existente cuando corresponda; los workers devuelven resultados, decisiones, descubrimientos y lecciones candidatas. No se promete ahorro porcentual sin mediciones de tareas comparables.

## Navegador predeterminado: Vercel agent-browser

`web` instala sólo `agent-browser 0.43.0`; `--all` también lo incluye. Playwright, Playwright CLI/MCP y DevTools quedan como alternativas de selección explícita. Lo que ya está instalado se conserva.

**Es una instrucción para el agente; el comando genérico `exec` sólo reenvía argumentos y no impone aislamiento.** La guía sincronizada dirige a los agentes a usar Chrome/Chromium existente, en una sesión separada sin ventana, y a cerrarla al terminar. Primero leen la guía de la versión instalada:

```sh
agent-workflow exec --tool agent-browser -- skills get core
```

Si falta un navegador, se informa; no se descarga automáticamente. La descarga opcional se hace con `agent-workflow exec --tool agent-browser -- install`. No se usa tu perfil personal ni se conecta a tu navegador abierto por defecto.

Se usa mediante CLI y skill; no añade herramientas MCP por defecto. `connect` sin selección conecta Serena, CodeGraph y Context7; las alternativas MCP de navegador se piden por nombre.

Guía completa: [instalación, actualización, uso y recuperación](docs/operaciones.es.md). [Auditoría y límites](docs/audit-2026-11-13.md).

En carpetas sin Git, el opt-out busca también en los directorios antecesores hasta la raíz del sistema. Para `connect`, `disconnect` y `mcp-config` usa la raíz del repositorio; no se promociona una subcarpeta automáticamente. Si conectaste sólo algunos clientes, repite el mismo `--clients` al desconectar.

[Prueba con agentes reales](docs/native-trial-2026-11-13.md): implementación, opt-out, roles, MCP y navegador, con sus resultados y límites.

La versión 0.6.0 añade el cliente DeepSeek Harness, el guard de Antigravity, MCP por proyecto en todos los clientes extra, el guard de Claude por defecto y una regla segura en zsh; ver el [changelog](CHANGELOG.md).

La versión 0.5.1 añade `agent-workflow trust --client codex` y `--trust-codex` (aprueban solo los hooks de Agent Workflow en Codex, como `/hooks`) y quita un falso aviso `codex-hook-not-enabled`; ver el [changelog](CHANGELOG.md).

La versión 0.5.0 lleva el guard de validación a Qwen, Kimi, Command Code, Pi y MiMo, y lo deja opcional para Claude y Codex (`--guard`); ver el [changelog](CHANGELOG.md).

La versión 0.4.0 añade seis clientes opcionales, avisa de hooks de Codex sin aprobar, amplía el guard de OpenCode a `node <archivo de test>` y al script de test del proyecto, y corrige un fallo de `uninstall` con JSON compacto; ver el [changelog](CHANGELOG.md).

La versión 0.3.1 hace que `uninstall` conserve lo editado después de un `sync`, ejecuta los hooks con un shim de Node estable, avisa en `verify` de una instalación desactualizada, contempla los worktrees (`disconnect --prune`) y alinea el guard de OpenCode con la regla; ver el [changelog](CHANGELOG.md).

La versión 0.2.3 añade un bloqueo nativo de validaciones compuestas en OpenCode y una búsqueda alternativa de símbolos JS/TS. [Correcciones comprobadas](docs/repairs-2026-11-13.md). Al elegir CodeGraph se comprueba o instala también TypeScript como requisito; esto no añade navegadores.
