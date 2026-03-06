# Adversarial Review — WAS-71: Agent Wallets Fase 1

**Fecha:** 2026-03-02  
**Adversary:** San (subagente NexusAgil)  
**Resultado:** AR DONE WAS-71 — 0 BLOQUEANTE, 4 MENOR

---

## Archivos revisados

| Archivo | Estado |
|---------|--------|
| `supabase/migrations/033_agent_wallets.sql` | ✅ OK |
| `src/lib/agent-wallets/agentWallet.ts` | ✅ OK (4 menores) |
| `src/app/api/v1/agents/[slug]/wallet/route.ts` | ✅ OK |
| `src/app/[locale]/creator/dashboard/_components/AgentWalletSection.tsx` | ✅ OK |
| `src/app/[locale]/creator/dashboard/page.tsx` (cambios WAS-71) | ✅ OK |

---

## Amenazas críticas — Resultado

### ✅ Private Key Leak — NO HAY LEAK

- **GET `/wallet`** retorna solo `{ address, balanceWei, balanceFormatted }`. Ningún campo sensible.
- **POST `/wallet`** retorna solo `{ address }`. La private key jamás sale del server.
- **`getAgentWalletClient`** retorna un `WalletClient` de viem. La private key se descifra en memoria, nunca se serializa ni retorna.
- **`console.error`** en el catch logea solo `(err as Error).message` — no el stack completo ni ningún valor de clave.
- **UI** muestra dirección truncada (`0x1234…5678`) y copia la dirección completa. Private key no existe en el cliente.

### ✅ Cifrado AES-256-GCM — CORRECTO

- IV aleatorio por operación (`crypto.randomBytes(12)`) — ✅ no es fijo.
- Formato de almacenamiento: `base64(iv[12] + tag[16] + ciphertext)` — IV y tag persistidos junto al ciphertext, descifrado determinista garantizado.
- Key desde `AGENT_WALLET_ENCRYPTION_KEY` env var — ✅.
- **Fail-fast en startup**: si la env var no existe o no tiene exactamente 64 hex chars, el módulo lanza error inmediatamente al cargarse. El servidor no arranca — comportamiento correcto para producción.

### ✅ Autorización — CORRECTA

- `getAgentWithOwnership(slug, userId)` verifica `agent.creator_id === userId` antes de cualquier operación.
- Ambos handlers (GET y POST) verifican sesión Supabase (`auth.getUser()`) y luego ownership. Sin bypass posible.
- Tabla `agent_wallets` tiene RLS `USING(false)` — ningún cliente Supabase puede leer ni escribir directamente. Solo service role.

### ✅ Race Conditions — MANEJADAS

- `generateAgentWallet` hace check de existencia antes de generar keypair (reducción de trabajo innecesario).
- Si dos requests paralelos pasan el check simultáneamente, ambos generan keypairs distintos, pero el `INSERT` falla con `23505` (unique violation sobre `agent_id` PK).
- El handler del `23505` hace un segundo `SELECT` y retorna la address ganadora. La private key del "perdedor" se descarta en memoria — no hay leak, no hay corrupción de datos.

---

## Hallazgos MENORES (no bloquean merge)

### M-1: TOCTOU genera keypair descartado en race
**Archivo:** `agentWallet.ts:generateAgentWallet`  
**Descripción:** En una carrera, el request "perdedor" genera un keypair (costo CPU) que se descarta al recibir `23505`. No es un problema de seguridad pero sí de eficiencia.  
**Recomendación:** Para Sprint 16 con carga alta, considerar `INSERT ... ON CONFLICT DO NOTHING RETURNING wallet_address` en SQL para evitar generar el keypair antes de saber si ya existe. Aceptable en Fase 1.

### M-2: `getAgentWalletBalance` swallows RPC errors silenciosamente
**Archivo:** `agentWallet.ts:getAgentWalletBalance`  
**Descripción:** El catch retorna `{ balanceWei: '0', balanceFormatted: '0' }` sin propagar ni loggear el error. Si el RPC de Fuji está caído, el usuario ve balance 0 sin indicación de error.  
**Recomendación:** Agregar `console.warn('[AgentWallet] Balance fetch failed:', e)` en el catch para facilitar debugging. La UI podría distinguir `null` (fallo RPC) de `'0'` (balance real cero).

### M-3: `decrypt` sin try/catch en `getAgentWalletClient`
**Archivo:** `agentWallet.ts:getAgentWalletClient`  
**Descripción:** Si `encrypted_private_key` está corrompido en DB o si `AGENT_WALLET_ENCRYPTION_KEY` cambia sin re-cifrar, `decrypt` lanzará un error de crypto nativo con posible información interna en el mensaje. El error se propagaría sin wrapping.  
**Recomendación:** Envolver `decrypt()` en try/catch y lanzar `new Error('[AgentWallet] Failed to decrypt wallet key')` genérico.

### M-4: Sin rate limiting en POST `/wallet`
**Archivo:** `route.ts:POST`  
**Descripción:** Un usuario puede spamear POST `/wallet` aunque sea idempotente. Cada llamada genera un keypair (crypto), consulta Supabase y descarta el par. Bajo carga adversarial moderada podría generar costo de cómputo.  
**Recomendación:** Agregar rate limiting con Upstash Redis (ya disponible en el proyecto) en Sprint 16. Aceptable en Fase 1 (Fuji testnet, usuarios limitados).

---

## Conclusión

La implementación de WAS-71 es **sólida en las áreas críticas**:
- Zero private key leak en API, logs o UI.
- Cifrado AES-256-GCM con IV aleatorio correcto.
- Autorización con ownership check en ambos endpoints.
- RLS estricto en la tabla.
- Race conditions manejadas con `23505`.

Los 4 hallazgos menores son mejoras de robustez/observabilidad sin impacto de seguridad. **No bloquean el merge.**

---

**AR DONE WAS-71 — 0 BLOQUEANTE, 4 MENOR**
