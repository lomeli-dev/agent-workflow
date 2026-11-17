---
name: agent-workflow-baseline
description: Base 0.2.3 verificada y limites que la nueva campaña debe respetar.
date: 2026-11-13T19:28:58-06:00
---
Agent Workflow 0.2.3 está en main, commit 55015bde9c85050b1198c55ff203be7bcf52c474; agent-workflow verify pasó en macOS y CI 43539483404 terminó success para ese mismo SHA. La evidencia anterior registra 42 pruebas y ensayos nativos de clientes, roles, MCP, navegador y compactación controlada; no son rondas de la nueva campaña.

**Why**: docs/repairs-2026-11-13.md y su JSON documentan guard de OpenCode, fallback de símbolos y continuidad; docs/native-trial-2026-11-13.md preserva fallos y límites anteriores. Se confirmó el estado Git, la instalación y la CI al guardar esta memoria.

**How to apply**: partir de esa base comprobada, resolver aliases/modelos antes de lanzar, congelar candidatos por ronda y usar evidencia independiente. El guard no es un parser universal y el fallback TypeScript no produce relaciones del grafo. No editar el paquete que usa un worker activo por enlace local.
