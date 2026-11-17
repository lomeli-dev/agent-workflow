---
name: agent-workflow-cross-client-4-rounds
description: Campaña de diez casos equivalentes por ronda, cuatro rondas, con clientes reales, correcciones y evidencia independiente.
date: 2026-11-13T19:27:23-06:00
estado: revision
---

# Agent Workflow — campaña cruzada de cuatro rondas

## Objetivo
Evaluar Agent Workflow trabajando de verdad en proyectos sintéticos con Claude Code, Codex y OpenCode V2; detectar fallos, corregirlos y repetir cuatro rondas comparables. El resultado es un consolidado verificable, no una promesa de ausencia absoluta de errores.

## Estado y autorización
El usuario pidió guardar primero el plan, memoria y checkpoint, después compactar esta conversación y sólo entonces iniciar. Esta campaña NO está iniciada. No se han lanzado modelos ni creado recursos de esta campaña. Tras la compactación, retomar este archivo y la memoria viva antes del preflight. La orden posterior «inicia el plan» activa la ejecución; guardar este documento no la activa.

## Contexto y base
- Proyecto: /Users/lomelidev/Dev/agent-workflow; repositorio privado lomeli-dev/agent-workflow.
- Base comprobada al guardar: versión 0.2.3, main, commit 55015bde9c85050b1198c55ff203be7bcf52c474.
- `agent-workflow verify` pasó en esta Mac. La CI de esa base pasó en macOS/Linux: https://github.com/lomeli-dev/agent-workflow/actions/runs/43539483404 .
- Evidencia anterior: docs/native-trial-2026-11-13.md y docs/repairs-2026-11-13.md. Hubo 17 sesiones nativas, roles aw-worker/aw-reviewer y 42 tests deterministas en la entrega 0.2.3. Son antecedentes; NO se cuentan como rondas de esta campaña.
- Ya existe un guard nativo de OpenCode para validaciones compuestas reconocidas; no es un parser universal de shell.
- CodeGraph 0.21.0 omite módulos .mjs en el grafo; la integración ofrece agent_workflow_symbols / CLI symbols mediante TypeScript, sin inventar relaciones.
- Agent-browser reutiliza un navegador instalado, con sesión propia sin ventana. Playwright/DevTools son opcionales explícitos. No añadir linter, formateador ni servicio de tareas persistentes.
- Sólo el coordinador modifica la memoria real del proyecto. Workers devuelven evidencia, Decisiones, Descubrimientos y Lecciones candidatas.

## Supuestos adoptados
1. Diez casos por ronda, cuarenta casos base en total. Las sesiones de reanudación, subagentes y retests se contabilizan aparte; no se oculta su coste.
2. Los «dos de Claude» y los tres nombres dados se interpretan como una selección aproximada: cubrir los tres modelos solicitados, con réplicas para completar diez casos. No son diez agentes simultáneos.
3. Máximo tres agentes de modelo activos a la vez contando hijos; máximo un navegador. Casos con delegación se programan para que padre e hijos respeten ese tope.
4. Primera ejecución en esta Mac. No usar x-dev ni otros equipos sin que se incluya explícitamente después.
5. Mantener cuatro rondas completas aunque una intermedia salga verde. Si tras la cuarta quedan defectos, informar pendientes; no empezar una quinta sin acordarlo ni afirmar «cero errores» por agotar el plan.
6. No hay presupuesto monetario definido. Registrar consumo cuando el cliente lo entregue; no inventar precios ni gasto. Estimar duración tras la primera ronda, no prometer un plazo antes del preflight.

## Matriz de diez casos
Los nombres son solicitudes del usuario, NO IDs técnicos verificados. Resolver y congelar proveedor/modelo/versión/effort reales antes del primer lanzamiento. No sustituir silenciosamente un modelo ausente.

