# Work Item — WAS-255: Chat DeFi

## User Story
**COMO** usuario de WasiAI (humano)  
**QUIERO** escribir una pregunta en lenguaje natural sobre DeFi en Avalanche  
**PARA QUE** WasiAI descubra qué agentes necesita, los encadene via /compose, pague x402 por cada paso, y me devuelva un resultado completo

## Acceptance Criteria (EARS)

- AC1: **When** el usuario escribe una pregunta DeFi (e.g. "¿Es seguro invertir en AVAX?"), **the system shall** generar un pipeline de agentes apropiado y ejecutarlo via /compose.
- AC2: **When** el pipeline se ejecuta, **the system shall** mostrar cada step con: nombre del agente, costo en USDC, estado (loading/done/error).
- AC3: **When** el pipeline termina exitosamente, **the system shall** mostrar resultado legible (no JSON crudo), costo total, y links a receipts en Snowtrace.
- AC4: **When** el usuario no tiene agent key configurada, **the system shall** mostrar instrucciones para obtener una.
- AC5: **When** un step falla, **the system shall** mostrar el error de ese step manteniendo los steps exitosos visibles.
- AC6: **The UI shall** funcionar correctamente en mobile (responsive).
- AC7: **The system shall** soportar español e inglés via next-intl.

## Scope IN
- Página `/[locale]/chat/page.tsx` con componentes nuevos
- Endpoint `/api/v1/chat/route.ts` que interpreta pregunta → steps → ejecuta /compose internamente
- i18n messages (en.json, es.json) para la sección chat
- Link en navegación

## Scope OUT
- Historial de conversaciones / memoria entre sesiones
- Múltiples turnos (single-shot por request)
- Agentes externos (solo los 7 oficiales de WasiAI)
- Streaming de respuestas (response completa al terminar)
