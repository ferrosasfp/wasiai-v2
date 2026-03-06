# Report — SDD #010: Plugin LangChain — WasiAI como Tool nativa
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-01
**Issue:** WAS-23

## Resumen
Se publicaron dos paquetes para integrar agentes WasiAI como tools nativos de LangChain: `@wasiai/sdk@0.2.0` con export `@wasiai/sdk/langchain` (JavaScript) y `wasiai-langchain@0.1.0` (Python/PyPI). Ambos exponen `WasiAITool` y `WasiAIToolkit` compatibles con las interfaces `StructuredTool` (JS) y `BaseTool` (Python) de LangChain.

La implementación incluye errores tipados (`WasiAIPaymentError`, `WasiAIRateLimitError`, `WasiAIServerError`), `baseUrl` configurable, y tests unitarios con mock fetch. El trabajo se realizó en repos externos (`wasiai-sdk` y `wasiai-langchain`), sin modificar `wasiai-v2`.

## Archivos principales
- `wasiai-sdk/src/langchain/WasiAITool.ts`
- `wasiai-sdk/src/langchain/WasiAIToolkit.ts`
- `wasiai-sdk/src/langchain/errors.ts`
- `wasiai-sdk/src/langchain/index.ts`
- `wasiai-sdk/src/langchain/WasiAITool.test.ts`
- `wasiai-langchain/wasiai_langchain/tool.py`
- `wasiai-langchain/wasiai_langchain/toolkit.py`
- `wasiai-langchain/wasiai_langchain/errors.py`

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales se preservan sin modificación.
