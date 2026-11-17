# Estudio de contexto y modo opcional Claude Lean

[English](context-study.md) · [Pruebas en español](pruebas.es.md)

## Qué se midió

En una cuenta de macOS, un proyecto Git desechable recibió el mismo saludo mínimo tres veces por modalidad. Son mediciones exploratorias reportadas por los clientes, no una factura ni un benchmark de tareas reales. No se cambiaron ajustes ni credenciales. Los logs completos son locales y privados; las [mediciones saneadas](context-study-results.json) conservan cada intento y los errores del arnés.

| Cliente y modalidad | Contexto de entrada reportado en muestras exitosas | Diferencia importante |
| --- | --- | --- |
| Claude Sonnet 5.5, ajustes habituales | 32,360; 42,484; 43,434 | La cantidad de herramientas anunciadas varió entre arranques. |
| Claude Sonnet 5.5, lista MCP estricta vacía | 27,305 en cada uno de 3 reintentos | No hay servidores MCP configurados disponibles en esa sesión. |
| Claude Sonnet 5.5, `ENABLE_TOOL_SEARCH=auto:5` | 43,737; 43,417; 43,957 | Los MCP siguen configurados; esta muestra no demuestra una mejora. |
| Codex Luna, ajustes habituales | 23,473 o 24,797 | Variaron catálogos, caché y arranque. |
| Codex Luna, MCP seleccionados omitidos de `direct` | 23,473 o 24,797 | No se demostró reducción estable ni disponibilidad completa de herramientas. |
| Codex Luna, cinco MCP deshabilitados en esa ejecución | 23,473 o 24,797 | No se demostró reducción estable; esos servidores no estaban disponibles. |

Los totales de Claude suman los campos reportados de entrada, creación de caché y lectura de caché por respuesta. No son cargos sumables, no se comparan directamente con la contabilidad de Codex y no demuestran ahorro económico. Las medianas reportadas de Claude habitual y lista MCP vacía fueron 42,484 y 27,305: una diferencia de 15,179 tokens en estas muestras. La cantidad de herramientas cambió y la lista vacía eliminó capacidades. Otros prompts, modelos, conectores, cachés, cuentas o reglas pueden producir resultados distintos.

La [documentación MCP de Claude](https://code.claude.com/docs/en/mcp) explica la búsqueda diferida y que desactivar ToolSearch puede cargar herramientas desde el inicio. La [referencia de configuración de OpenAI](https://developers.openai.com/codex/config-reference/) documenta visibilidad y activación por servidor; su efecto depende del cliente instalado. Las [instrucciones de OpenCode](https://opencode.ai/docs/instructions/) describen la carga de reglas globales y de proyecto. No se cambiaron ajustes globales a partir de estos experimentos.

## Lanzador opcional

`agent-workflow claude-lean --` inicia Claude con `--strict-mcp-config` y una lista MCP explícita vacía. Por tanto, **esa sesión no tiene acceso a los servidores MCP configurados**, aunque el proyecto los tenga normalmente. No los desinstala ni desactiva en otras sesiones. El comando normal `claude` mantiene su configuración habitual.

Para cargar una selección, crea un JSON MCP de Claude y ejecuta:

```sh
agent-workflow claude-lean --mcp-file /ruta/a/mcp-seleccionados.json --
```

Ejemplo de formato:

```json
{"mcpServers":{"mi-herramienta":{"command":"mi-servidor-mcp","args":[]}}}
```

Conserva las credenciales en tus mecanismos seguros de entorno o autenticación, no en un archivo compartible. Agent Workflow pasa el archivo a Claude sin leerlo ni modificarlo. El lanzador no cambia modelo, esfuerzo, ajustes, hooks ni permisos; siguen aplicando la configuración y políticas propias de Claude. No pases opciones MCP incompatibles después de `--`: usa `--mcp-file` antes del separador.

Para uso no interactivo, pasa las opciones de Claude después de `--`:

```sh
agent-workflow claude-lean -- --print "Explica este proyecto"
```

**Para volver:** cierra esa sesión y abre `claude` normalmente. Si necesitas retirar esta función de un checkout local, vuelve a la versión instalada anterior o revierte el cambio; no agrega hooks, servicios en segundo plano ni configuración persistente del cliente.

## Validación nativa

El Claude local real arrancó en modo Lean con cero servidores MCP y respondió `OK`. Con un MCP local seleccionado explícitamente, el mismo lanzador expuso un servidor; Claude descubrió su herramienta mediante ToolSearch y la llamó. En otro fixture Python, Claude comprobó la aplicación del workflow, hizo el cambio solicitado y pasó `python3 -m unittest`; los tests y las instrucciones quedaron intactos. Una suite focalizada comprueba el paso de argumentos, selección MCP, rechazo de archivos ausentes o conflictos y propagación del estado de salida. Esto no demuestra compatibilidad con todas las versiones, MCP, políticas de permisos o tareas largas, ni que todas las herramientas habituales del usuario estén disponibles en Lean.
