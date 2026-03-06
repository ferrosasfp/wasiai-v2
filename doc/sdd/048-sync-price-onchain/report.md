# Report — SDD #048: Sync precio on-chain al editar agente
**Status:** DONE (retroactivo)
**Fecha original:** 2026-03-05
**Issue:** WAS-161

## Resumen
Se implementó la sincronización automática de precio y status del agente hacia el contrato on-chain cuando un creator edita un agente registrado on-chain. Se creó la función `updateAgentOnChain()` en `marketplaceClient.ts` siguiendo el patrón existente de `registerAgentOnChain()` (simulate + write + catch). La sincronización es fire-and-forget: si falla, se loguea el error pero el update en Supabase ya fue exitoso. Solo se dispara para agentes con `registration_type = 'on_chain'`. El campo `active` del contrato se eliminó de la UI (solo se sincroniza precio).

## Archivos principales
- `src/lib/contracts/marketplaceClient.ts` — nueva función `updateAgentOnChain()`
- `src/app/api/creator/agents/[slug]/route.ts` — sync en PATCH de precio
- `src/app/api/creator/agents/[slug]/status/route.ts` — sync en cambio de status

## Nota
Este reporte fue generado retroactivamente durante la migración a .nexus/ (marzo 2026).
Los artefactos originales (SDD, story-file) se preservan sin modificación.
