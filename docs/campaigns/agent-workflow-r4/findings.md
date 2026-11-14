# Hallazgos de campaña

## Ronda 1: fallo del arnés

T04, T05 y T09 no arrancaron porque el arnés combinó `--sandbox` y `--approve-for-me`, opciones incompatibles en Codex CLI 0.163.0. No es evidencia de un defecto del paquete. Se corrigió el arnés y se ejecutó un reintento independiente por caso: las pruebas base pasaron. Los originales se conservan en `round-01.json`; los reintentos, en los archivos `round-01-retest-*.json`.

## Límites de evidencia

- `base_pass` sólo indica que el proceso terminó, los tres tests comunes pasaron, el informe existe y las comprobaciones indicadas de archivos protegidos pasaron. Ningún caso está completo hasta comprobar su escenario secundario y las demás condiciones del plan.
- Claude confirmó el modelo en su evento de inicio. Codex y OpenCode se invocaron con modelo explícito, pero sus JSONL no aportan aún evidencia independiente del modelo efectivo.
- Los fixtures de esta primera versión son copias del mismo helper con distintas etiquetas de dominio; no prueban diez problemas de software diferentes.
- Auditoría independiente observó rechazos `AW_VALIDATION_COMPOUND` en T06, T07 y T10 de la ronda 1 seguidos de ejecución directa. El arnés actual no los cuenta en `native_error_events`; no representan necesariamente un fallo del paquete. Hay que registrar y comprobar el evento específico.
- El archivo npm empaquetado se guardó en almacenamiento privado. No está demostrado que los clientes de las rondas hayan cargado ese archivo empaquetado; se usaron las integraciones globales existentes verificadas a nivel de archivos.

## Ronda 3: tiempo agotado

T06 (OpenCode, MiMo 2.6 Flash) alcanzó 240 segundos y el arnés terminó el grupo de procesos propio; no había cambios ni informe final y el test independiente seguía fallando. El log no contiene un evento de error clasificado ni salida stderr; no hay evidencia suficiente para atribuirlo al paquete. No se ejecutó un reintento inmediato: se conserva el resultado y se repetirá en la siguiente ronda planificada.

## Navegador: solicitud denegada

La prueba dirigida de Claude no abrió navegador ni hizo clic: el cliente denegó `agent-workflow --help` y el agente se detuvo. La cadena `Count: 1` aparecía en texto de solicitud repetido en un resultado denegado; una búsqueda de texto la confundió inicialmente con una observación. El informe real la clasifica como no verificada. Se necesita corregir el arnés y comprobar el contenido de la captura del DOM, no sólo la presencia de la cadena.

## Ronda 4: segundo tiempo agotado

T06 alcanzó nuevamente 240 s. En este intento los tests independientes pasaron, pero el proceso no entregó informe ni terminó antes del límite; se conserva como timeout y no se atribuye al paquete sin diagnóstico adicional.

## Atribución de modelos actualizada

La API de las sesiones archivadas confirmó el proveedor y modelo de los doce intentos base de OpenCode; el contexto propio de las cuatro pruebas persistentes de delegación confirmó Codex Terra. Los ejercicios base efímeros de Codex mantienen la limitación de atribución. Véanse `opencode-models.json` y `codex-worker-models.json`.

## Observación adicional de los timeouts

En ambas sesiones MiMo, los últimos eventos conservados muestran un paso nuevo iniciado después de un uso de herramienta completado; no apareció su final antes del corte. Esto acota el lugar observado, pero no distingue espera del modelo, proveedor o cliente, y no demuestra que Agent Workflow causara el retraso.

## Alcance de la revisión independiente

El revisor contrastó las repeticiones de guard, símbolos, navegador, delegación y compactación con evidencia privada. No reauditaron desde cero todos los contextos de modelo ni reconstruyeron las cuatro reanudaciones de Codex; esas comprobaciones fueron realizadas por el coordinador mediante los artefactos y resultados del arnés. La selección por CLI de `aw-reviewer` no demuestra por sí sola la carga completa de su prompt.
