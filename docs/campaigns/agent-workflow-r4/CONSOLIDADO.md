# Campaña Agent Workflow: resultado parcial

Base: versión 0.2.3, commit `55015bde9c85050b1198c55ff203be7bcf52c474`, en macOS. Se ejecutaron diez intentos base por cada una de las cuatro rondas. El candidato no se modificó durante los agentes. Los cuarenta resultados no equivalen a cuarenta casos completos: las comprobaciones especializadas se ejecutaron aparte y los fixtures de base comparten el mismo problema técnico.

## Resultado de la tarea común

| Ronda | Base aprobada en el intento original | Otros resultados |
| --- | ---: | --- |
| 1 | 7/10 | T04, T05 y T09 no arrancaron por un error de flags del arnés; los tres reintentos separados pasaron. |
| 2 | 10/10 | Los secundarios se comprobaron por separado. |
| 3 | 9/10 | T06, MiMo, agotó 240 s sin cambios ni informe. |
| 4 | 9/10 | T06 agotó 240 s; sus tests independientes pasaron, pero no entregó informe ni terminó. |

Una base aprobada acredita salida exitosa, tres tests independientes, informe y comprobaciones indicadas de archivos protegidos. No equivale a que todas las condiciones del caso estén verificadas. Los resultados originales y reintentos están en archivos JSON separados.

| Casos | Cliente y modelo | Resultado común |
| --- | --- | --- |
| T01–T02 | Claude Opus 5.5 | 4/4 cada uno; sustitución autorizada de Opus 4.8 y Opus 5. |
| T03, T08 | Claude Sonnet 5.5 | 4/4 cada uno; sustitución autorizada de Sonnet 5. |
| T04 | Codex Terra | 3/4 originales; ronda 1 pasó al reintentar tras corregir el arnés. |
| T05, T09 | Codex Luna | 3/4 originales cada uno; ronda 1 pasó al reintentar tras corregir el arnés. |
| T06 | OpenCode MiMo 2.6 Flash | 2/4 completos; rondas 3 y 4 agotaron 240 s. |
| T07, T10 | OpenCode GLM 5.3 Flash | 4/4 cada uno. |

Claude confirmó el modelo en el evento de inicio y las sesiones archivadas de OpenCode registraron los modelos solicitados. Codex se invocó explícitamente con los modelos indicados; sus ejercicios base efímeros no exponen una confirmación independiente. En las cuatro pruebas persistentes de delegación, el contexto propio sí registra Terra.

## Pruebas dirigidas adicionales

- **Delegación:** cuatro procesos de Codex con invocación comprobada de `aw-worker`; tests y comprobaciones de archivos protegidos pasaron. No se ha demostrado por completo la autoría de cada archivo entre padre e hijo.
- **Revisión:** cuatro invocaciones de Claude seleccionaron `aw-reviewer` y detectaron el error sintético; la carga interna exacta de sus instrucciones no se verificó independientemente.
- **Errores:** cuatro ejecuciones Codex registraron `npm test` fallido con exit 7. El agente reportó correctamente el resultado en la primera; no se auditó el texto final de las otras tres.
- **Guard de OpenCode:** cuatro ensayos con GLM confirmaron bloqueo del comando compuesto en proyecto activo y ausencia de bloqueo con opt-out. No equivalen a cuatro ensayos con MiMo de T06.
- **MCP:** cuatro ensayos dirigidos de OpenCode encontraron el fallback `agent_workflow_symbols` para `.mjs`, con fuente TypeScript, archivo sin cambios y desconexión exitosa. La cobertura `.js` en esas mismas pruebas queda pendiente.
- **Navegador:** primer intento denegado; en cuatro repeticiones posteriores, tres observaron el DOM y cierre en resultados exitosos; una fue denegada por permisos. Tras corregir la instrucción, un reintento dirigido sí mostró efecto y cierre. Los ensayos exitosos no demostraron en todos los casos el estado previo al clic.
- **Instalación:** cuatro perfiles de usuario temporales restauraron su configuración tras instalar y desinstalar; tres incluyeron sincronización. No se probó una actualización entre dos versiones con un agente.
- **Continuidad:** cuatro reanudaciones cortas de Codex conservaron marcador y checkpoint; cuatro compactaciones cortas de OpenCode finalizaron y recuperaron marcador sin herramientas. No son pruebas de estrés de sesiones largas.

Los ensayos dirigidos no se adjudican retroactivamente como éxito completo de los casos originales. El paquete archivado tiene un hash guardado localmente, pero no se probó que los clientes nativos de estos ensayos cargaran ese tar en lugar de la instalación global existente.

## Verificación y límites

`npm run check` pasó: 42 tests, generación Rulesync y comprobaciones del paquete. `node scripts/package-smoke.mjs` pasó en aislamiento; `python3 .memory/scripts/validate.py .` y `git diff --check` pasaron. La revisión independiente se realizó sobre la evidencia y sus límites. No se confirmó un nuevo defecto reproducible del paquete y no se cambió código del paquete; sí se corrigió el arnés de pruebas.

La CLI de Claude reportó un total estimado de 3.6046 USD para las 16 ejecuciones base de Claude; no equivale necesariamente al cobro real ni incluye los ensayos especiales. No hay consumo monetario comparable de los otros clientes. Las diferencias de duración no son un benchmark controlado.

Pendiente: proyectos verdaderamente distintos; atribución del modelo efectivo en los ejercicios base efímeros de Codex; demostrar lectura del tar/candidato por cada cliente; verificar carga del rol de Claude y propiedad padre/hijo; completar escenarios y combinaciones no ensayados, casos de larga duración y diagnóstico de los dos timeouts de MiMo. No se ha iniciado una quinta ronda. Logs completos y fixtures quedan locales y privados; sólo se publican los resúmenes saneados de esta carpeta.
