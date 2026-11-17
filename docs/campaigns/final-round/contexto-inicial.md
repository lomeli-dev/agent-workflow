# Contexto inicial de los clientes

Una sesión nueva puede incluir instrucciones del producto, reglas globales y del proyecto, inventario de skills, descripciones de herramientas y servidores MCP. El tamaño visible puede variar con el cliente, modelo, configuración, caché y sesión. No es seguro atribuir todos los tokens a un único componente sin experimentos aislados.

## Medición local orientativa

En una carpeta sintética con el mismo saludo y sin herramientas llamadas, Codex CLI con `gpt-6-luna` reportó 24,130 tokens de entrada con la configuración habitual y 19,040 con `--ignore-user-config`. Esta bandera cambia varias configuraciones a la vez, no solamente MCP; la diferencia de 5,090 tokens no identifica una causa única. El segundo reporte incluía 7,168 tokens de caché leída. Es una muestra por configuración, no un benchmark ni una factura.

Claude Code con `claude-sonnet-5-5` anunció 139 herramientas y 18 entradas de servidores MCP con la configuración habitual, frente a 25 herramientas y cero servidores con `--strict-mcp-config` y una lista MCP vacía. El primer resultado reportó 2 tokens de entrada, 16,779 de creación de caché y 15,702 de lectura de caché; el segundo, 2, 15,617 y 11,595, respectivamente. Son campos reportados por el cliente; no son un desglose causal ni una medición de costo real. La variante sin MCP pierde esas capacidades durante esa ejecución.

## Qué se puede ajustar

- **Codex:** reducir y desduplicar instrucciones `AGENTS.md`; el límite `project_doc_max_bytes` controla cuántos bytes de ese archivo se leen, aunque bajarlo indiscriminadamente podría cortar reglas necesarias. La configuración permite deshabilitar un MCP o limitar sus herramientas por servidor. `--ignore-user-config` se verificó como diagnóstico en la CLI local y afecta más cosas que MCP. [Referencia oficial de configuración](https://developers.openai.com/codex/config-reference/).
- **Claude Code:** deshabilitar servidores concretos desde `/mcp` por proyecto sin borrar su configuración; la búsqueda de herramientas puede diferir definiciones MCP según modelo y umbral. No desactivar `ToolSearch` suponiendo que siempre ahorra: la documentación indica que hacerlo puede cargar herramientas directamente. `--strict-mcp-config` limita los servidores de esa ejecución a los especificados. [MCP y búsqueda de herramientas](https://code.claude.com/docs/en/mcp) · [referencia CLI](https://code.claude.com/docs/en/cli-reference).
- **OpenCode V2:** mantener cortos los archivos `AGENTS.md` y `instructions`, que pueden combinarse por alcance. Los MCP pueden quedar configurados con `disabled: true`; Code Mode permite descubrir herramientas y procesar resultados sin añadir necesariamente cada resultado intermedio al contexto. Sus permisos siguen aplicando. [Instrucciones](https://opencode.ai/docs/instructions/) · [MCP](https://opencode.ai/docs/mcp-servers/) · [herramientas](https://opencode.ai/docs/tools/).

Recomendación: primero medir por cliente y tarea, mantener un conjunto mínimo de instrucciones esenciales, y activar los MCP realmente necesarios por proyecto. No reemplazar el prompt de sistema ni desactivar reglas, herramientas o seguridad globalmente sólo para reducir tokens. Hacer una comparación repetida con mismas tareas y medir calidad, llamadas, latencia y caché además de tokens.
