# Sesiones largas: comprobación dirigida

Tres sesiones sintéticas y aisladas en macOS, cada una con ocho turnos y 50,956 bytes de texto de entrada antes de la solicitud final. Se preservaron las instrucciones, el test y el canario de memoria del fixture. El texto adicional era ruido sintético: esto aumenta el contexto, pero no sustituye una jornada de desarrollo real ni demuestra una duración en horas.

| Sesión | Cliente y modelo | Resultado |
| --- | --- | --- |
| Workflow activo | OpenCode V2, `opencode-go/glm-5.3-flash` | Compactación nativa completada; recuperó el marcador. Intentó un test compuesto; el guard lo bloqueó antes de ejecutarlo. Después ejecutó `npm test` directamente, con salida 7, y la informó correctamente. |
| Control desactivado | OpenCode V2, el mismo modelo | Compactación nativa completada; recuperó el marcador. Confirmó el opt-out y ejecutó el test directamente, informando salida 7. |
| Workflow activo | Codex CLI, `gpt-6-luna` | Reanudó los ocho turnos, conservó el marcador y ejecutó el test directamente con salida 7, informada correctamente. No se probó ni se observó compactación nativa de Codex en este ensayo. |

En OpenCode se usó `compaction.keep.tokens = 0` sólo dentro de cada fixture para hacer visible la compactación. Los modelos se contrastaron con metadatos de sesión nativos. El guard de OpenCode es una defensa acotada; el primer intento muestra que las instrucciones por sí solas no garantizan obediencia perfecta.

## Llamadas y consumo

En la solicitud final, OpenCode con workflow activo realizó cuatro llamadas a herramientas: dos para comprobar configuración, una validación compuesta bloqueada y el test directo. El control realizó tres: búsqueda, comprobación de estado y test directo. Codex realizó dos: estado y test directo. La comparación no controla variación del modelo, orden, caché ni instrucciones globales que los clientes aún pueden descubrir cuando el proyecto está desactivado.

El cliente OpenCode reportó, sumando eventos de esos ensayos, 66,494 tokens de entrada y 252,416 de lectura de caché para el caso activo, y 65,444 de entrada y 220,864 de lectura de caché para el control. Son cifras de telemetría del cliente, no una factura, y no se deben sumar entre sí como si fueran categorías independientes de facturación. Una muestra por lado no permite concluir que el workflow ahorre tokens ni que siempre agregue esa diferencia.

En Codex el último evento reportó 556,992 `input_tokens` y 488,320 `cached_input_tokens`; los valores crecieron entre reanudaciones, por lo que no se sumaron como si fueran consumos independientes. Sin una prueba de control equivalente ni interpretación confirmada de la telemetría, no se atribuye ese volumen al workflow ni se estima su costo.

## Correcciones y límites

Se corrigieron dos errores del arnés local: registrar por separado el intento compuesto bloqueado y reconocer la frase del agente «exited with status 7». El código de Agent Workflow no se modificó porque estas pruebas no demostraron un defecto suyo. Las ejecuciones no incluyeron subagentes, múltiples horas, Claude ni pruebas de estrés de conexiones remotas. No demuestran que todas las reglas se cumplirán siempre.

Evidencia saneada: `long-session.json`, `long-session-control.json` y `long-session-codex.json`; registros completos privados bajo el fixture temporal indicado en `.runtime/long-session/`. No se deben publicar registros crudos.
