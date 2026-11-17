# STATE — 2026-11-13T20:44:40-06:00

## Tarea
Campaña Agent Workflow en cuatro rondas; revisión final y continuidad pendientes, no declarada completa.

## En qué quedamos
Diez intentos base por ronda. R1: siete pasaron y tres fallaron al arrancar por flags incompatibles del arnés; tres retests pasaron. R2: diez pasaron. R3 y R4: nueve pasaron y T06 MiMo agotó 240 s en cada una; en R4 sus tests pasaron pero no entregó informe. Pruebas dirigidas repetidas de delegación, salida 7, guard, MCP, navegador, instalación y continuidad están documentadas; no equivalen a todas las condiciones de los cuarenta casos. Consolidado en docs/campaigns/agent-workflow-r4/CONSOLIDADO.md. El usuario autorizó sustituciones Claude: opus 5.5 y sonnet 5.5.

Sesiones de contexto ampliado: dos de OpenCode (workflow activo y control desactivado) con ocho turnos, 50,956 bytes por sesión y compactación nativa; una de Codex Luna con ocho turnos y reanudación, sin compactación observada. Todas preservaron marcador y archivos, y reportaron test de salida 7. En OpenCode activo el guard bloqueó un intento compuesto antes del test directo. No hay evidencia de ahorro causal con una sola muestra por lado. Ver docs/campaigns/agent-workflow-r4/sesiones-largas.md.

Ronda final adicional: fixtures Go, Python y JavaScript. Los tests independientes pasaron; Go tuvo inicialmente un error de caché comunicado por el agente y el reintento con GOCACHE local ejecutó go test con salida 0. Contexto inicial medido con Codex habitual/ignore-user-config y Claude habitual/strict MCP; una muestra por opción, no prueba causal de ahorro. Ver docs/campaigns/final-round/. PR borrador #1 abierto.

## Decisiones
- No hay quinta ronda automática. Originales, reintentos y ensayos dirigidos permanecen separados.
- Sólo coordinador escribe memoria. Logs crudos quedan privados en .runtime/campaigns y fixtures temporales; no publicarlos.
- No se confirmó nuevo defecto del paquete. El arnés se reparó sin modificar el código de Agent Workflow.

## Blockers
- Dos timeouts MiMo sin causa determinada. Los diez proyectos comparten tarea técnica; no son cobertura diversa real.
- Modelo real de los casos base efímeros Codex no confirmado; modelos de sesiones archivadas OpenCode sí confirmados. La carga del tar por cada cliente y la carga interna de aw-reviewer siguen sin demostrar.
- Faltan combinaciones especializadas y sesiones largas. La matriz conserva secondary_status not yet verified en originales; no presentar la campaña como completa.

## Próximo paso
Leer docs/campaigns/agent-workflow-r4/sesiones-largas.md y el consolidado; si se desea medir ahorro, diseñar un A/B repetido y comparable sin iniciar una quinta ronda automáticamente. Contrastar estado real antes de repetir timeouts; no reprobar a ciegas. Revisar fixtures y procesos propios antes de cualquier limpieza.

## Git
branch test/cross-client-verification · head aff025f59903 · dirty: memoria y docs/campaigns/final-round nuevos antes del segundo commit; PR borrador #1 abierto.

## Verificación
Mac local: sesiones ampliadas probadas; npm run check pasó 42 tests y validación de paquete; package-smoke pasó; git diff --check y validador de memoria pasan. Cuatro pruebas dirigidas de guard, MCP, fallo de test, delegación y continuidad; revisión independiente. Se cerraron los procesos de runner propios; logs y fixtures privados conservados.
