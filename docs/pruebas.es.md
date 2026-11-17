# Pruebas y aceptación

[English](testing.md) · [Guía de operaciones](operaciones.es.md)

Ejecuta `npm run check`. Las pruebas del instalador usan raíces de usuario temporales; no sustituyen `HOME` ni llaman al instalador global real.

Los resultados locales históricos están en [validation.json](validation.json) y [descubrimiento nativo](native-discovery.json). Delimitan la evidencia: no afirman que un modelo haya ejecutado todo en cada cliente. `node scripts/package-smoke.mjs` instala además el paquete npm empaquetado en un prefijo temporal y prueba su ciclo de vida.

La suite cubre idempotencia, restauración exacta, conservación de configuración ajena, activación y desactivación por proyecto, límites anidados, configuración mal formada, rechazo de colisiones y enlaces simbólicos, bloqueo de instalación, cambios en archivos y hooks propios, rutas manipuladas en manifiestos, argumentos del CLI, límites de salida de hooks, opt-out, arranque de OpenCode, selección permitida de dependencias y vista previa de instalación sin escritura.

La compilación ejecuta Rulesync fijado en un staging temporal. También se comprueban sintaxis y enlaces internos. Los tests verifican efectos, no frases exactas. Estas comprobaciones no requieren modelos, autenticación ni llamadas pagadas.

Para una instalación real, primero ejecuta `install --global --dry-run`, revisa destinos, instala y ejecuta `verify`. Una segunda instalación debe informar cero archivos modificados. Los clientes deben aceptar sus hooks/plugins y descubrir sus skills/roles por separado; no se elude la aprobación nativa. Que un ejecutable responda su versión no demuestra que el LSP funcione dentro del IDE.

Para comprobar el opt-out, usa un proyecto temporal, desactívalo y ejecuta el hook real para confirmar que no emite contexto; reactívalo y comprueba la salida acotada. Repite la comprobación antes de lanzar un worker. Esto no significa que el IDE deje de descubrir los archivos globales.

Para evaluar rendimiento, compara tareas de código equivalentes antes y después, con tiempo hasta el resultado verificado, pasos secuenciales innecesarios, comprobaciones repetidas y retrabajo. No publicamos un porcentaje de mejora sintético. Los hooks no ejecutan modelos ni red y tienen tiempo límite.

## Aceptación de módulos opcionales v0.2

En esa etapa pasaron 23 pruebas automatizadas, incluyendo selección, conservación y colisiones MCP por proyecto, opt-out y protecciones de desinstalación. Pasó el ciclo de vida del paquete npm empaquetado. El selector interactivo se probó con una selección en vista previa. La actualización global verificó correctamente y una segunda sincronización no modificó archivos.

[Validación de módulos](module-validation.json) registra instalación o reutilización real, seis respuestas de inicialización LSP y cinco comprobaciones funcionales MCP. Los scripts opcionales `scripts/probe-lsp.mjs`, `scripts/probe-modules.mjs` y `scripts/exercise-modules.mjs` están separados de la suite predeterminada y pueden requerir sus dependencias. No demuestran la carga ni todos los permisos en un IDE abierto.

## Navegador predeterminado

Se instaló agent-browser 0.43.0 sin descargar navegador. `scripts/probe-agent-browser.mjs` probó una página HTTP local desechable con Chrome existente, una sesión headless única y sin perfil personal: navegación, captura de elementos interactivos, clic y captura PNG; después cerró la sesión. Esto prueba el CLI del navegador, no su invocación desde todos los IDE. Los tests del perfil comprueban que las alternativas opcionales no entren en la instalación automática.

## Auditoría 0.2.1

La auditoría de cinco revisores añadió regresiones sobre comentarios en configuraciones compartidas, precedencia de OpenCode, bloques administrados ausentes, cambios en registros de conexión, opt-out anidado, contenedores inválidos, propiedades heredadas, LSP ausentes o mal formados y archivos especiales FIFO. En ese momento la suite tenía 36 tests. La CI verifica archivos generados sin seguimiento y el mínimo real Node 22.22.0. Consulta la [auditoría y sus límites](audit-2026-11-13.md).

## Pruebas con clientes nativos

Consulta la [prueba con agentes reales](native-trial-2026-11-13.md) y su [evidencia estructurada](native-trial-2026-11-13.json). Son sesiones opcionales y autenticadas, separadas de la CI y de los tests deterministas. El seed intencionalmente defectuoso de `examples/native-client-lab` se copia a proyectos desechables; se espera que falle inicialmente. No lo ejecutes sobre proyectos reales ni aceptes el informe del modelo como única comprobación.

## Correcciones 0.2.3 y Claude Lean

La validación de 0.2.3 comprendió 42 tests deterministas sobre el guard, el opt-out por llamada, la búsqueda de símbolos en el archivo original, límites y selección de dependencias. La [evidencia de reparación](repairs-2026-11-13.md) distingue pruebas reales del guard de OpenCode, el fallback MCP y la compactación/reanudación manual.

La adición de Claude Lean incorporó tres tests automatizados sobre argumentos, selección de MCP, rechazo de conflictos y propagación del estado de salida. También se probó con Claude real, un MCP local de prueba y una tarea Python aislada; sus límites y mediciones están en el [estudio de contexto en español](estudio-contexto.es.md). Los artefactos locales `.runtime` quedan fuera de Git y de las comprobaciones del paquete.
