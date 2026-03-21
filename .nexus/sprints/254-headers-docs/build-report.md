## Build Report — Headers docs

- Archivo modificado: `.agent/skills/nexus-agile/references/sdd_template.md`
- Commit: `a93aa03d7`

### Resumen
Agregada sección 4.11 "Headers de autenticación" en el template FULL del SDD.
Documenta el flujo bidireccional de headers de autenticación en WasiAI:
- `x-api-key`: Consumer → WasiAI
- `Authorization: Bearer {webhook_secret}`: WasiAI → Agente externo
- `X-WasiAI-Agent-Id`: WasiAI → Agente externo

La regla crítica está explícita: nunca mezclar estos headers.

### Verificación
- ✅ Markdown válido
- ✅ Commit exitoso
- ✅ Build report persistido
