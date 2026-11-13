# Agent Workflow

Paquete global de reglas y procedimientos para Claude Code, Codex CLI y OpenCode V2, con desactivación por proyecto, generación Rulesync y retirada reversible.

[English](README.md) · [Arquitectura](docs/architecture.md) · [Compatibilidad y límites](docs/compatibility.md) · [Pruebas](docs/testing.md)

No es un orquestador que trabaje solo. Incluye reglas breves, la skill `aw-workflow`, los roles opcionales `aw-worker` y `aw-reviewer`, un comando de inicio donde el cliente lo admite, recordatorios de inicio/compactación y diagnóstico de herramientas. Respeta las reglas del proyecto y los modelos elegidos por el usuario.

## Instalación global

Requiere Node.js 22 o superior y npm, además de acceso Git al repositorio privado. No pegar tokens en comandos o archivos.

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
agent-workflow doctor --json
agent-workflow setup --tool gopls
agent-workflow setup --tool gopls --apply
```

`doctor` comprueba ejecutables/versiones en este equipo. `setup` reutiliza lo que ya responde y, si falta, presenta el plan; sólo instala con `--apply`. Opciones: `gopls`, `typescript`, `python` (Pyright) y `ast-grep`. Se usan versiones fijadas y una ubicación propia; no se cambia el perfil de shell. No se instala nada al abrir un proyecto.

**Un LSP instalado no significa que el agente lo use.** Falta configurar la integración nativa del cliente y probar definición, referencias y diagnóstico. No se instala Serena ni un servidor MCP por defecto.

## Actualizar y retirar

Después de revisar/obtener una nueva versión, repetir `npm ci --ignore-scripts`, `npm run check`, la instalación npm y `agent-workflow sync --global`. Para retirar:

```sh
agent-workflow uninstall --global --dry-run
agent-workflow uninstall --global
npm uninstall --global @lomeli-dev/agent-workflow
```

No borra configuraciones ajenas. Si editaste un archivo del paquete o su definición de hook, pide reconciliarlo antes. La copia privada de configuración original queda sólo en tu equipo y permite revertir. No se sube al repo. Las herramientas opcionales descargadas y carpetas vacías se conservan al retirar; no se eliminan recursos compartidos a ciegas.

## Cómo se mantiene

La fuente es `.rulesync`. `npm run build` genera para cada cliente. Los tests usan raíces de usuario temporales; no prueban borrando tus configuraciones reales. Hay un modo `--user-root` para repetir instalación/verificación/desinstalación aisladas sin modificar HOME.

Los roles heredan modelo/esfuerzo del cliente. No se alteran límites de compactación o permisos. Sólo el coordinador escribe la memoria existente cuando corresponda; los workers devuelven resultados, decisiones, descubrimientos y lecciones candidatas. No se promete ahorro porcentual sin mediciones de tareas comparables.
