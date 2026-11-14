# Agent Workflow

Paquete global de reglas y procedimientos para Claude Code, Codex CLI y OpenCode V2, con desactivación por proyecto, generación Rulesync y retirada reversible.

[English](README.md) · [Arquitectura](docs/architecture.md) · [Compatibilidad y límites](docs/compatibility.md) · [Pruebas](docs/testing.md)

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

La instalación npm registra el CLI; `install --global` añade las piezas a los clientes. Por defecto instala los tres. `--clients claude,codex` permite elegir. No necesita sudo ni cambia permisos/modelos de tus agentes.

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

MCP disponibles: `serena`, `codegraph`, `playwright-mcp`, `devtools`, `context7`. Los tres clientes son el destino predeterminado; `--clients claude,codex` lo limita. Después recarga el cliente y acepta sus herramientas. Se conservan entradas ajenas y comentarios. Desconecta los proyectos antes de desinstalar.

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

La versión 0.2.3 añade un bloqueo nativo de validaciones compuestas en OpenCode y una búsqueda alternativa de símbolos JS/TS. [Correcciones comprobadas](docs/repairs-2026-11-13.md). Al elegir CodeGraph se comprueba o instala también TypeScript como requisito; esto no añade navegadores.
