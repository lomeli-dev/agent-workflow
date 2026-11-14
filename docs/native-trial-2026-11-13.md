# Prueba de comportamiento con clientes reales

Fecha: 13 noviembre 2026. Base: `fada98b`, Agent Workflow 0.2.1. Se ejecutaron **17 sesiones CLI nativas** en proyectos temporales, más delegaciones nativas confirmadas a los roles `aw-reviewer` y `aw-worker`. Los modelos se heredaron de cada cliente; los tiempos no son una comparación controlada entre modelos.

[Resultados estructurados](native-trial-2026-11-13.json)

## Qué se probó

| Caso | Codex | Claude Code | OpenCode V2 |
| --- | --- | --- | --- |
| Corregir dos módulos y documentar contrato | Pasó | Pasó | Pasó |
| Tests existentes y archivos protegidos | Pasó | Pasó | Pasó |
| Opt-out: no aplicar skills ni checks de AW | Pasó | Pasó | Pasó |
| MCP CodeGraph dentro del cliente, símbolo `.js` | Pasó | Pasó | Pasó |
| Revisión de código sin modificar archivos | Pasó | Pasó | Pasó |
| Rol personalizado | Delegaciones `aw-reviewer` y `aw-worker` confirmadas | Selección `--agent aw-reviewer` | Selección `--agent aw-reviewer` |
| Navegador predeterminado con interacción real | No ensayado | Pasó | No ensayado |
| Informar un test deliberadamente fallido | Fallos iniciales visibles en implementación | Pasó, comando directo | Informe correcto; exit de shell enmascarado |

Los tres agentes corrigieron un pequeño paquete de duraciones; el coordinador ejecutó los tests por su cuenta. Sólo cambiaron los módulos y documentos permitidos. Los hashes de los tests y de la memoria sintética protegida se conservaron. Codex cargó explícitamente la skill; Claude y OpenCode aplicaron las reglas cortas y consideraron la tarea demasiado pequeña para cargar el procedimiento completo. Eso coincide con el alcance opcional de la skill, no es prueba de que la skill no exista.

Tiempos observados para esa implementación: OpenCode 36.36 s, Claude 66.49 s, Codex 88.13 s. Incluyen arranque y entorno de cada cliente. No prueban una mejora de velocidad atribuible al paquete.

## Pruebas adicionales y hallazgos

### Opt-out

Los tres clientes reconocieron el switch desactivado, leyeron únicamente lo necesario para responder sobre la función y no cargaron skills AW ni ejecutaron pruebas. No cambiaron archivos. Esto prueba ese escenario de proyecto raíz, no todos los casos de herencia entre subcarpetas.

### Roles, permisos y sesión persistente

La primera prueba Codex utilizó una sesión efímera: el intento de subagente no pudo recuperar el contexto del padre. La repetición en una nueva sesión persistente registró un `spawn_agent` con `agent_type: aw-reviewer` y la respuesta final del worker. No se confundió la lectura del archivo de rol con una delegación ejecutada.

El primer Codex tuvo `approval_policy=never` y por ello no pudo aprobar la llamada MCP. La repetición usó el modo nativo `--approve-for-me`; la llamada fue aceptada. No se utilizó bypass de sandbox, permisos o confianza de hooks. Son opciones de esa invocación, no cambios globales. En Claude, permisos de la sesión sin superficie interactiva rechazaron algunos comandos compuestos; el cliente informó las negativas y continuó con operaciones permitidas.

Claude y OpenCode recibieron selección explícita del rol revisor. Sus revisiones no modificaron fuentes ni memoria. Sus roles no constituyen un sandbox técnico.

Una prueba adicional separó propiedad real de archivos: un único `aw-worker` implementó `src/*.mjs`, mientras el padre escribió README y RESULT. La llamada nativa registró el tipo de agente y su respuesta final. El coordinador ejecutó la validación, y el harness volvió a comprobar los tests y los hashes protegidos: pasó. Esa prueba duró 129.63 s e incluyó el arranque de ambos agentes.

### MCP y cobertura de CodeGraph

Se registró únicamente `aw-codegraph` en cada fixture. Los tres clientes llamaron a su herramienta nativa y obtuvieron un símbolo y ubicación reales de `sample.js`; no se aceptó grep como sustituto de evidencia MCP. Las conexiones temporales se retiraron al terminar.

