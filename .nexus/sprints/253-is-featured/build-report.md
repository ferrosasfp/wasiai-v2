## Build Report — is_featured fix
- Cambio necesario: **sí**
- Commit: `8b3a2b374`
- Evidencia: `src/app/api/v1/agents/[slug]/route.ts:86`

### Diagnóstico
El campo `is_featured` estaba incluido en el `.select()` de Supabase (línea 38) pero **NO** en el objeto de respuesta final.

### Solución
Agregado `is_featured: agent.is_featured` al response body en línea 86, justo después de `agent_type` para mantener agrupados los metadatos core del agente.

### Verificación
- ✅ `npm run typecheck` — sin errores
- ✅ `npm run lint` — sin warnings
- ✅ Commit creado: `8b3a2b374`
