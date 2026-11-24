# Agent Workflow

Paquete global de reglas y procedimientos para Claude Code, Codex CLI y OpenCode V2 (por defecto), y a petición para Qwen Code, Kimi Code, Antigravity CLI, Command Code, Pi, MiMo Code y DeepSeek Harness (dsh), con desactivación por proyecto, generación Rulesync y retirada reversible.

[English](README.md) · [Instalar todo en 5 minutos](#instalar-todo-en-5-minutos) · [Arquitectura](docs/architecture.md) · [Compatibilidad y límites](docs/compatibility.md) · [Operaciones](docs/operaciones.es.md) · [Pruebas](docs/pruebas.es.md)

No es un orquestador que trabaje solo. Incluye reglas breves, la skill `aw-workflow`, los roles opcionales `aw-worker` y `aw-reviewer`, un comando de inicio donde el cliente lo admite, recordatorios de inicio/compactación y diagnóstico de herramientas. Respeta las reglas del proyecto y los modelos elegidos por el usuario.

## Instalar todo en 5 minutos

Para una Mac limpia que ya tiene instalados algunos de los clientes. Cada paso es un comando y lo que hace; el detalle está en las secciones siguientes y en [operaciones](docs/operaciones.es.md).

**1. Requisitos.** Node.js 22.22.0 o superior (`node --version`), npm, Git con acceso al repositorio privado, y los clientes que vayas a usar instalados y con sesión iniciada (ábrelos una vez). En dsh, arranca un perfil una vez (`dsh headless`) para que exista `~/.dsh/profiles/headless`.

**2. Clonar e instalar el CLI.**

```sh
git clone https://github.com/lomeli-dev/agent-workflow.git
cd agent-workflow
npm ci --ignore-scripts                    # dependencias fijadas, sin scripts de instalación
npm install --global . --ignore-scripts    # registra el comando agent-workflow (enlaza esta carpeta)
```

Para desarrollo, `npm link` en lugar de la última línea. En los dos casos el comando apunta a este clon: no lo muevas ni lo borres.

**3. Instalar en todos los clientes.**

```sh
agent-workflow sync --global --clients all --all-in --dry-run   # qué archivos cambiaría y qué pasos haría
agent-workflow sync --global --clients all --all-in             # instala
agent-workflow verify                                           # comprueba archivos, registros y hooks
```

En una instalación nueva `install --global` y `sync --global` hacen lo mismo; `sync` además actualiza y añade clientes. `--all-in` (0.7.0) junta tres pasos opcionales, cada uno solo si su cliente está en `--clients`:

- `--trust-codex`: aprueba en Codex solo los hooks de Agent Workflow, igual que aprobarlos en `/hooks` (por `codex app-server`; los demás hooks no se tocan).
- `--dsh-plugins`: en cada perfil de dsh al que le falte el puente de hooks, ejecuta `dsh plugin --profile <p> add -w @deepseek-ai/dsh-hooks-claude-code@<v> @deepseek-ai/dsh-hook-protocol@<v>` con la versión de `dsh --version`, y lo registra para que `uninstall` lo quite. No reemplaza un paquete que ya tengas en otra versión.
- `--agy-allow`: añade a `~/.gemini/antigravity-cli/settings.json` los permisos `mcp(agent-workflow-mcp_aw-serena/*)`, `mcp(agent-workflow-mcp_aw-codegraph/*)` y `mcp(agent-workflow-mcp_aw-context7/*)`, sin duplicar los que ya tengas.

Guard de validación tras este paso: Qwen, Kimi, agy, Command Code, Pi, MiMo, dsh y OpenCode siempre; Claude por defecto; Codex porque `--all-in` incluye `--trust-codex` (solo en una instalación nueva: si ya instalaste sin él, añade `--guard claude,codex`). Los `sync` siguientes conservan la elección y lo que registraron `--dsh-plugins` y `--agy-allow`.

**4. Lo que sigue siendo manual.**

- **Llave de dsh.** dsh lee `DEEPSEEK_API_KEY`; Agent Workflow nunca la toca. Guárdala en el Llavero de macOS (la primera línea te la pide sin eco, así no queda en el historial) y pásala solo a dsh con una función en `~/.zshrc`:

  ```sh
  security add-generic-password -a "$USER" -s deepseek-api-key -w
  dsh() { DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-$(security find-generic-password -s deepseek-api-key -w 2>/dev/null)}" command dsh "$@"; }
  ```

- **Kimi: confiar la carpeta.** Kimi no arranca el MCP del proyecto en una carpeta sin confiar. Elige «Trust this folder» la primera vez que abras `kimi` en el proyecto, o ejecuta `KIMI_CODE_TRUST_WORKSPACE=1 kimi -p "..."` (vale solo para ese proceso). No hay un comando oficial que guarde la confianza de una carpeta; `[workspace] require_trust = false` en `~/.kimi-code/config.toml` la quita para todas, por eso el instalador no lo hace.
- **agy colgado en headless.** Si `agy -p` espera hasta el timeout y su log (`~/.gemini/antigravity-cli/log/cli-*.log`) dice `MCP: N server(s) still connecting`, son servidores con `"disabled": true` en `~/.gemini/config/mcp_config.json` que agy 1.5.15 espera igual: quita esas entradas (decisión tuya; Agent Workflow no edita ese archivo).
- **Codex tras otro `sync`.** Si un `sync` cambia los hooks, repítelo con `--trust-codex` (o `--all-in`) o ejecuta `agent-workflow trust --client codex`. `verify` avisa con `codex-hook-untrusted` o `codex-hook-modified`.
- **Codex y Pi por proyecto.** Codex carga `.codex/config.toml` solo en un proyecto confiado (acéptalo cuando pregunte); Pi lee `.pi/mcp.json` tras confiar el proyecto o con `pi -a`.

Sin `--all-in`, lo mismo a mano: `dsh plugin --profile <headless|web> add -w @deepseek-ai/dsh-hooks-claude-code@$(dsh --version) @deepseek-ai/dsh-hook-protocol@$(dsh --version)` y después `agent-workflow sync --global` (`-w` es `--workspace-root` de pnpm: cada perfil es la raíz de un workspace pnpm y pnpm se niega a añadir paquetes ahí sin esa opción); y en `~/.gemini/antigravity-cli/settings.json`, mezclado con lo que ya haya, `{"permissions": {"allow": ["mcp(agent-workflow-mcp_aw-serena/*)", "mcp(agent-workflow-mcp_aw-codegraph/*)", "mcp(agent-workflow-mcp_aw-context7/*)"]}}`.

**5. Activar Serena, CodeGraph y Context7 en un proyecto.**

```sh
agent-workflow connect --project /ruta/raiz --clients all --all-in --dry-run   # archivos que escribiría y qué excluiría
agent-workflow connect --project /ruta/raiz --clients all --all-in
```

Usa la raíz del repositorio y recarga cada cliente después. `connect --all-in` es `--approve` (aprueba por la vía oficial de cada cliente: Claude `enabledMcpjsonServers`, `qwen mcp approve`, y calienta la caché que necesita Kimi) más `--exclude` (añade a `$(git rev-parse --git-path info/exclude)` las rutas generadas que no estén versionadas ni ignoradas ya, en un bloque marcado que `disconnect` quita). Las rutas son `.mcp.json`, `.codex/config.toml`, `opencode.jsonc` (u `opencode.json` si existe), `.qwen/settings.json`, `.agents/plugins/agent-workflow-mcp/`, `.pi/mcp.json`, `mimocode.json` (o la variante que exista), `.dsh/agent-workflow-mcp.json` y `.claude/settings.local.json`. Las líneas que ya tengas, aunque sean `.codex/` o no empiecen por `/`, se detectan con `git check-ignore` y no se duplican.

A mano (sin `--exclude`), un one-liner equivalente que no duplica líneas y funciona en worktrees:

```sh
cd /ruta/raiz && x="$(git rev-parse --git-path info/exclude)" && mkdir -p "$(dirname "$x")" && for p in /.mcp.json /.codex/config.toml /opencode.jsonc /.qwen/settings.json /.agents/plugins/agent-workflow-mcp/ /.pi/mcp.json /mimocode.json /.dsh/agent-workflow-mcp.json /.claude/settings.local.json; do grep -qxF "$p" "$x" 2>/dev/null || echo "$p" >> "$x"; done
```

Si tu equipo versiona alguno de esos archivos, sácalo de la lista: `info/exclude` no afecta a lo que ya está versionado.

**6. Comprobar que funciona.** En una sesión nueva de cada cliente, dentro de un proyecto:

- Testigo: «Without running anything: in your session instructions, what is the word right after "for substantial coding tasks load"? Answer with that word only.» Esperado: `aw-workflow`. Kimi, OpenCode y Command Code en `-p` no tienen ese hook de sesión; pregúntales por la regla: «Without running anything: in your global instructions, which word comes right after "Use" in the sentence that continues "for a substantial coding task that needs coordination"? Answer with that word only.» (también `aw-workflow`).
- Guard: crea un proyecto cuyo test falla con 7 y pide el comando compuesto.

  ```sh
  mkdir -p /tmp/aw-prueba && cd /tmp/aw-prueba && git init -q && npm init -y > /dev/null && npm pkg set scripts.test="node -e 'process.exit(7)'"
  ```

  «Run exactly this shell command in one tool call, without changing it: npm test; echo "exit=$?" . Then tell me whether the tests pass and with which exit code.» Esperado: un bloqueo `AW_VALIDATION_COMPOUND` y después `npm test` directo (o una forma permitida) con exit 7.

Qué funciona en cada cliente y qué no: [estado por cliente](docs/operaciones.es.md#estado-por-cliente-061) (en inglés, [client status](docs/compatibility.md#client-status-061)).

**7. Actualizar, desactivar y desinstalar.**

```sh
# Actualizar (desde el clon)
git pull --ff-only
npm ci --ignore-scripts
npm install --global . --ignore-scripts         # o npm link
agent-workflow sync --global --clients all --all-in
agent-workflow verify

# Desactivar el flujo en un proyecto (enable lo revierte)
agent-workflow disable --project /ruta/raiz

# Desinstalar: primero desconecta cada proyecto conectado
agent-workflow disconnect --project /ruta/raiz --clients all
agent-workflow uninstall --global --dry-run
agent-workflow uninstall --global
npm uninstall --global @lomeli-dev/agent-workflow
```

Antes de desinstalar, haz una copia de tus configuraciones (`~/.claude`, `~/.codex`, `~/.config/opencode`, `~/.gemini`, `~/.kimi-code`, `~/.dsh`…). `uninstall` quita solo lo propio, incluidos los permisos de agy y los paquetes dsh que añadió `--dsh-plugins`, y se detiene si editaste algo suyo. En el `sync` de actualización la lista de clientes no puede ser menor que la instalada.

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

`all` suma `qwen`, `kimi`, `agy`, `commandcode`, `pi`, `mimo` y `dsh` a los tres de siempre; una lista con comas elige algunos. Un `sync` puede añadir clientes a una instalación existente; quitar uno exige `uninstall` antes. Cada cliente recibe lo que soporta de forma nativa: bloque de reglas, el skill compartido `~/.agents/skills/aw-workflow` (agy lleva su propia copia), roles, `aw-start` y un hook de sesión. Kimi no lleva hook de sesión (descarta la salida de SessionStart). dsh recibe `~/.dsh/AGENTS.md`, el skill `aw-start` y hooks a través de su puente oficial `@deepseek-ai/dsh-hooks-claude-code`, montado en cada perfil que tenga el puente y su peer `@deepseek-ai/dsh-hook-protocol` (si falta, un aviso da el comando `dsh plugin --profile P add -w ...`; desde 0.7.0 `--dsh-plugins` o `--all-in` lo ejecutan y `uninstall` lo revierte). Antigravity se verificó con una sesión headless real; en operaciones está cómo correrlo sin el cuelgue de MCP. La tabla por cliente, la precedencia de `CLAUDE.md` en MiMo y lo verificado en cada cliente están en [compatibilidad](docs/compatibility.md#extra-clients-040) y en [operaciones](docs/operaciones.es.md#clientes-adicionales).

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

MCP disponibles: `serena`, `codegraph`, `playwright-mcp`, `devtools`, `context7`. Los tres clientes base son el destino predeterminado; `--clients claude,codex` lo limita y `--clients all` añade qwen, kimi, agy, commandcode, pi, mimo y dsh (archivos por cliente en [compatibilidad](docs/compatibility.md#project-mcp-060)). `--approve` (opcional) además los aprueba por la vía oficial del cliente cuando existe una no interactiva (Claude, Qwen); el resultado dice qué falta en los demás. `--exclude` (0.7.0) excluye de los commits lo generado con un bloque en `info/exclude` que `disconnect` quita; `--all-in` = `--approve --exclude`. Después recarga el cliente y acepta sus herramientas. Se conservan entradas ajenas y comentarios. Desconecta los proyectos antes de desinstalar.

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

La versión 0.7.1 corrige que `dsh --profile web` rompiera el siguiente `sync` (dsh reescribe su `cordis.patch.yml`; ahora se compara por contenido y las filas no se parten) y hace que un archivo con drift ya no aborte el `sync` de los demás; ver el [changelog](CHANGELOG.md).

La versión 0.7.0 automatiza los pasos que eran manuales: `--all-in` en `install`/`sync --global` (`--trust-codex`, `--dsh-plugins`, `--agy-allow`) y en `connect` (`--approve`, `--exclude`), todos reversibles; ver [Instalar todo en 5 minutos](#instalar-todo-en-5-minutos) y el [changelog](CHANGELOG.md).

La versión 0.6.1 hace que el MCP de proyecto funcione en `kimi -p` (una caché del lanzador que responde antes de que Kimi congele su lista de herramientas) y en dsh sin `--patch`, y añade una tabla única de [estado por cliente](docs/operaciones.es.md#estado-por-cliente-061); ver el [changelog](CHANGELOG.md).

La versión 0.6.0 añade el cliente DeepSeek Harness, el guard de Antigravity, MCP por proyecto en todos los clientes extra, el guard de Claude por defecto y una regla segura en zsh; ver el [changelog](CHANGELOG.md).

La versión 0.5.1 añade `agent-workflow trust --client codex` y `--trust-codex` (aprueban solo los hooks de Agent Workflow en Codex, como `/hooks`) y quita un falso aviso `codex-hook-not-enabled`; ver el [changelog](CHANGELOG.md).

La versión 0.5.0 lleva el guard de validación a Qwen, Kimi, Command Code, Pi y MiMo, y lo deja opcional para Claude y Codex (`--guard`); ver el [changelog](CHANGELOG.md).

La versión 0.4.0 añade seis clientes opcionales, avisa de hooks de Codex sin aprobar, amplía el guard de OpenCode a `node <archivo de test>` y al script de test del proyecto, y corrige un fallo de `uninstall` con JSON compacto; ver el [changelog](CHANGELOG.md).

La versión 0.3.1 hace que `uninstall` conserve lo editado después de un `sync`, ejecuta los hooks con un shim de Node estable, avisa en `verify` de una instalación desactualizada, contempla los worktrees (`disconnect --prune`) y alinea el guard de OpenCode con la regla; ver el [changelog](CHANGELOG.md).

La versión 0.2.3 añade un bloqueo nativo de validaciones compuestas en OpenCode y una búsqueda alternativa de símbolos JS/TS. [Correcciones comprobadas](docs/repairs-2026-11-13.md). Al elegir CodeGraph se comprueba o instala también TypeScript como requisito; esto no añade navegadores.