| ID | Cliente | Modelo solicitado | Proyecto sintético | Caso secundario principal |
| --- | --- | --- | --- | --- |
| T01 | Claude Code | Opus 4.8 | Reservas de salas | Lecturas agrupadas, alcance y edición coherente |
| T02 | Claude Code | Opus 5 | Inventario de piezas | Roles y revisión con archivos protegidos |
| T03 | Claude Code | Sonnet 5 | Registro de gastos | Navegador nativo, efecto DOM observado y cierre |
| T04 | Codex | Terra | Cola de trabajos | Delegación aw-worker con propiedad separada |
| T05 | Codex | Luna | Medidor de tiempos | Informe de fallo real y conservación de exit |
| T06 | OpenCode V2 | Perfil A disponible, pendiente de resolver | Turnos de soporte | Guard activo/desactivado y command no ejecutado |
| T07 | OpenCode V2 | Perfil B disponible, pendiente de resolver | Catálogo de notas | MCP con .js/.mjs, fuente y cobertura correctas |
| T08 | Claude Code | Sonnet 5, réplica independiente | Agenda de entregas | Instalación/actualización/retirada en raíz de usuario temporal |
| T09 | Codex | Luna, réplica independiente | Reporte de métricas | Reapertura y checkpoint con identidad de sesión propia |
| T10 | OpenCode V2 | Perfil B, réplica independiente | Tablero de tareas | Compactación nativa, reapertura y opt-out |

La matriz es una propuesta cerrada de diez casos, no diez llamadas API exactas. Cada caso usa una copia independiente de un mismo arquetipo pequeño: dos módulos, validación de entradas, agregación, README y tests externos protegidos. Cambian dominio, nombres y datos, no la dificultad central. Cada caso ejecuta el mismo contrato común y su caso secundario. No comparar velocidades agregadas de casos secundarios diferentes como si fueran un benchmark científico.

## Contrato común y evidencia
- Un proyecto por caso y ronda, inicializado desde un seed inmutable; sin archivos privados ni copia del historial del usuario.
- Capturar hash de fuentes, tests protegidos, instrucciones, estado inicial y versión candidata.
- Comprobar instrucciones efectivamente cargadas, gate y herramientas realmente invocadas, no sólo el relato final.
- Hacer una corrección pequeña funcional, documentar el contrato y ejecutar tests. El coordinador verifica de forma independiente.
- Introducir un fallo esperado controlado: distinguir exit del proceso, status del tool y texto final. No aceptar el último echo como validación.
- Comprobar que los workers no modifiquen tests protegidos, configuración ajena o memoria compartida.
- Tratar permisos denegados, timeout, cuota y modelo ausente como estados explícitos, no como éxito ni automáticamente como bug del paquete.
- Capturar acciones por tipo, lecturas repetidas, tamaño de cambios, tests repetidos con motivo, duración, modelo real y consumo si está disponible. No fijar un número mágico de llamadas que premie omitir verificaciones.
- Cerrar sólo navegadores, procesos y registros que pertenezcan al caso, comprobando la limpieza.

## Pasos
1. P0 — Retomar después de compactar: leer AGENTS.md, .memory/STATE.md, este plan y los dos informes previos; contrastar Git y validar memoria. No repetir las investigaciones históricas.
2. P1 — Preflight de clientes/modelos: comprobar los CLI instalados y catálogos nativos, autenticación sin revelar valores, nombres/IDs exactos y capacidades. Registrar requestedModel y resolvedModel. Si no hay acceso, apartar sólo esa fila y pedir decisión para sustituirla; avanzar con filas independientes autorizadas. No cambiar modelos/effort globales.
3. P2 — Preparar harness y seeds: fijar contrato común, casos secundarios, hashes y checks objetivos antes de ver resultados. Separar carpeta de logs privados y reporte publicable. Generar un artefacto inmutable de Agent Workflow por ronda.
4. P3 — Ronda 1: diez casos desde seeds limpios y sesiones nuevas, con máximo tres modelos activos. Cada caso tiene spec autosuficiente y dueño; ninguna ejecución puede corregir el propio paquete en paralelo.
5. P4 — Clasificar, reproducir y corregir: registrar cada fallo; dejar terminar la ola independiente; reparar en un único checkout y agregar una regresión. Validar cambios, regenerar Rulesync, probar paquete y congelar la siguiente revisión.
6. P5 — Rondas 2, 3 y 4: repetir la misma matriz y contratos con seeds reiniciados. Cada ronda usa un único candidato fijo; conservar los resultados previos, comparar regresiones y llevar por separado los retests dirigidos.
7. P6 — Cierre: revisión independiente, verificación completa del candidato final y limpieza de recursos propios. Guardar consolidado, memoria y checkpoint. Declarar aprobado/parcial/bloqueado con el alcance real.

