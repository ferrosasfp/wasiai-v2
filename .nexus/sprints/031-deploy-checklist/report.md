# Report — SDD #031: Pre-deploy checklist + env validation script
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-03
**Issue:** WAS-119

## Resumen
Se creó el script `scripts/validate-env.js` que verifica la presencia de todas las variables de entorno requeridas antes del deploy. El script lee `.env.example` como fuente de verdad (30 vars: 10 REQUIRED + 20 OPTIONAL), valida contra `process.env`, y retorna exit code 1 si alguna variable REQUIRED falta. Es Node.js puro sin dependencias, CommonJS, con output coloreado ANSI y tabla de resultados. Las variables REQUIRED incluyen Supabase, operator key, Upstash Redis, Pinata, cron secret y agent wallet encryption key.

## Archivos principales
- `scripts/validate-env.js` — script de validación
- `.env.example` — contrato de variables obligatorias (fuente de verdad)

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
