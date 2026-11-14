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
| `install --global` / `sync --global` | Instalar o actualizar los archivos propios; permite `--clients claude,codex,opencode` |
| `verify` | Verificar archivos y registros propios; no demuestra ejecución dentro del IDE |
| `doctor --json` | Comprobar ejecutables/versiones; no acredita autenticación ni integración completa |
| `status --project RUTA --json` | Ver si este proyecto tiene activado el flujo |
| `disable --project RUTA` / `enable --project RUTA` | Cambiar el interruptor del proyecto; admite `--dry-run` |
| `setup --list` | Mostrar catálogo y perfiles |
| `setup --interactive`, `--tool`, `--tools`, `--profile`, `--all` | Elegir herramientas; agregar `--apply` para instalar |
| `symbols --project RAIZ --file modulo.mjs [--name NOMBRE]` | Buscar declaraciones con el parser TypeScript y rutas originales, sin relaciones de grafo |
| `exec --tool NOMBRE -- ARGUMENTOS` | Ejecutar la herramienta instalada con el PATH administrado |
| `mcp-config --project RAIZ` | Mostrar sugerencias de configuración sin escribir archivos |
| `connect --project RAIZ` | Registrar MCP del proyecto; `--dry-run` previsualiza |
| `disconnect --project RAIZ` | Retirar las entradas propias; repetir el mismo `--clients` de la conexión |
| `mcp --tool NOMBRE --project RUTA` | Lanzador stdio interno usado por los registros |
| `uninstall --global` | Retirar integración y revertir cambios propios; conserva herramientas |
| `--user-root RUTA` | Usar una raíz temporal de pruebas existente; no es un sandbox del sistema |

No combines `--all` con otros selectores, ni `--apply` con `--dry-run`.

## Conectar y desactivar por proyecto

Los MCP predeterminados son **Serena, CodeGraph y Context7**. Los de navegador se eligen explícitamente. Agent-browser se usa mediante CLI/skill y no añade un MCP por defecto.

```sh
agent-workflow connect --project /ruta/raiz --clients claude,codex --dry-run
agent-workflow connect --project /ruta/raiz --clients claude,codex
agent-workflow disconnect --project /ruta/raiz --clients claude,codex
```

Usa la raíz Git para conectar, desconectar o imprimir configuración. No aceptamos una subcarpeta y la convertimos silenciosamente en raíz. El registro se aplica a esa raíz; no representa dinámicamente los opt-out de todas sus subcarpetas.

Los archivos nativos son `.mcp.json`, `.codex/config.toml` y `opencode.jsonc`/`opencode.json`. Se conserva la ruta originalmente administrada. Si cambias el archivo de configuración que tiene prioridad en OpenCode, primero desconecta y luego conecta de nuevo. Los cambios en entradas propias se detienen para revisión.

El opt-out se comprueba al arrancar el MCP; no revoca servidores ya abiertos. Reinícialos después de cambiarlo. Dentro de Git la búsqueda del interruptor termina en la raíz del repo. Fuera de Git busca en los directorios superiores hasta la raíz del sistema. El cliente puede seguir descubriendo las skills globales aunque el flujo esté desactivado.

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

En OpenCode V2 el plugin intercepta el shell antes de ejecutar. Con el workflow activo rechaza validaciones reconocidas que incluyan pipes, separadores o condicionales; ejecuta el test solo y usa el directorio del propio tool. El opt-out se vuelve a consultar en cada llamada. Es un guard limitado, no un parser universal ni un sandbox de permisos.

El MCP de CodeGraph incorpora `agent_workflow_symbols` para un archivo JS/TS explícito, incluyendo `.mjs`, `.cjs`, `.mts` y `.cts`. Usa TypeScript como requisito, devuelve nombres y posiciones originales y no ejecuta el módulo. Rechaza rutas fuera del proyecto, errores sintácticos y archivos mayores a 1 MiB. El resultado identifica su fuente y no afirma tener relaciones de grafo. El motor original de CodeGraph sigue teniendo su límite de extensiones.
