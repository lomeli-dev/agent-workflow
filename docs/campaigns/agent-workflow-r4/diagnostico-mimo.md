# Revisión de tiempos MiMo en OpenCode

Revisión de los registros sintéticos T06 ya existentes; no se lanzó una ronda adicional. Los cuatro intentos usaron el modelo registrado `opencode-go/mimo-v2.6-flash` y límite de 240 segundos.

- Rondas 1 y 2: terminaron con tests independientes y reporte; duraciones 227.76 y 196.34 segundos.
- Ronda 3: agotó el límite sin cambios ni reporte. En un paso transcurrieron 157.098 segundos desde `step_start` hasta el evento de la herramienta shell completada; los timestamps de esa herramienta registran 3.959 segundos de ejecución. Por tanto, aproximadamente 153.139 segundos de ese intervalo quedan fuera del tiempo registrado de ejecución de shell. Esto no identifica si fueron generación, proveedor, cliente o entrega de eventos.
- Ronda 4: agotó el límite sin reporte. El código generado pasó los tests independientes. Un comando compuesto de test fue rechazado por el guard; después ejecutó el test directo. El último evento fue un nuevo `step_start` sin `step_finish` antes del corte; la evidencia no identifica la causa de la espera.

No hay evidencia suficiente para atribuir los dos timeouts a Agent Workflow ni para descartarlo por completo. Para aislar la causa hace falta instrumentación y una comparación controlada con el mismo modelo y fixture, conservando proveedor, latencia, permisos y límites; esto sería una prueba nueva, no una quinta ronda de la campaña.

Verificación posterior: `npm test` pasó 42/42; `node scripts/package-smoke.mjs` pasó; `agent-workflow verify --json` reportó archivos y registros correctos para los tres clientes. Esta última comprobación no demuestra por sí sola la carga nativa de hooks, LSP ni comportamiento en vivo.
