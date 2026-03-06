# Report — SDD #028: LlamaIndex Plugin `llama-index-wasiai`
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-02
**Issue:** WAS-41

## Resumen
Se implementó el package npm `llama-index-wasiai` como plugin oficial para integrar agentes WasiAI como tools nativas de LlamaIndex. La clase `WasiAITool` implementa `BaseTool<{ query: string }>` y realiza invocaciones vía `POST /api/v1/agents/{slug}/invoke` con autenticación por API key. El package es ESM puro, con peer dependency en `llamaindex@^0.12.x`, build con `tsc`, y publicación en npm con `publishConfig.access=public`.

## Archivos principales
- `wasiai-llamaindex/src/WasiAITool.ts` — clase principal del tool
- `wasiai-llamaindex/src/index.ts` — re-export público
- `wasiai-llamaindex/test/WasiAITool.test.ts` — tests con mock fetch
- `wasiai-llamaindex/examples/llamaindex/index.ts` — ejemplo de uso
- `wasiai-llamaindex/package.json` — configuración ESM, exports map
- `wasiai-llamaindex/tsconfig.json`
- `wasiai-llamaindex/README.md`

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