## Concurrencia, aislamiento y versiones
- No editar el checkout activo del paquete mientras una sesión lo usa por enlace npm local. Ningún worker toca lib/, bin/, .rulesync/, generated/ ni configuraciones globales del paquete.
- Instalar/conectar/desconectar/sincronizar usan registros compartidos: hacer esas mutaciones en serie. Después pueden correr los casos independientes en paralelo.
- Preferir un paquete empaquetado fijo por ronda y adapters de cliente acotados a los fixtures. Verificar que cada cliente cargó el candidato esperado. Si no se puede aislar una integración sin copiar credenciales o modificar sesiones ajenas, marcar el caso limitado y resolver su preparación antes de lanzarlo.
- No copiar claves, tokens ni cuentas a worktrees. Usar autenticación nativa existente y rutas de sesión propias. No usar bypass de permisos ni confianza de hooks.
- Modelo y effort por invocación sólo cuando el cliente los soporte y el catálogo los confirme. Registrar cualquier fallback automático; una sustitución silenciosa invalida esa muestra.
- Si se usa Orca para la coordinación, leer la guía vigente con su CLI y seguir eventos/worker_done; no sondear a ciegas ni escribir por terminal en workers supervisados. Si el harness necesita CLI headless para instrumentar una prueba nativa, declararlo como método del ensayo, con identidad y cleanup propios; no llamarlo una ejecución de Orca.
- Los archivos de memoria reales sólo los escribe el coordinador. Por defecto, la memoria sintética de cada fixture es un canario inmutable. En el caso específico de checkpoint, autorizar únicamente al coordinador de ese fixture a escribir su checkpoint, nunca a un worker ni al resto de los casos.

## Fallos y ciclo de corrección
- Antes de reintentar, reconciliar el estado real: un timeout no prueba que el proceso haya terminado ni que una acción no se haya ejecutado.
- Guardar caseId, roundId, candidateSha, client/version, requested/resolved model, entorno, síntoma, reproducción mínima, evidencia y propietario de la corrección.
- Clasificar: paquete / integración del cliente / proveedor o cuota / harness / incumplimiento del modelo / límite conocido.
- No silenciar errores con filtros, mocks o cambios en los tests de aceptación para obtener verde. No alterar los criterios a posteriori; cualquier cambio de contrato va versionado y exige reprobar comparabilidad.
- Se pueden registrar y aislar fallos mientras los casos independientes continúan. Las correcciones y sincronización del paquete esperan a una barrera sin workers usando ese candidato.
- Un retest de reparación como máximo por caso afectado dentro de la ronda; si vuelve a fallar, registrar el pendiente y llevarlo a la siguiente ronda. Otros intentos requieren causa nueva y registro explícito. Las cuatro rondas ya incluyen repetición completa.
- En la cuarta ronda, un fallo reparado y validado sólo de forma dirigida no cuenta como una ronda completa limpia posterior al fix. Declarar esa diferencia en el cierre.
- Interrumpir sólo las filas afectadas por pérdida de autorización, riesgo de tocar datos reales, efectos inciertos sin reconciliar o agotamiento de cuota. No gastar repitiendo un modelo no disponible.

## Dependencias
- P0 antes de P1; P1 habilita únicamente los modelos realmente disponibles.
- P2 congela seeds y candidato antes de cada ronda.
- Una corrección requiere evidencia/reproducción, dueño único y ausencia de lectores activos del candidato mutable.
- La siguiente ronda requiere checks del nuevo candidato, artefacto y configuración de ensayo registrados.
- El cierre requiere que todos los casos estén asentados: aprobado, fallo, bloqueado o no ejecutado; ninguno oculto ni activo sin dueño.