El fixture de implementación usaba `.mjs`: CodeGraph 0.21.0 devolvió un índice vacío. Un ensayo directo controlado encontró símbolos equivalentes en `.js` y `.py`, pero no en `.mjs`. La guía ahora exige comprobar cobertura y usar un LSP o lectura de código cuando el índice no cubre el archivo. No se renombraron fuentes reales ni se afirmó que reindexar resolviera el problema.

### Navegador a través de un agente

Claude leyó las instrucciones y la guía de la versión instalada de agent-browser. Abrió una página HTTP local con Chrome existente y una sesión propia, obtuvo un snapshot, pulsó Increment, observó `Count: 1` en otro snapshot y cerró sólo su sesión. No descargó navegador, no usó perfil personal ni controló el escritorio. La prueba valida ese recorrido; `exec` sigue siendo un passthrough y no impone esas opciones a futuros agentes.

### Fallos de validación

En las primeras implementaciones aparecieron pipelines o comandos posteriores a tests que podían ocultar su exit real. Se reforzó la regla corta global y su referencia de ejecución, y se regeneró para los tres clientes.

Se repitió con un `npm test` que deliberadamente termina con código 7. Claude ejecutó el test directamente y reportó 7. OpenCode reportó correctamente 7, pero ejecutó `npm test ...; echo "EXIT:$?"`: el último echo enmascara el exit del proceso shell. **Este punto sigue siendo cumplimiento parcial de la instrucción.** También se observaron lecturas secuenciales y validaciones repetidas en algunas sesiones; no se promete agrupación óptima de llamadas. El paquete no puede garantizar que un modelo obedezca cada regla; la verificación independiente y CI deben decidir aceptación usando el proceso real, no sólo el texto final del agente.

### Coordinación y entorno

Un primer intento del harness registró varios proyectos en paralelo y encontró el lock compartido. Se comprobó que las sesiones afectadas no se habían lanzado; luego se prepararon los registros secuencialmente y sólo las ejecuciones independientes fueron paralelas. La guía de coordinación ahora aclara esa diferencia.

Se observaron fallos/timeouts de MCP globales ajenos a Agent Workflow en Codex. No se corrigieron ni desactivaron configuraciones del usuario para ocultarlos. Pueden influir en el arranque y los tiempos.

### Herramientas de línea de comandos

ast-grep encontró un patrón estructural real en una entrada JavaScript sintética. Gitleaks devolvió 1 para un marcador sintético con regla controlada y 0 para entrada limpia. Se comprobó la ejecución del motor, no la sensibilidad de todos sus detectores ni que encuentre cualquier secreto.

## Reproducción y privacidad

El seed intencionalmente fallido está en `examples/native-client-lab/` del checkout. Cópialo fuera del repositorio, inicializa allí un Git temporal y usa instrucciones de alcance explícito. No lo trates como un test de paquete que deba pasar antes de la corrección.

Los lanzamientos usaron las opciones documentadas de los clientes: Codex `exec --json` en workspace-write (primero efímero, luego persistente con aprobación automática nativa); Claude `--print --output-format stream-json`, permisos acotados y `--strict-mcp-config` del fixture; OpenCode `--standalone run --archived --format json --auto`. El uso de `--auto` de OpenCode respetó sus denegaciones explícitas. No se eligieron modelos nuevos.

Los logs crudos y rollouts nativos se mantienen locales: pueden incluir configuración, rutas y datos de sesión. No se publican prompts del sistema, credenciales ni mensajes cifrados. El JSON de resultados contiene sólo observaciones y métricas del ensayo sintético.

## Lo que no queda demostrado

- Cumplimiento perfecto o determinista de todas las reglas por cualquier modelo.
- Ejecución de cada hook de Codex/OpenCode, compacción real o recuperación de una sesión larga.
- Navegación por cada motor/navegador, plataforma, página o cliente posible.
- Ausencia de fallos de herramientas externas o compatibilidad con cada extensión de archivo.
- Un aislamiento técnico de lectura/escritura impuesto por los roles.

La conclusión es que el flujo se ejerció en trabajo real de los tres clientes y conserva sus límites; no que todo escenario futuro esté certificado.
