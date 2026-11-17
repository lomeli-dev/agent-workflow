# Ronda final: proyectos distintos

Esta ronda dirigida se ejecutó después de la campaña de cuatro rondas, en fixtures temporales aislados de la Mac. No reemplaza ni modifica los resultados anteriores. Cada caso cambió sólo la implementación y su informe; tests e instrucciones protegidos se verificaron por hash.

| Proyecto | Cliente / modelo solicitado | Resultado |
| --- | --- | --- |
| Cola Go | Codex / `gpt-6-luna` | El agente informó que `go test` no pudo usar el caché global dentro del sandbox; la prueba independiente fuera del agente pasó. Se conservó el original. En un fixture nuevo, con `GOCACHE` dentro del proyecto, se observó en el registro del agente `go test ./...` con salida 0; el test independiente también pasó. |
| Inventario Python | Claude / `claude-sonnet-5-5` | El agente y el verificador independiente ejecutaron los tests con éxito. Se comprobó además el rechazo de cantidad negativa. |
| Slug JavaScript | OpenCode V2 / `opencode-go/glm-5.3-flash` | El agente y el verificador independiente ejecutaron los tests con éxito. Se comprobó además la normalización de espacios y tabulaciones. |

Los tres agentes informaron que revisaron la aplicabilidad de Agent Workflow; estos ejercicios eran pequeños y no prueban exhaustivamente todas sus reglas, habilidades ni roles. El resultado Go inicial que sólo mira el test del coordinador no debe interpretarse como éxito del test dentro del agente. Los registros completos permanecen privados en `.runtime/final-round/`.

Datos: [resultados originales](results.json), [reintento Go](go-retest.json), [medición de contexto](context-measurement.json) y [análisis de contexto inicial](contexto-inicial.md).