## Riesgos
- Opus 4.8, Opus 5, Sonnet 5, Terra y Luna pueden ser alias ambiguos, no estar disponibles o pertenecer a otro proveedor. No se comprobaron al guardar este plan.
- La misma regla puede comportarse distinto por cliente o modelo; medir resultado real y no sólo presencia de archivos.
- Un MCP global ajeno puede fallar o demorar el arranque. Separar ese diagnóstico del paquete; no desactivarlo ni arreglarlo globalmente sin alcance explícito.
- Los modelos no garantizan obediencia determinista; el gate de aceptación lo decide evidencia independiente.
- Mayor concurrencia puede inflar latencia y gasto. Tres agentes simultáneos es el tope inicial, no un objetivo que obligue a llenar cupos.
- Compactación manual con fixture corto no equivale a una prueba de estrés prolongada; registrar duración, cantidad de contexto y tipo de recuperación ensayada.

## Entregables previstos
- docs/campaigns/agent-workflow-r4/README.md — entrada y estado real de la campaña.
- docs/campaigns/agent-workflow-r4/matrix.json — aliases solicitados, resolución verificada, versiones, seeds y candidatos.
- docs/campaigns/agent-workflow-r4/round-01.json hasta round-04.json — métricas y estado por caso.
- docs/campaigns/agent-workflow-r4/findings.md — hallazgos, causas, fixes y retests.
- docs/campaigns/agent-workflow-r4/CONSOLIDADO.md — conclusión por cliente/modelo y limitaciones.
- .runtime/campaigns/ — logs locales privados; nunca publicar rollouts crudos, credenciales, mensajes cifrados ni configuración original del usuario.
- .memory/STATE.md, plan e historial y checkpoints: sólo el coordinador.
Estos entregables de ejecución aún no existen; se crearán al iniciar. Este plan sí debe existir antes de compactar.

## Hecho cuando
- Se recorrieron cuatro rondas de diez casos planificados, con cualquier omisión o bloqueo contado explícitamente.
- Los casos aceptados tienen pruebas independientes y origen de modelo/cliente/candidato comprobado.
- Todo defecto confirmado del paquete está corregido y revalidado, o declarado pendiente con reproducción y motivo. No se dice «terminado sin errores» si quedan fallos o evidencia faltante.
- En el checkout candidato de Agent Workflow: npm run check y node scripts/package-smoke.mjs terminan correctamente. agent-workflow verify se usa para la instalación que se esté afirmando, sin confundir archivos con comportamiento nativo.
- git diff --check pasa; CI se atribuye al SHA exacto si se hace una entrega autorizada, no al commit anterior.
- python3 .memory/scripts/validate.py . pasa en la raíz de este proyecto.
- Recursos propios cerrados o inventariados; sesiones habituales preservadas; consolidado y checkpoint escritos.

## Comunicación
Avisar al cerrar preflight, al iniciar/cerrar cada ronda y ante un bloqueo relevante. Durante trabajo activo, enviar avances breves al menos cada minuto cuando este cliente lo permita. No afirmar ejecución en segundo plano si el coordinador terminó el turno; distinguir workers realmente activos de tareas guardadas.

## Prompt de continuación
El prompt para pegar después de compactar está en docs/prompts/agent-workflow-cross-client-4-rounds.txt. Ese texto exige leer este plan y la memoria viva; no depende de conservar esta conversación.

## Historial
- 2026-11-13T19:27:23-06:00 · — → backlog · plan solicitado y guardado antes de compactación; campaña aún no iniciada
- 2026-11-13T19:46:10-06:00 · backlog → en-curso · Campaña iniciada: preflight completado, ronda 1 original registrada; reintentos Codex activos.
- 2026-11-13T20:18:15-06:00 · en-curso → revision · Cuatro rondas base y pruebas dirigidas registradas; cierre parcial por timeouts y cobertura incompleta, sin iniciar quinta ronda.
